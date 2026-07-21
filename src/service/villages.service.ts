import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateVillageDto } from 'src/dto/create-village.dto';
import { UpdateVillageDto } from 'src/dto/update-village.dto';
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

  // 4. แก้ไขข้อมูลหมู่บ้าน (ใช้โดยหน้าตั้งค่า — admin เท่านั้น)
  //    modifiedBy รับมาจาก JWT ของคนที่ล็อกอินอยู่ ไม่ใช่จาก body ที่ปลอมได้
  async update(id: number, dto: UpdateVillageDto, modifiedBy: number) {
    const village = await this.villageRepository.findOne({ where: { id } });
    if (!village) {
      throw new NotFoundException(`ไม่พบข้อมูลหมู่บ้าน ID: ${id}`);
    }

    // 🌟 ตัดช่องว่างหัวท้ายกันเคสพิมพ์เกิน แล้วแปลงสตริงว่างเป็น null
    //    เพื่อไม่ให้ฟิลด์ที่ไม่ได้กรอกกลายเป็น '' ค้างในฐานข้อมูล
    const clean = <T extends string | undefined>(value: T) => {
      if (value === undefined) return undefined;
      const trimmed = String(value).trim();
      return trimmed === '' ? null : trimmed;
    };

    const patch: Partial<VillageEntity> = {};
    if (dto.provinces_id !== undefined) patch.provinces_id = dto.provinces_id;
    if (dto.districts_id !== undefined) patch.districts_id = dto.districts_id;
    if (dto.subdistricts_id !== undefined)
      patch.subdistricts_id = dto.subdistricts_id;
    if (dto.headman_name !== undefined)
      patch.headman_name = clean(dto.headman_name) as string;
    if (dto.deputy_headman_name !== undefined)
      patch.deputy_headman_name = clean(dto.deputy_headman_name) as string;
    if (dto.phone !== undefined) patch.phone = clean(dto.phone) as string;
    if (dto.billing_month !== undefined)
      patch.billing_month = clean(dto.billing_month) as string;

    // ชื่อหมู่บ้านกับหมู่ที่ห้ามเป็นค่าว่าง เพราะคอลัมน์จริงเป็น NOT NULL
    // ถ้าปล่อยผ่านจะพังเป็น 500 ที่ระดับ MySQL แทนที่จะบอกผู้ใช้ว่ากรอกไม่ครบ
    if (dto.village_name !== undefined) {
      const name = clean(dto.village_name);
      if (!name) {
        throw new UnprocessableEntityException('กรุณากรอกชื่อหมู่บ้าน');
      }
      patch.village_name = name;
    }
    if (dto.village_no !== undefined) {
      const no = clean(dto.village_no);
      if (!no) {
        throw new UnprocessableEntityException('กรุณากรอกหมู่ที่');
      }
      patch.village_no = no;
    }

    patch.modify_by = modifiedBy;

    const merged = this.villageRepository.merge(village, patch);
    return await this.villageRepository.save(merged);
  }
}
