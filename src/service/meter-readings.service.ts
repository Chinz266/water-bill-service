import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeterReadingEntity } from '../entity/meter-reading.entity'; // เช็ค Path ให้ตรงกับโครงสร้างโฟลเดอร์ของคุณนะครับ
import { CreateMeterReadingDto } from '../dto/create-meter-reading.dto';
import vision from '@google-cloud/vision';
import sharp from 'sharp';

@Injectable()
export class MeterReadingsService {
  // สร้าง Client เชื่อมต่อกับ Google Cloud Vision
  private visionClient = new vision.ImageAnnotatorClient({
    keyFilename: 'google-credentials.json',
  });

  constructor(
    @InjectRepository(MeterReadingEntity)
    private readonly meterReadingRepository: Repository<MeterReadingEntity>,
  ) {}

  // ==========================================
  // --- ส่วนฟังก์ชัน CRUD ปกติ ---
  // ==========================================
  async create(createMeterReadingDto: CreateMeterReadingDto) {
    const newReading = this.meterReadingRepository.create(createMeterReadingDto);
    return await this.meterReadingRepository.save(newReading);
  }

  async findAll() {
    return await this.meterReadingRepository.find({
      order: { reading_date: 'DESC' },
    });
  }

  async findByMember(memberId: number) {
    return await this.meterReadingRepository.find({
      where: { members_id: memberId },
      order: { reading_date: 'DESC' },
    });
  }

  // ==========================================
  // --- ส่วนฟังก์ชัน OCR (เวอร์ชันแก้รอยเปื้อน + เลขห่าง) ---
  // ==========================================
  async extractMeterUnit(imageBuffer: Buffer) {
    try {
      // 1. [อัปเกรด Sharp] บังคับให้เป็นขาว-ดำสนิทด้วย threshold(120) เพื่อลบรอยขีดข่วน
      const processedImageBuffer = await sharp(imageBuffer)
        .resize({ width: 1200, withoutEnlargement: true }) 
        .grayscale() 
        .normalize() 
        .threshold(120) // ไม้ตาย: แปลงรอยเทาๆ ให้กลายเป็นสีขาว/ดำล้วน
        .sharpen({ sigma: 2.5 }) 
        .toBuffer(); 

      // 2. เรียกใช้ AI โหมด Document
      const [result] = await this.visionClient.documentTextDetection({
        image: { content: processedImageBuffer },
        imageContext: {
          languageHints: ['en'], 
        },
      });

      const detections = result.textAnnotations;

      if (!detections || detections.length === 0) {
        throw new BadRequestException('ไม่พบข้อความใดๆ ในรูปภาพ');
      }

      const rawText = detections[0].description || '';
      console.log('--- ข้อความดิบจาก AI (โหมดปราบบอส) ---');
      console.log(rawText);
      console.log('---------------------------------');

      let finalNumber: number | null = null;
      
      // 3. [อัปเกรด ลอจิกใหม่] ดูดช่องว่างทิ้งทั้งหมด
      // เปลี่ยนจาก "0 0 2 4" ให้กลายเป็น "0024"
      const textWithoutSpaces = rawText.replace(/\s+/g, '');

      // ล้างตัวอักษรขยะและสัญลักษณ์ออกให้เหลือตัวเลขล้วน 0-9
      const numbersOnly = textWithoutSpaces.replace(/\D/g, ''); 

      // เช็คความยาว (ปรับลดขั้นต่ำเหลือ 3 หลัก เผื่อกรณีรอยเปื้อนทับเลขหลักสุดท้ายมิด)
      if (numbersOnly.length >= 3 && numbersOnly.length <= 7) {
        finalNumber = parseInt(numbersOnly, 10);
      }

      // 4. ส่งค่ากลับไป
      if (finalNumber !== null) {
        return {
          success: true,
          read_unit: finalNumber,
          message: 'สกัดค่าตัวเลขสำเร็จ',
        };
      } else {
        return {
          success: false,
          read_unit: null,
          message: 'วิเคราะห์ภาพแล้ว แต่ได้ตัวเลขไม่ครบถ้วน กรุณาถ่ายให้ชัดเจนขึ้น',
        };
      }
    } catch (error) {
      console.error('เกิดข้อผิดพลาดในระบบ OCR:', error);
      throw new BadRequestException('ระบบวิเคราะห์รูปภาพมีปัญหา กรุณาลองใหม่อีกครั้ง');
    }
  }
}