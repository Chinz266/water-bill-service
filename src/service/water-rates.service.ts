import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WaterRateEntity } from 'src/entity/water-rate.entity';
import { CreateWaterRateDto } from 'src/dto/create-water-rate.dto';

@Injectable()
export class WaterRatesService {
  constructor(
    @InjectRepository(WaterRateEntity)
    private waterRateRepository: Repository<WaterRateEntity>, // Inject Repository เข้ามาใช้งาน
  ) {}

  async create(createWaterRateDto: CreateWaterRateDto) {
    // 1. สร้าง Object เรทค่าน้ำใหม่จาก DTO
    const newRate = this.waterRateRepository.create(createWaterRateDto);
    
    // 2. บันทึกลง Database จริงๆ
    return await this.waterRateRepository.save(newRate); 
  }

  async findActive() {
    // ใช้คำสั่งหาเรทที่ status เป็น ACTIVE
    return await this.waterRateRepository.findOne({
      where: { status: 'Active' },
      order: { create_date: 'DESC' } // เผื่อเหนียว ดึงตัวที่สร้างล่าสุดมา
    });
  }
}