import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WaterRateEntity } from 'src/entity/water-rate.entity';
import { AdminEntity } from 'src/entity/admin.entity';
import { CreateWaterRateDto } from 'src/dto/create-water-rate.dto';

@Injectable()
export class WaterRatesService {
  constructor(
    @InjectRepository(WaterRateEntity)
    private waterRateRepository: Repository<WaterRateEntity>, // Inject Repository เข้ามาใช้งาน
    @InjectRepository(AdminEntity)
    private adminRepository: Repository<AdminEntity>,
  ) {}

  async create(createWaterRateDto: CreateWaterRateDto) {
    // water_rates.create_by ติด Foreign Key กับ admin.id (fk_water_rates_admin1)
    // ถ้าไม่เช็คก่อน MySQL จะโยน ER_NO_REFERENCED_ROW_2 ออกมาเป็น 500 ที่อ่านไม่รู้เรื่อง
    const admin = await this.adminRepository.findOneBy({ id: createWaterRateDto.create_by });
    if (!admin) {
      throw new BadRequestException(
        `ไม่พบผู้ดูแลระบบรหัส ${createWaterRateDto.create_by} กรุณารัน "npm run seed:admin" เพื่อสร้างแอดมินเริ่มต้นก่อนบันทึกเรทค่าน้ำ`,
      );
    }

    // 1. สร้าง Object เรทค่าน้ำใหม่จาก DTO (create_date ต้องเซ็ตเอง ดูหมายเหตุใน WaterRateEntity)
    const newRate = this.waterRateRepository.create({
      ...createWaterRateDto,
      create_date: new Date(),
    });

    // 2. บันทึกลง Database จริงๆ
    return await this.waterRateRepository.save(newRate);
  }

  async findActive() {
    // ใช้คำสั่งหาเรทที่ status เป็น ACTIVE
    return await this.waterRateRepository.findOne({
      where: { status: 'Active' },
      order: { create_date: 'DESC' }, // เผื่อเหนียว ดึงตัวที่สร้างล่าสุดมา
    });
  }
}
