import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateMeterReadingDto } from 'src/dto/create-meter-reading.dto';
import { MeterReadingEntity } from 'src/entity/meter-reading.entity';
import { Repository } from 'typeorm';

@Injectable()
export class MeterReadingsService {
  constructor(
    @InjectRepository(MeterReadingEntity)
    private readonly meterReadingRepository: Repository<MeterReadingEntity>,
  ) {}

  // บันทึกการจดมิเตอร์ใหม่
  async create(createMeterReadingDto: CreateMeterReadingDto) {
    const newReading = this.meterReadingRepository.create(createMeterReadingDto);
    return await this.meterReadingRepository.save(newReading);
  }

  // ดูประวัติการจดมิเตอร์ทั้งหมด
  async findAll() {
    return await this.meterReadingRepository.find({
      order: { reading_date: 'DESC' }, // เรียงจากวันที่ล่าสุดขึ้นก่อน
    });
  }

  // ดูประวัติการจดมิเตอร์ของลูกบ้านแต่ละคน (ค้นหาตาม members_id)
  async findByMember(memberId: number) {
    return await this.meterReadingRepository.find({
      where: { members_id: memberId },
      order: { reading_date: 'DESC' },
    });
  }
}