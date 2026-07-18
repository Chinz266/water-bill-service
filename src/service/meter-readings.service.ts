import { Injectable, BadRequestException, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { HttpService } from '@nestjs/axios'
import { ConfigService } from '@nestjs/config'
import { firstValueFrom } from 'rxjs'
import FormData from 'form-data'
import { MeterReadingEntity } from '../entity/meter-reading.entity' // เช็ค Path ให้ตรงกับโครงสร้างโฟลเดอร์ของคุณนะครับ
import { AdminEntity } from '../entity/admin.entity'
import { MemberEntity } from '../entity/member.entity'
import { CreateMeterReadingDto } from '../dto/create-meter-reading.dto'

@Injectable()
export class MeterReadingsService {
  private readonly logger = new Logger(MeterReadingsService.name);
  private readonly visionServiceUrl: string

  constructor(
    @InjectRepository(MeterReadingEntity)
    private readonly meterReadingRepository: Repository<MeterReadingEntity>,
    @InjectRepository(AdminEntity)
    private readonly adminRepository: Repository<AdminEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // URL ของ Python vision service (best.pt) ตั้งค่าผ่าน .env ได้
    this.visionServiceUrl = this.configService.get<string>(
      'VISION_SERVICE_URL',
      'http://127.0.0.1:8000',
    )
  }

  // ==========================================
  // --- ส่วนฟังก์ชัน CRUD ปกติ ---
  // ==========================================
  async create(createMeterReadingDto: CreateMeterReadingDto) {
    // meter_readings.create_by / members_id1 ติด Foreign Key กับ admin.id และ members.id
    // ถ้าไม่เช็คก่อน MySQL จะโยน ER_NO_REFERENCED_ROW_2 ออกมาเป็น 500 ที่อ่านไม่รู้เรื่อง
    const { create_by, members_id } = createMeterReadingDto

    if (create_by !== undefined && create_by !== null) {
      const admin = await this.adminRepository.findOneBy({ id: create_by })
      if (!admin) {
        throw new BadRequestException(
          `ไม่พบผู้ดูแลระบบรหัส ${create_by} กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่อีกครั้ง`,
        )
      }
    }

    const member = await this.memberRepository.findOneBy({ id: members_id })
    if (!member) {
      throw new BadRequestException(`ไม่พบข้อมูลลูกบ้านรหัส ${members_id}`)
    }

    const newReading = this.meterReadingRepository.create({
      ...createMeterReadingDto,
      // create_date ต้องเซ็ตเอง ดูหมายเหตุใน MeterReadingEntity
      create_date: new Date(),
    })
    return await this.meterReadingRepository.save(newReading)
  }

  async findAll() {
    return await this.meterReadingRepository.find({
      order: { reading_date: 'DESC' },
    })
  }

  async findByMember(memberId: number) {
    return await this.meterReadingRepository.find({
      where: { members_id: memberId },
      order: { reading_date: 'DESC' },
    })
  }

  // ==========================================
  // --- ส่วนฟังก์ชัน OCR (เรียกโมเดล YOLO best.pt ผ่าน Python service) ---
  // ==========================================
  async extractMeterUnit(imageBuffer: Buffer) {
    const startTime = Date.now()
    this.logger.log('Starting water meter reading via YOLO vision service...')

    try {
      // เตรียม multipart form ส่งรูปไปให้ Python service
      const form = new FormData()
      form.append('file', imageBuffer, {
        filename: 'meter.jpg',
        contentType: 'application/octet-stream',
      })

      const response = await firstValueFrom(
        this.httpService.post(`${this.visionServiceUrl}/detect`, form, {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 30000,
        }),
      )

      const data = response.data as {
        success: boolean
        read_unit: string | null
        integer_part: string | null
        decimal_part: string | null
        full_reading: string | null
        confidence: number
        message: string
      }

      if (data.success && data.read_unit) {
        // padStart(7,'0') เพื่อคงรูปแบบเดิมที่ frontend คาดหวัง (เลขมิเตอร์ 7 หลัก)
        const paddedDigits = data.read_unit.padStart(7, '0')
        this.logger.log(
          `Reading OK: "${data.full_reading}" (full: ${paddedDigits}, ` +
          `decimal: ${data.decimal_part}, conf: ${data.confidence}) in ${Date.now() - startTime}ms`,
        )
        return {
          success: true,
          read_unit: data.full_reading,
          // ส่ง confidence ต่อให้หน้าเว็บด้วย เอาไว้ทำแถบบอกว่าอ่านได้ชัดแค่ไหน
          confidence: data.confidence,
          message: 'สกัดค่าตัวเลขสำเร็จ',
        }
      }

      this.logger.warn(
        `Vision service found no digits. Total time: ${Date.now() - startTime}ms`,
      )
      return {
        success: false,
        read_unit: null,
        message:
          data.message ||
          'วิเคราะห์ภาพแล้ว แต่ได้ตัวเลขไม่ครบถ้วน กรุณาถ่ายให้ชัดเจนขึ้น',
      }
    } catch (error) {
      // แยกกรณีต่อ Python service ไม่ติด ออกจาก error อื่นๆ เพื่อ debug ง่าย
      const err = error as { code?: string; message?: string; stack?: string }
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        this.logger.error(
          `ไม่สามารถเชื่อมต่อ Vision service ที่ ${this.visionServiceUrl} ได้ ` +
          `(ตรวจสอบว่ารัน Python service อยู่หรือไม่): ${err.message}`,
        )
        throw new BadRequestException(
          'ระบบอ่านมิเตอร์ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง',
        )
      }

      this.logger.error(
        'An error occurred during water meter reading:',
        err.stack || err.message,
      )
      throw new BadRequestException(
        'ระบบวิเคราะห์รูปภาพมีปัญหา กรุณาลองใหม่อีกครั้ง',
      )
    }
  }
}
