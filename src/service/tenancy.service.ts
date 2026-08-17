import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { TenancyEntity } from '../entity/tenancy.entity';
import { MemberEntity } from '../entity/member.entity';
import { BillsService } from './bills.service';
import { MoveOutDto, StartTenancyDto } from '../dto/tenancy.dto';

/**
 * ผู้อยู่อาศัยแต่ละช่วง + บิลปิดยอดตอนย้ายออก
 *
 * ═══ ปัญหาที่แก้ ═══
 *
 * ระบบเดิมรู้จักแค่ "บ้าน" ค่าน้ำทั้งเดือนจึงตกกับใครก็ตามที่ชื่ออยู่ในทะเบียน
 * ตอนสิ้นเดือน — ผู้เช่าคนใหม่ที่ย้ายเข้าวันที่ 25 ได้บิลของทั้งเดือน รวมส่วนที่
 * คนเก่าใช้ไป 24 วัน ซึ่งเถียงกันไม่จบและคนเก่าก็ตามตัวไม่ได้แล้ว
 *
 * ═══ ทำไมผู้เช่าคนใหม่ไม่ต้องแก้อะไรเพิ่ม ═══
 *
 * `getPreviousUnit()` หยิบ "เลขปิดของบิลใบล่าสุด" เป็นเลขตั้งต้นอยู่แล้ว ซึ่งหลัง
 * ออกบิลปิดยอดก็คือเลข ณ วันย้ายออกพอดี — บิลใบแรกของคนใหม่จึงเริ่มนับจากตรงนั้นเอง
 */
@Injectable()
export class TenancyService {
  constructor(
    @InjectRepository(TenancyEntity)
    private readonly tenancyRepository: Repository<TenancyEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    private readonly billsService: BillsService,
  ) {}

  /** ประวัติผู้อยู่อาศัยของบ้านหลังนี้ ใหม่สุดขึ้นก่อน */
  async findByMember(membersId: number) {
    await this.assertMemberExists(membersId);

    return await this.tenancyRepository.find({
      where: { members_id: membersId },
      order: { start_date: 'DESC', id: 'DESC' },
    });
  }

  /** คนที่อยู่ปัจจุบัน — null = ยังไม่เคยบันทึก (บ้านเจ้าของอยู่เอง) */
  async current(membersId: number): Promise<TenancyEntity | null> {
    return await this.tenancyRepository.findOne({
      where: { members_id: membersId, end_date: IsNull() },
      order: { start_date: 'DESC', id: 'DESC' },
    });
  }

  /** เริ่มสัญญาของผู้อยู่อาศัยรายใหม่ (ปิดรายเดิมให้ก่อนถ้ายังค้างอยู่) */
  async start(dto: StartTenancyDto): Promise<TenancyEntity> {
    await this.assertMemberExists(dto.members_id);

    const name = dto.occupant_name?.trim();
    if (!name) {
      throw new BadRequestException('ต้องระบุชื่อผู้อยู่อาศัยครับ');
    }

    const start_date = this.parseDate(dto.start_date, 'วันที่เริ่มอยู่');
    const existing = await this.current(dto.members_id);

    return await this.tenancyRepository.manager.transaction(async (manager) => {
      // ปิดรายเดิมด้วยวันก่อนหน้าวันที่คนใหม่เข้าอยู่ — ห้ามให้ช่วงเวลาซ้อนกัน
      // ไม่งั้นบิลใบหนึ่งจะตอบไม่ได้ว่าเรียกเก็บจากใครในสองคนนั้น
      if (existing) {
        const endOfPrevious = new Date(start_date);
        endOfPrevious.setDate(endOfPrevious.getDate() - 1);
        await manager.update(TenancyEntity, existing.id, {
          end_date: endOfPrevious,
        });
      }

      return await manager.save(
        manager.create(TenancyEntity, {
          members_id: dto.members_id,
          occupant_name: name,
          phone: dto.phone?.trim() || null,
          start_date,
          create_by: dto.create_by ?? null,
        }),
      );
    });
  }

  /**
   * ย้ายออก — จดมิเตอร์ครั้งสุดท้าย ออกบิลปิดยอด แล้วปิดสัญญา
   *
   * ═══ ทำไม due_date เป็นวันย้ายออกเลย ไม่ยืดตามรอบชำระของหมู่บ้าน ═══
   *
   * รอบชำระปกติ (15 วัน) ตั้งอยู่บนสมมติฐานว่าคนยังอยู่บ้านหลังนั้น เดินไปจ่าย
   * ที่บ้านผู้ใหญ่บ้านเมื่อไหร่ก็ได้ — แต่คนที่ย้ายออกไปแล้วตามเก็บแทบไม่ได้
   * ยอดต้องเคลียร์ ณ วันที่ยังเจอตัวกันอยู่
   *
   * ═══ ทำไมทบยอดค้างเข้าใบนี้ทั้งหมด ═══
   *
   * เป็นใบสุดท้ายที่จะได้เรียกเก็บจากคนนี้ ถ้าไม่ทบ ยอดค้างเก่าจะตกไปอยู่กับ
   * ผู้เช่าคนถัดไปที่ไม่ได้ใช้น้ำก้อนนั้นเลย
   */
  async moveOut(dto: MoveOutDto) {
    await this.assertMemberExists(dto.members_id);

    const moved_at = this.parseDate(dto.moved_at, 'วันที่ย้ายออก');
    const tenancy = await this.current(dto.members_id);

    // ออกบิลด้วยเส้นทางเดิมทุกด่าน — ด่านกันเลขผิด/รูปซ้ำ/พิกัดยังทำงานครบ
    // ต่างแค่ธงว่าเป็นใบปิดยอดและกำหนดชำระที่ไม่ยืด
    const bill = await this.billsService.createFromScan(
      {
        members_id: dto.members_id,
        water_rates_id: dto.water_rates_id,
        current_unit: dto.current_unit,
        billing_month: String(moved_at.getMonth() + 1).padStart(2, '0'),
        billing_year: String(moved_at.getFullYear()),
        reading_date: this.toIso(moved_at),
        meter_photo: dto.meter_photo,
        entry_method: dto.entry_method,
        meter_digits: dto.meter_digits,
        read_confidence: dto.read_confidence,
        latitude: dto.latitude,
        longitude: dto.longitude,
        gps_accuracy_m: dto.gps_accuracy_m,
        captured_at: dto.captured_at,
        create_by: dto.create_by,
        confirm_high_usage: dto.confirm_high_usage,
        confirm_meter_reset: dto.confirm_meter_reset,
        confirm_digit_change: dto.confirm_digit_change,
        confirm_low_confidence: dto.confirm_low_confidence,
        confirm_duplicate_location: dto.confirm_duplicate_location,
        confirm_stale_photo: dto.confirm_stale_photo,
        replace: dto.replace,
      },
      {
        is_final: true,
        tenancy_id: tenancy?.id ?? null,
        due_date: moved_at,
      },
    );

    // ปิดสัญญาหลังออกบิลสำเร็จเท่านั้น — ปิดก่อนแล้วบิลตกด่าน จะเหลือบ้านที่
    // ไม่มีผู้อยู่อาศัยทั้งที่ยังไม่ได้เคลียร์ยอด แล้วไม่มีใครรู้ว่าต้องไปตามใคร
    let next: TenancyEntity | null = null;
    await this.tenancyRepository.manager.transaction(async (manager) => {
      if (tenancy) {
        await manager.update(TenancyEntity, tenancy.id, {
          end_date: moved_at,
        });
      }

      if (dto.new_occupant_name?.trim()) {
        const startNext = new Date(moved_at);
        startNext.setDate(startNext.getDate() + 1);

        next = await manager.save(
          manager.create(TenancyEntity, {
            members_id: dto.members_id,
            occupant_name: dto.new_occupant_name.trim(),
            phone: dto.new_occupant_phone?.trim() || null,
            start_date: startNext,
            create_by: dto.create_by ?? null,
          }),
        );
      }
    });

    return {
      message: `ออกบิลปิดยอด ณ วันที่ ${moved_at.toLocaleDateString('th-TH')} เรียบร้อยครับ`,
      bill,
      closed_tenancy: tenancy,
      next_tenancy: next,
      /** ยอดที่ต้องเก็บจากผู้ย้ายออก = ค่าน้ำงวดสุดท้าย + ยอดค้างเก่าทั้งหมด */
      amount_due: Number(bill.grand_total ?? bill.total_amount),
    };
  }

  private async assertMemberExists(membersId: number): Promise<void> {
    const member = await this.memberRepository.findOne({
      where: { id: membersId },
    });
    if (!member) {
      throw new NotFoundException(`ไม่พบบ้านรหัส ${membersId} ในระบบ`);
    }
  }

  private toIso(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** เหตุผลเดียวกับ BillsService.parseReadingDate — 'YYYY-MM-DD' ถูกตีความเป็น UTC */
  private parseDate(raw: string | undefined, label: string): Date {
    if (!raw) return new Date();

    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    const parsed = dateOnly
      ? new Date(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3]),
        )
      : new Date(raw);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `${label} "${raw}" ไม่ใช่วันที่ที่อ่านได้ กรุณาใช้รูปแบบ ปี-เดือน-วัน เช่น 2026-08-14 ครับ`,
      );
    }

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (parsed > endOfToday) {
      throw new BadRequestException(
        `${label} (${parsed.toLocaleDateString('th-TH')}) เป็นวันในอนาคต กรุณาตรวจสอบอีกครั้งครับ`,
      );
    }

    return parsed;
  }
}
