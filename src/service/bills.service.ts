import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillEntity } from 'src/entity/bill.entity';
import { WaterRateEntity } from '../entity/water-rate.entity'; // ปรับ Path ให้ตรงกับโฟลเดอร์ของคุณ
import { CreateBillDto } from 'src/dto/create-bill.dto';

@Injectable()
export class BillsService {
  constructor(
    @InjectRepository(BillEntity)
    private readonly billRepository: Repository<BillEntity>,

    @InjectRepository(WaterRateEntity)
    private readonly waterRateRepository: Repository<WaterRateEntity>, // เรียกใช้ตารางเรทค่าน้ำ
  ) { }

  // ฟังก์ชันสร้างบิลพร้อมคำนวณอัตโนมัติ
  async create(createBillDto: CreateBillDto) {
    // 1. ป้องกัน Error จากการจดเลขผิด
    if (createBillDto.current_unit < createBillDto.previous_unit) {
      throw new BadRequestException('หน่วยมิเตอร์ปัจจุบันต้องไม่น้อยกว่าเดือนที่แล้ว');
    }

    // 2. ดึงเรทค่าน้ำจาก Database มาเพื่อความชัวร์ (ไม่เชื่อใจราคาที่อาจถูกส่งมาจากหน้าบ้าน)
    const rate = await this.waterRateRepository.findOne({
      where: { id: createBillDto.water_rates_id }
    });

    if (!rate) {
      throw new NotFoundException('ไม่พบข้อมูลเรทค่าน้ำที่ระบุในระบบ');
    }

    // 3. คำนวณหาหน่วยที่ใช้ไป และยอดเงินรวม
    const usage_unit = createBillDto.current_unit - createBillDto.previous_unit;
    const total_amount = usage_unit * rate.price_per_unit;

    // 4. นำข้อมูลมาผูกรวมกัน โดยบังคับใช้ยอดที่เราคำนวณเอง
    const newBill = this.billRepository.create({
      ...createBillDto,
      usage_unit: usage_unit,     // เขียนทับด้วยค่าที่คำนวณได้
      total_amount: total_amount, // เขียนทับด้วยยอดเงินที่ถูกต้อง
    });

    // 5. บันทึกลง Database
    return await this.billRepository.save(newBill);
  }

  // ดูบิลทั้งหมด
  async findAll() {
    return await this.billRepository.find({
      order: { create_date: 'DESC' },
    });
  }

  // ดูบิลตาม ID
  async findOne(id: number) {
    const bill = await this.billRepository.findOne({ where: { id } });
    if (!bill) {
      throw new NotFoundException(`ไม่พบบิลหมายเลข ${id}`);
    }
    return bill;
  }

  async updateStatus(id: number, payment_status: string) {
    // ใช้ as any เพื่อบอก TypeScript ว่าไม่ต้องห่วงเรื่อง Type
    await this.billRepository.update(id, { payment_status: payment_status as any });

    return await this.billRepository.findOne({ where: { id } });
  }

  async remove(id: number) {
    // สั่งลบข้อมูลตาม ID จากตาราง
    await this.billRepository.delete(id);
    return { message: `ลบบิล ID ${id} สำเร็จเรียบร้อย!` };
  }
}