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
    const admin = await this.adminRepository.findOneBy({
      id: createWaterRateDto.create_by,
    });
    if (!admin) {
      throw new BadRequestException(
        `ไม่พบผู้ดูแลระบบรหัส ${createWaterRateDto.create_by} กรุณารัน "npm run seed:admin" เพื่อสร้างแอดมินเริ่มต้นก่อนบันทึกเรทค่าน้ำ`,
      );
    }

    // 🌟 ระบบคิดเงินด้วย "เรทที่ Active ล่าสุด" ตัวเดียว — พอตั้งเรทใหม่จึงต้องปิดเรทเก่าให้ด้วย
    //    ไม่งั้นเรท Active จะกองซ้อนกันหลายตัว แล้วประวัติจะบอกไม่ได้ว่าช่วงไหนใช้ราคาเท่าไร
    //    ห่อ transaction เดียว: ปิดเรทเก่า + เปิดเรทใหม่ ต้องสำเร็จหรือล้มเหลวไปด้วยกัน
    return await this.waterRateRepository.manager.transaction(
      async (manager) => {
        if ((createWaterRateDto.status ?? 'Active') === 'Active') {
          await manager.update(
            WaterRateEntity,
            { status: 'Active' },
            {
              status: 'Inactive',
              modify_by: createWaterRateDto.create_by,
              modify_date: new Date(),
            },
          );
        }

        const newRate = manager.create(WaterRateEntity, {
          ...createWaterRateDto,
          create_date: new Date(),
        });
        return await manager.save(newRate);
      },
    );
  }

  async findActive() {
    // ใช้คำสั่งหาเรทที่ status เป็น ACTIVE
    return await this.waterRateRepository.findOne({
      where: { status: 'Active' },
      order: { create_date: 'DESC' }, // เผื่อเหนียว ดึงตัวที่สร้างล่าสุดมา
    });
  }

  // ประวัติเรทค่าน้ำทั้งหมด (ใหม่สุดก่อน) — หน้าตั้งค่าใช้โชว์ว่าเคยปรับราคาเมื่อไรบ้าง
  async findAll() {
    return await this.waterRateRepository.find({
      order: { create_date: 'DESC', id: 'DESC' },
    });
  }
}
