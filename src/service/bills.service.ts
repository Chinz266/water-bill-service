import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillEntity } from 'src/entity/bill.entity';
import { WaterRateEntity } from '../entity/water-rate.entity'; // ปรับ Path ให้ตรงกับโฟลเดอร์ของคุณ
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { MemberEntity } from '../entity/member.entity';
import { CreateBillDto } from 'src/dto/create-bill.dto';
import { CreateBillFromScanDto } from 'src/dto/create-bill-from-scan.dto';
import { MeterPhotoService } from './meter-photo.service';

@Injectable()
export class BillsService {
  constructor(
    @InjectRepository(BillEntity)
    private readonly billRepository: Repository<BillEntity>,

    @InjectRepository(WaterRateEntity)
    private readonly waterRateRepository: Repository<WaterRateEntity>, // เรียกใช้ตารางเรทค่าน้ำ

    @InjectRepository(MeterReadingEntity)
    private readonly meterReadingRepository: Repository<MeterReadingEntity>,

    private readonly meterPhotoService: MeterPhotoService,
  ) {}

  /**
   * บิลของบ้านหลังนี้ในเดือน/ปีที่ระบุ (ถ้ามี)
   *
   * ตาราง bills ไม่มี members_id ต้องไล่ผ่าน meter_readings เอา
   * ด้วยเหตุนี้จึงบังคับ "1 บ้าน = 1 บิลต่อเดือน" ด้วย unique index ระดับ DB ไม่ได้
   * ต้องกันที่ชั้น service แทน
   */
  async findByMemberAndMonth(
    membersId: number,
    billing_month: string,
    billing_year: string,
  ) {
    return await this.billRepository
      .createQueryBuilder('bill')
      .innerJoin(
        MeterReadingEntity,
        'reading',
        'reading.id = bill.meter_readings_id',
      )
      .where('reading.members_id1 = :membersId', { membersId })
      .andWhere('bill.billing_month = :billing_month', { billing_month })
      .andWhere('bill.billing_year = :billing_year', { billing_year })
      .getOne();
  }

  /** '2026' + '07' → 202607 ใช้เทียบว่าเดือนไหนมาก่อนมาหลัง (เทียบ string ตรง ๆ จะพลาดตอนข้ามปี) */
  private monthKey(year: string | number, month: string | number): number {
    return Number(year) * 100 + Number(month);
  }

  /** บิลทุกใบของบ้านหลังนี้ เรียงจากเดือนเก่าไปใหม่ */
  private async billsOfMember(membersId: number) {
    const bills = await this.billRepository
      .createQueryBuilder('bill')
      .innerJoin(
        MeterReadingEntity,
        'reading',
        'reading.id = bill.meter_readings_id',
      )
      .where('reading.members_id1 = :membersId', { membersId })
      .getMany();

    return bills.sort(
      (a, b) =>
        this.monthKey(a.billing_year, a.billing_month) -
        this.monthKey(b.billing_year, b.billing_month),
    );
  }

  /**
   * เลขตั้งต้นที่ใช้คิดหน่วยน้ำของเดือนที่ระบุ — จุดเดียวที่ตัดสินเรื่องนี้
   * ทั้ง create() และหน้าสแกนเรียกตัวนี้ ตัวเลขบนจอกับยอดที่ออกจริงจะได้ตรงกันเสมอ
   *
   * ลำดับการหา:
   *   1. เลขปิดของบิลใบล่าสุดที่เดือนเก่ากว่า
   *   2. ไม่มีบิลเลย → เลขมิเตอร์ ณ วันลงทะเบียนบ้าน (การจดครั้งแรกสุดของบ้านหลังนี้)
   *   3. ไม่ได้กรอกไว้ตอนลงทะเบียนด้วย → 0
   *
   * ข้อ 2 สำคัญ ถ้าข้ามไปใช้ 0 บ้านที่มิเตอร์เดินมาแล้ว 2,000 หน่วยก่อนเข้าระบบ
   * จะโดนคิดค่าน้ำย้อนหลังทั้ง 2,000 หน่วยในบิลใบแรก
   */
  async getPreviousUnit(
    membersId: number,
    billing_month: string,
    billing_year: string,
    excludeReadingId?: number,
  ): Promise<{
    previous_unit: number;
    source: 'bill' | 'registration' | 'none';
    bill: BillEntity | null;
  }> {
    const targetKey = this.monthKey(billing_year, billing_month);
    const bills = await this.billsOfMember(membersId);
    const previousBill =
      bills
        .filter(
          (b) => this.monthKey(b.billing_year, b.billing_month) < targetKey,
        )
        .pop() ?? null;

    if (previousBill) {
      return {
        previous_unit: Number(previousBill.current_unit),
        source: 'bill',
        bill: previousBill,
      };
    }

    // ต้องตัดการจดของรอบนี้ออก ไม่งั้นจะเอาเลขที่เพิ่งสแกนมาเป็นตัวตั้งของตัวเอง (ใช้ไป 0 หน่วย)
    const readings = await this.meterReadingRepository.find({
      where: { members_id: membersId },
      order: { reading_date: 'ASC', id: 'ASC' },
    });
    const baseReading = readings.find((r) => r.id !== excludeReadingId);

    return {
      previous_unit: baseReading ? Number(baseReading.meter_unit) : 0,
      source: baseReading ? 'registration' : 'none',
      bill: null,
    };
  }

  /** เพดานตายตัวสำหรับบ้านที่ยังไม่มีประวัติให้เทียบ — บ้านทั่วไปใช้กันเดือนละไม่กี่สิบหน่วย */
  private static readonly USAGE_HARD_CAP = 1000;
  /** กี่เท่าของค่าเฉลี่ยจึงถือว่าผิดปกติ */
  private static readonly USAGE_SPIKE_RATIO = 5;

  /**
   * กันเลขมิเตอร์ที่ AI อ่านผิดจนออกบิลมหาศาล
   *
   * ไม่บล็อกตายตัว เพราะบางทีก็ใช้เยอะจริง (ท่อแตก/เปิดลืม) แต่ต้องให้คนยืนยันก่อน
   * ไม่ใช่ผ่านไปเงียบ ๆ แล้วไปโผล่เป็นบิลที่ลูกบ้านต้องจ่าย
   */
  private assertUsageLooksSane(
    usage_unit: number,
    previousBills: BillEntity[],
    confirmHighUsage?: boolean,
  ) {
    if (confirmHighUsage) return;

    const history = previousBills
      .map((b) => Number(b.usage_unit))
      .filter((u) => u > 0);

    if (history.length > 0) {
      const avg = history.reduce((sum, u) => sum + u, 0) / history.length;
      // ต้องเกิน 50 หน่วยด้วย ไม่งั้นบ้านที่ปกติใช้ 2 หน่วย พอใช้ 11 หน่วยก็เด้งแล้ว
      if (usage_unit > avg * BillsService.USAGE_SPIKE_RATIO && usage_unit > 50) {
        throw new ConflictException(
          `หน่วยน้ำที่คำนวณได้ (${usage_unit.toLocaleString('th-TH')} หน่วย) สูงกว่าที่บ้านหลังนี้เคยใช้มาก (เฉลี่ย ${Math.round(avg).toLocaleString('th-TH')} หน่วย) กรุณาตรวจสอบเลขมิเตอร์อีกครั้ง ถ้าถูกต้องแล้วให้กดยืนยันครับ`,
        );
      }
      return;
    }

    if (usage_unit > BillsService.USAGE_HARD_CAP) {
      throw new ConflictException(
        `หน่วยน้ำที่คำนวณได้ (${usage_unit.toLocaleString('th-TH')} หน่วย) สูงผิดปกติ กรุณาตรวจสอบเลขมิเตอร์อีกครั้ง ถ้าถูกต้องแล้วให้กดยืนยันครับ`,
      );
    }
  }

  /**
   * ตรวจทุกเงื่อนไขและคำนวณยอด — **ไม่เขียนอะไรลงฐานข้อมูลเลย**
   *
   * แยกออกมาเพื่อให้ createFromScan() ตรวจให้จบก่อนแล้วค่อยเขียน
   * ของเดิมสร้าง meter_readings ไปก่อนแล้วค่อยตรวจตอนสร้างบิล พอตรวจไม่ผ่าน
   * แถวที่จดไปแล้วก็ค้างเป็นขยะ (เคยเจอบ้านเดียวจด 4 ครั้ง ได้บิล 2 ใบ)
   */
  private async prepareBill(params: {
    membersId: number;
    water_rates_id: number;
    current_unit: number;
    billing_month: string;
    billing_year: string;
    replace?: boolean;
    confirm_high_usage?: boolean;
    excludeReadingId?: number;
  }) {
    const rate = await this.waterRateRepository.findOne({
      where: { id: params.water_rates_id },
    });
    if (!rate) {
      throw new NotFoundException('ไม่พบข้อมูลเรทค่าน้ำที่ระบุในระบบ');
    }

    // 1 บ้าน ต้องมีบิลได้เดือนละใบเดียว ไม่งั้นลูกบ้านโดนเก็บซ้ำ
    const existing = await this.findByMemberAndMonth(
      params.membersId,
      params.billing_month,
      params.billing_year,
    );

    if (existing) {
      // จ่ายเงินแล้วห้ามทับเด็ดขาด — ลบทิ้งเท่ากับหลักฐานการรับเงินหายไปด้วย
      if (existing.payment_status === 'Paid') {
        throw new ConflictException(
          `บ้านหลังนี้มีบิลเดือน ${params.billing_month}/${params.billing_year} ที่ชำระเงินแล้ว ไม่สามารถจดทับได้ครับ`,
        );
      }
      if (!params.replace) {
        throw new ConflictException(
          `บ้านหลังนี้ออกบิลเดือน ${params.billing_month}/${params.billing_year} ไปแล้ว (${Number(existing.total_amount).toLocaleString('th-TH')} บาท) ถ้าต้องการจดใหม่ให้กดจดทับของเดิมครับ`,
        );
      }
    }

    const targetKey = this.monthKey(params.billing_year, params.billing_month);
    const otherBills = (await this.billsOfMember(params.membersId)).filter(
      (b) => b.id !== existing?.id,
    );

    const laterBill = otherBills.find(
      (b) => this.monthKey(b.billing_year, b.billing_month) > targetKey,
    );
    if (laterBill) {
      // แทรกบิลย้อนหลังเข้าไปข้างหน้าใบที่ใหม่กว่า = ใบที่ใหม่กว่ามีเลขตั้งต้นผิดทันที
      throw new ConflictException(
        `บ้านหลังนี้มีบิลเดือน ${laterBill.billing_month}/${laterBill.billing_year} ซึ่งใหม่กว่าเดือนที่กำลังจะออกอยู่แล้ว ถ้าต้องการออกบิลย้อนหลังต้องลบบิลที่ใหม่กว่าออกก่อนครับ`,
      );
    }

    const { previous_unit } = await this.getPreviousUnit(
      params.membersId,
      params.billing_month,
      params.billing_year,
      params.excludeReadingId,
    );

    if (params.current_unit < previous_unit) {
      throw new BadRequestException(
        `เลขมิเตอร์ที่จด (${params.current_unit}) น้อยกว่าเลขตั้งต้นของเดือนก่อน (${previous_unit}) กรุณาตรวจสอบตัวเลขอีกครั้งครับ`,
      );
    }

    const usage_unit = params.current_unit - previous_unit;
    this.assertUsageLooksSane(usage_unit, otherBills, params.confirm_high_usage);

    return {
      rate,
      existing,
      previous_unit,
      usage_unit,
      // price_per_unit เป็น decimal ใน MySQL ซึ่ง TypeORM คืนมาเป็น string ('15.00') ต้องแปลงก่อนคูณ
      total_amount: usage_unit * Number(rate.price_per_unit),
    };
  }

  /**
   * จดมิเตอร์ + ออกบิล ในคำสั่งเดียว
   *
   * ตรวจให้ผ่านก่อนค่อยเขียน แล้วเขียนทั้งสองตารางในทรานแซกชันเดียว
   * ถ้าล้มกลางทางจะไม่เหลือ meter_readings ค้าง และไม่มีบิลที่ไม่มีการจดรองรับ
   */
  async createFromScan(dto: CreateBillFromScanDto) {
    const prep = await this.prepareBill({
      membersId: dto.members_id,
      water_rates_id: dto.water_rates_id,
      current_unit: dto.current_unit,
      billing_month: dto.billing_month,
      billing_year: dto.billing_year,
      replace: dto.replace,
      confirm_high_usage: dto.confirm_high_usage,
    });

    // เขียนไฟล์รูปก่อนเข้าทรานแซกชัน — การเขียนดิสก์ย้อนกลับพร้อม rollback ไม่ได้
    // ถ้า DB ล้มทีหลังต้องตามลบไฟล์เอง (ดู catch ข้างล่าง) ไม่งั้นเหลือไฟล์ที่ไม่มีใครอ้างถึง
    const photoPath = dto.meter_photo
      ? await this.meterPhotoService.save(dto.meter_photo, dto.members_id)
      : null;

    // รูปของการจดครั้งก่อนที่กำลังจะถูกทับ — เก็บ path ไว้ก่อนแถวถูกลบ
    // ลบไฟล์จริงหลัง commit สำเร็จ ถ้าลบก่อนแล้ว rollback รูปเดิมจะหายทั้งที่บิลยังอยู่
    const replacedPhoto = prep.existing
      ? (
          await this.meterReadingRepository.findOne({
            where: { id: prep.existing.meter_readings_id },
          })
        )?.evidence_photo
      : null;

    let bill: BillEntity;
    try {
      bill = await this.billRepository.manager.transaction(async (manager) => {
        // สั่งทับ = ลบใบเดิม + การจดที่ผูกอยู่ทิ้งก่อน
        if (prep.existing) {
          const oldBill = prep.existing;
          await manager.delete(BillEntity, oldBill.id);
          const stillUsed = await manager.count(BillEntity, {
            where: { meter_readings_id: oldBill.meter_readings_id },
          });
          if (stillUsed === 0) {
            await manager.delete(MeterReadingEntity, oldBill.meter_readings_id);
          }
        }

        const now = new Date();
        const reading = await manager.save(
          manager.create(MeterReadingEntity, {
            reading_date: dto.reading_date ? new Date(dto.reading_date) : now,
            meter_unit: dto.current_unit,
            members_id: dto.members_id,
            create_by: dto.create_by,
            create_date: now,
            // รูปผูกกับ "การจดครั้งนี้" ไม่ใช่กับบิล เพราะบิลออกใหม่ทับได้
            // แต่การจดคือเหตุการณ์ที่เกิดครั้งเดียวและรูปเป็นหลักฐานของเหตุการณ์นั้น
            ...(photoPath ? { evidence_photo: photoPath } : {}),
          }),
        );

        const newBill = manager.create(BillEntity, {
          meter_readings_id: reading.id,
          water_rates_id: dto.water_rates_id,
          previous_unit: prep.previous_unit,
          current_unit: dto.current_unit,
          usage_unit: prep.usage_unit,
          total_amount: prep.total_amount,
          billing_month: dto.billing_month,
          billing_year: dto.billing_year,
          payment_status: 'Pending' as const,
          create_by: dto.create_by,
          create_date: now,
        });

        return await manager.save(newBill);
      });
    } catch (error) {
      // บิลไม่ได้ออก รูปที่เพิ่งเขียนจึงไม่มีเจ้าของ เก็บกวาดก่อนโยน error ต่อ
      await this.meterPhotoService.remove(photoPath);
      throw error;
    }

    await this.meterPhotoService.remove(replacedPhoto);
    return bill;
  }

  // ฟังก์ชันสร้างบิลพร้อมคำนวณอัตโนมัติ
  async create(createBillDto: CreateBillDto) {
    // 2. ดึงเรทค่าน้ำจาก Database มาเพื่อความชัวร์ (ไม่เชื่อใจราคาที่อาจถูกส่งมาจากหน้าบ้าน)
    const rate = await this.waterRateRepository.findOne({
      where: { id: createBillDto.water_rates_id },
    });

    if (!rate) {
      throw new NotFoundException('ไม่พบข้อมูลเรทค่าน้ำที่ระบุในระบบ');
    }

    // 2.5 กันออกบิลซ้ำเดือน — 1 บ้าน ต้องมีบิลได้เดือนละใบเดียวเท่านั้น
    //     ถ้าไม่กัน สแกนบ้านเดิมสองรอบในเดือนเดียวจะได้บิลสองใบ ลูกบ้านโดนเก็บซ้ำ
    //     และใบที่สองจะเอาเลขของการสแกนรอบแรกมาเป็นตัวตั้ง ยอดเลยเกือบศูนย์
    const reading = await this.meterReadingRepository.findOne({
      where: { id: createBillDto.meter_readings_id },
    });
    if (!reading) {
      throw new NotFoundException('ไม่พบข้อมูลการจดมิเตอร์ที่อ้างถึง');
    }

    const existing = await this.findByMemberAndMonth(
      reading.members_id,
      createBillDto.billing_month,
      createBillDto.billing_year,
    );

    if (existing) {
      // จ่ายเงินแล้วห้ามทับเด็ดขาด — ลบทิ้งเท่ากับหลักฐานการรับเงินหายไปด้วย
      // ต้องให้คนตัดสินใจเอง (ปรับสถานะกลับเป็นค้างชำระก่อน แล้วค่อยจดใหม่)
      if (existing.payment_status === 'Paid') {
        throw new ConflictException(
          `บ้านหลังนี้มีบิลเดือน ${createBillDto.billing_month}/${createBillDto.billing_year} ที่ชำระเงินแล้ว ไม่สามารถจดทับได้ครับ`,
        );
      }

      if (!createBillDto.replace) {
        throw new ConflictException(
          `บ้านหลังนี้ออกบิลเดือน ${createBillDto.billing_month}/${createBillDto.billing_year} ไปแล้ว (${Number(existing.total_amount).toLocaleString('th-TH')} บาท) ถ้าต้องการจดใหม่ให้กดจดทับของเดิมครับ`,
        );
      }

      // สั่งทับ = ลบใบเดิมทิ้งก่อน (remove() ลบการจดมิเตอร์ที่ผูกอยู่ให้ด้วย
      // ถ้าปล่อยไว้ บิลเดือนถัดไปจะเอาเลขของใบที่ถูกลบมาเป็นตัวตั้ง)
      await this.remove(existing.id);
    }

    // 2.6 หาเลขตั้งต้นเอง ไม่เชื่อ previous_unit ที่หน้าเว็บส่งมา
    //     หน้าเว็บเดิมส่ง "การจดครั้งล่าสุด" มาเสมอ ซึ่งผิดทันทีที่จดย้อนหลัง:
    //     ออกบิล ก.ค. (2000→2439) แล้วย้อนไปออกบิล มิ.ย. จะได้ 2000→2439 ซ้ำอีกใบ
    //     บ้านหลังนั้นโดนเก็บค่าน้ำก้อนเดียวกันสองรอบ
    //     ตัวตั้งที่ถูกคือ "เลขปิดของบิลเดือนก่อนหน้าเดือนที่กำลังออก"
    const targetKey = this.monthKey(
      createBillDto.billing_year,
      createBillDto.billing_month,
    );
    const otherBills = (await this.billsOfMember(reading.members_id)).filter(
      (b) => b.id !== existing?.id,
    );

    const laterBill = otherBills.find(
      (b) => this.monthKey(b.billing_year, b.billing_month) > targetKey,
    );
    if (laterBill) {
      // ถ้ายอมให้แทรกบิลย้อนหลังเข้าไปข้างหน้าใบที่ใหม่กว่า ใบที่ใหม่กว่าจะมีเลขตั้งต้นผิดทันที
      // และต้องคิดใหม่ทั้งสาย — บล็อกไว้ให้ลบใบที่ใหม่กว่าออกก่อนตรงไปตรงมากว่า
      throw new ConflictException(
        `บ้านหลังนี้มีบิลเดือน ${laterBill.billing_month}/${laterBill.billing_year} ซึ่งใหม่กว่าเดือนที่กำลังจะออกอยู่แล้ว ถ้าต้องการออกบิลย้อนหลังต้องลบบิลที่ใหม่กว่าออกก่อนครับ`,
      );
    }

    const { previous_unit } = await this.getPreviousUnit(
      reading.members_id,
      createBillDto.billing_month,
      createBillDto.billing_year,
      createBillDto.meter_readings_id,
    );

    if (createBillDto.current_unit < previous_unit) {
      throw new BadRequestException(
        `เลขมิเตอร์ที่จด (${createBillDto.current_unit}) น้อยกว่าเลขปิดของเดือนก่อน (${previous_unit}) กรุณาตรวจสอบตัวเลขอีกครั้งครับ`,
      );
    }

    // 3. คำนวณหาหน่วยที่ใช้ไป และยอดเงินรวม
    // price_per_unit เป็น decimal ใน MySQL ซึ่ง TypeORM คืนมาเป็น string ('15.00') ต้องแปลงก่อนคูณ
    const usage_unit = createBillDto.current_unit - previous_unit;

    // 3.5 ด่านกันเลขที่ AI อ่านผิด — เคยมีบิลที่ 50,000 กลายเป็น 252,131 (3 ล้านบาท) หลุดไปแล้ว
    //     เทียบกับค่าเฉลี่ยที่บ้านหลังนี้เคยใช้ บ้านใหม่ที่ยังไม่มีประวัติใช้เพดานตายตัวแทน
    this.assertUsageLooksSane(
      usage_unit,
      otherBills,
      createBillDto.confirm_high_usage,
    );

    const total_amount = usage_unit * Number(rate.price_per_unit);

    // 4. นำข้อมูลมาผูกรวมกัน โดยบังคับใช้ยอดที่เราคำนวณเอง
    //    ตัด replace / confirm_high_usage ทิ้งก่อน เป็นคำสั่งของ request ไม่ใช่คอลัมน์ในตาราง
    const {
      replace: _replace,
      confirm_high_usage: _confirm,
      ...billFields
    } = createBillDto;
    const newBill = this.billRepository.create({
      ...billFields,
      previous_unit: previous_unit, // เขียนทับด้วยเลขปิดของเดือนก่อนที่หาเอง
      usage_unit: usage_unit, // เขียนทับด้วยค่าที่คำนวณได้
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
      .leftJoin(
        MeterReadingEntity,
        'reading',
        'reading.id = bill.meter_readings_id',
      )
      .leftJoin(MemberEntity, 'member', 'member.id = reading.members_id')
      .leftJoin(WaterRateEntity, 'rate', 'rate.id = bill.water_rates_id')
      .addSelect([
        'reading.id',
        'reading.reading_date',
        'reading.meter_unit',
        // path รูปหน้าปัด (สั้น ๆ ไม่กี่สิบตัวอักษร) ดึงมาพร้อมบิลได้ไม่หนัก
        'reading.evidence_photo',
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
      price_per_unit:
        row?.rate_price_per_unit != null
          ? Number(row.rate_price_per_unit)
          : null,
      meter_reading: row?.reading_id
        ? {
            id: row.reading_id,
            reading_date: row.reading_reading_date,
            meter_unit: row.reading_meter_unit,
            // ตั้งชื่อ meter_photo ให้หน้าเว็บ ไม่ส่งชื่อคอลัมน์ evidence_photo ออกไปตรง ๆ
            // (เป็นแนวเดียวกับที่ API เปลี่ยน members_id1 → members_id และ creat_date → create_date)
            meter_photo: row.reading_evidence_photo ?? null,
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

  // ดูบิลของ "บ้านที่ระบุ" เท่านั้น — ใช้โดยพอร์ทัลลูกบ้าน (เห็นเฉพาะบ้านตัวเอง)
  //    memberIds มาจากตาราง account_members ของบัญชีที่ล็อกอินอยู่ ไม่ใช่จากผู้ใช้ส่งมาเอง
  async findAllForMembers(memberIds: number[]) {
    if (memberIds.length === 0) return [];

    const { entities, raw } = await this.billDetailQuery()
      .where('member.id IN (:...memberIds)', { memberIds })
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
    await this.billRepository.update(id, {
      payment_status: payment_status as any,
    });

    return await this.billRepository.findOne({ where: { id } });
  }

  async remove(id: number) {
    const bill = await this.billRepository.findOne({ where: { id } });
    if (!bill) {
      throw new NotFoundException(`ไม่พบบิลหมายเลข ${id}`);
    }

    // 🌟 บิลเกิดจากการจดมิเตอร์ 1 ครั้ง — ถ้าลบบิลแต่ทิ้งการจดไว้
    //    เลขมิเตอร์ "ครั้งก่อน" ของบ้านนั้นจะยังอ้างเลขที่ถูกยกเลิกไปแล้ว ทำให้บิลใบถัดไปคำนวณเพี้ยน
    //    จึงลบเป็นชุดเดียวกันใน transaction (เช็คก่อนว่าไม่มีบิลใบอื่นใช้การจดครั้งเดียวกันอยู่)
    let removedPhoto: string | null = null;

    await this.billRepository.manager.transaction(async (manager) => {
      await manager.delete(BillEntity, id);

      const otherBills = await manager.count(BillEntity, {
        where: { meter_readings_id: bill.meter_readings_id },
      });
      if (otherBills === 0) {
        // อ่าน path รูปไว้ก่อนลบแถว แล้วค่อยลบไฟล์หลัง commit
        const reading = await manager.findOne(MeterReadingEntity, {
          where: { id: bill.meter_readings_id },
        });
        removedPhoto = reading?.evidence_photo ?? null;

        await manager.delete(MeterReadingEntity, bill.meter_readings_id);
      }
    });

    await this.meterPhotoService.remove(removedPhoto);

    return { message: `ลบบิล ID ${id} สำเร็จเรียบร้อย!` };
  }
}
