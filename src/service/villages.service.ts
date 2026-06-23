import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateVillageDto } from 'src/dto/create-village.dto';
import { VillageEntity } from 'src/entity/village.entity';
import { Repository } from 'typeorm';

@Injectable()
export class VillagesService {
  constructor(
    @InjectRepository(VillageEntity)
    private readonly villageRepository: Repository<VillageEntity>,
  ) {}

  // 1. เพิ่มข้อมูลหมู่บ้านใหม่
  async create(createVillageDto: CreateVillageDto) {
    const newVillage = this.villageRepository.create(createVillageDto);
    return await this.villageRepository.save(newVillage);
  }

  // 2. ดึงข้อมูลหมู่บ้านทั้งหมด
  async findAll() {
    return await this.villageRepository.find({
      order: { id: 'ASC' }, // เรียงตาม ID
    });
  }

  // 3. ดึงข้อมูลหมู่บ้านตาม ID ที่เลือก
  async findOne(id: number) {
    const village = await this.villageRepository.findOne({ where: { id } });
    if (!village) {
      throw new NotFoundException(`ไม่พบข้อมูลหมู่บ้าน ID: ${id}`);
    }
    return village;
  }
}