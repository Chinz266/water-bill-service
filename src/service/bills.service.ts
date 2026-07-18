import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillEntity } from 'src/entity/bill.entity';
import { WaterRateEntity } from '../entity/water-rate.entity'; // ปรับ Path ให้ตรงกับโฟลเดอร์ของคุณ
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { MemberEntity } from '../entity/member.entity';
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
    // price_per_unit เป็น decimal ใน MySQL ซึ่ง TypeORM คืนมาเป็น string ('15.00') ต้องแปลงก่อนคูณ
    const usage_unit = createBillDto.current_unit - createBillDto.previous_unit;
    const total_amount = usage_unit * Number(rate.price_per_unit)

    // 4. นำข้อมูลมาผูกรวมกัน โดยบังคับใช้ยอดที่เราคำนวณเอง
    const newBill = this.billRepository.create({
      ...createBillDto,
      usage_unit: usage_unit,     // เขียนทับด้วยค่าที่คำนวณได้
      total_amount: total_amount, // เขียนทับด้วยยอดเงินที่ถูกต้อง
      // 🌟 กำหนดค่าเองให้ชัดเจน กัน payment_status = NULL และ create_date = 0000-00-00
      payment_status: createBillDto.payment_status ?? 'Pending',
      create_date: new Date(),
    });

    // 5. บันทึกลง Database
    return await this.billRepository.save(newBill);
  }

  // 🌟 ตาราง bills เก็บแค่ meter_readings_id หน้าเว็บเลยไม่รู้ว่าบิลนี้เป็นของบ้านหลังไหน
  //    ต้อง join ผ่าน meter_readings ไปหา members (และดึงเรทค่าน้ำมาโชว์ในหน้ารายละเอียดด้วย)
  private billDetailQuery() {
    return this.billRepository
      .createQueryBuilder('bill')
      .leftJoin(MeterReadingEntity, 'reading', 'reading.id = bill.meter_readings_id')
      .leftJoin(MemberEntity, 'member', 'member.id = reading.members_id')
      .leftJoin(WaterRateEntity, 'rate', 'rate.id = bill.water_rates_id')
      .addSelect([
        'reading.id',
        'reading.reading_date',
        'reading.meter_unit',
        'member.id',
        'member.house_no',
        'member.fname',
        'member.lname',
        'member.phone',
        'rate.price_per_unit',
      ]);
  }

  // รวมข้อมูลบิล + ลูกบ้าน + เรทค่าน้ำ ให้เป็นก้อนเดียวที่หน้าเว็บใช้ได้เลย
  private toDetail(bill: BillEntity, row: Record<string, any>) {
    return {
      ...bill,
      // decimal ของ MySQL กลับมาเป็น string ต้องแปลงก่อนส่งให้หน้าเว็บ
      price_per_unit: row?.rate_price_per_unit != null ? Number(row.rate_price_per_unit) : null,
      meter_reading: row?.reading_id
        ? {
            id: row.reading_id,
            reading_date: row.reading_reading_date,
            meter_unit: row.reading_meter_unit,
          }
        : null,
      member: row?.member_id
        ? {
            id: row.member_id,
            house_no: row.member_house_no,
            fname: row.member_fname,
            lname: row.member_lname,
            phone: row.member_phone,
          }
        : null,
    };
  }

  // ดูบิลทั้งหมด (พร้อมข้อมูลลูกบ้านเจ้าของบิล)
  async findAll() {
    const { entities, raw } = await this.billDetailQuery()
      .orderBy('bill.create_date', 'DESC')
      .getRawAndEntities();

    return entities.map((bill, index) => this.toDetail(bill, raw[index]));
  }

  // ดูบิลตาม ID (พร้อมข้อมูลลูกบ้านเจ้าของบิล)
  async findOne(id: number) {
    const { entities, raw } = await this.billDetailQuery()
      .where('bill.id = :id', { id })
      .getRawAndEntities();

    if (!entities.length) {
      throw new NotFoundException(`ไม่พบบิลหมายเลข ${id}`);
    }
    return this.toDetail(entities[0], raw[0]);
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