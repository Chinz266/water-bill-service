import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { MeterReadingEntity } from 'src/entity/meter-reading.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeterReadingRemoveDto } from 'src/dto/meter-reading-remove.dto';

@Injectable()
export class MeterReadingService {

    constructor(
        @InjectRepository(MeterReadingEntity)
        private meterReadingRepository: Repository<MeterReadingEntity>,
    ) { }

    findAll(): Promise<MeterReadingEntity[]> {
        return this.meterReadingRepository.find();
    }

    // ดึงข้อมูลการจดมิเตอร์ตาม ID
    findOne(id: number): Promise<MeterReadingEntity | null> {
        return this.meterReadingRepository.findOneBy({ id });
    }

    // สร้างข้อมูลการจดมิเตอร์ใหม่
    async create(data: Partial<MeterReadingEntity>): Promise<MeterReadingEntity> {
        // ตรวจสอบว่ามีการส่ง membersId มาหรือไม่
        if (!data.membersId) {
            throw new UnprocessableEntityException('จำเป็นต้องระบุ membersId เพื่อผูกกับสมาชิก');
        }

        const readingToSave = this.meterReadingRepository.create({
            ...data,
            createDate: new Date(),
        });
        
        return await this.meterReadingRepository.save(readingToSave);
    }

    // อัปเดตข้อมูลการจดมิเตอร์
    async update(data: Partial<MeterReadingEntity>): Promise<MeterReadingEntity> {
        if (!data.id) {
            throw new UnprocessableEntityException('ต้องระบุ ID ของการจดมิเตอร์ที่ต้องการแก้ไข');
        }

        const reading = await this.meterReadingRepository.findOneBy({ id: data.id });
        if (!reading) {
            throw new UnprocessableEntityException(`ไม่พบข้อมูลการจดมิเตอร์ที่มี ID: ${data.id}`);
        }

        const readingModify = this.meterReadingRepository.merge(reading, {
            ...data,
            modifyDate: new Date(),
        });

        return await this.meterReadingRepository.save(readingModify);
    }

    // ลบข้อมูลการจดมิเตอร์
    async remove(data: MeterReadingRemoveDto): Promise<void> {
        const reading = await this.meterReadingRepository.findOneBy({ id: data.id });
        if (!reading) {
            throw new UnprocessableEntityException(`ไม่พบข้อมูลการจดมิเตอร์ที่มี ID: ${data.id}`);
        }
        await this.meterReadingRepository.delete(data.id);
    }
}
