import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { MeterEntity } from '../entity/meter.entity';
import { MemberEntity } from '../entity/member.entity';
import { BillsService } from './bills.service';
import { RegisterMeterDto, ReplaceMeterDto } from '../dto/meter.dto';

/**
 * ทะเบียนมิเตอร์ของแต่ละบ้าน
 *
 * ═══ ทำไมการเปลี่ยนมิเตอร์ต้องเป็น endpoint ของตัวเอง ═══
 *
 * ของเดิมเรื่องนี้ถูกจัดการด้วยฟิลด์ `old_meter_final_unit` ที่ส่งมากับการออกบิล
 * ซึ่งพังในทางปฏิบัติ เพราะคนที่เปลี่ยนมิเตอร์ (ช่าง) กับคนที่เดินจดรอบถัดไป
 * มักไม่ใช่คนเดียวกันและห่างกันเป็นสัปดาห์ — คนจดไม่มีทางรู้เลขปิดของตัวที่ถูกถอดไปแล้ว
 *
 * บันทึกตอนเปลี่ยนแทน แล้วให้ BillsService ไปหยิบหน่วยค้างเองในบิลใบถัดไป
 * (ดู `pendingMeter` ใน prepareBill) หน่วยที่ใช้ก่อนถอดจึงไม่หายไม่ว่าใครจะไปจด
 */
@Injectable()
export class MetersService {
  constructor(
    @InjectRepository(MeterEntity)
    private readonly meterRepository: Repository<MeterEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    private readonly billsService: BillsService,
  ) {}

  /** มิเตอร์ทุกตัวของบ้านหลังนี้ ใหม่สุดขึ้นก่อน */
  async findByMember(membersId: number) {
    await this.assertMemberExists(membersId);

    return await this.meterRepository.find({
      where: { members_id: membersId },
      order: { installed_at: 'DESC', id: 'DESC' },
    });
  }

  /** ตัวที่ใช้อยู่ปัจจุบัน — null = บ้านหลังนี้ยังไม่เคยลงทะเบียนมิเตอร์ */
  async activeMeter(membersId: number): Promise<MeterEntity | null> {
    return await this.meterRepository.findOne({
      where: { members_id: membersId, removed_at: IsNull() },
      order: { installed_at: 'DESC', id: 'DESC' },
    });
  }

  /**
   * ลงทะเบียนมิเตอร์ตัวแรกของบ้าน (บ้านที่เข้าระบบก่อนมีตารางนี้)
   *
   * ไม่ไปยุ่งกับเลขตั้งต้นของบิลเลย — `getPreviousUnit()` ยังหาจากบิล/การจดเหมือนเดิม
   * ตารางนี้เก็บ "ตัวตนของมิเตอร์" ไม่ใช่ "เลขที่ใช้คิดเงิน" สองเรื่องนี้ต้องแยกกัน
   * ไม่งั้นการแก้ข้อมูลทะเบียนจะไปขยับยอดเงินย้อนหลังโดยไม่มีใครตั้งใจ
   */
  async register(dto: RegisterMeterDto): Promise<MeterEntity> {
    await this.assertMemberExists(dto.members_id);

    const existing = await this.activeMeter(dto.members_id);
    if (existing) {
      throw new BadRequestException(
        `บ้านหลังนี้มีมิเตอร์ที่ใช้งานอยู่แล้ว (รหัส ${existing.id}) ถ้าต้องการเปลี่ยนตัวใหม่ให้ใช้เมนูเปลี่ยนมิเตอร์ครับ`,
      );
    }

    const installed_at = this.parseDate(dto.installed_at, 'วันที่ติดตั้ง');
    const initial_unit = this.parseUnit(dto.initial_unit ?? 0, 'เลขตั้งต้น');

    return await this.meterRepository.save(
      this.meterRepository.create({
        members_id: dto.members_id,
        serial_no: dto.serial_no?.trim() || null,
        digits: this.parseDigits(dto.digits),
        installed_at,
        initial_unit,
        note: dto.note?.trim() || null,
        create_by: dto.create_by ?? null,
      }),
    );
  }

  /**
   * เปลี่ยนมิเตอร์ใหม่ — ปิดทะเบียนตัวเก่าและเปิดตัวใหม่ในทรานแซกชันเดียว
   *
   * ต้องอยู่ในทรานแซกชันเดียวเพราะสภาพครึ่ง ๆ อันตรายทั้งสองทาง:
   *   - ปิดตัวเก่าแล้วเปิดตัวใหม่ไม่สำเร็จ → บ้านนี้ไม่มีมิเตอร์ที่ใช้งานอยู่
   *   - เปิดตัวใหม่แล้วปิดตัวเก่าไม่สำเร็จ → มีสองตัวพร้อมกัน แล้ว activeMeter()
   *     จะหยิบตัวไหนก็ได้ ซึ่งทำให้การจดถูกผูกกับมิเตอร์ผิดตัว
   */
  async replace(dto: ReplaceMeterDto): Promise<{
    removed: MeterEntity;
    installed: MeterEntity;
    residual_unit: number;
  }> {
    await this.assertMemberExists(dto.members_id);

    const current = await this.activeMeter(dto.members_id);
    if (!current) {
      throw new BadRequestException(
        'บ้านหลังนี้ยังไม่มีมิเตอร์ที่ใช้งานอยู่ในทะเบียน กรุณาลงทะเบียนมิเตอร์ตัวปัจจุบันก่อนครับ',
      );
    }

    const replaced_at = this.parseDate(dto.replaced_at, 'วันที่เปลี่ยน');
    const final_unit = this.parseUnit(
      dto.old_final_unit,
      'เลขปิดของมิเตอร์ตัวเก่า',
    );
    const new_initial_unit = this.parseUnit(
      dto.new_initial_unit ?? 0,
      'เลขตั้งต้นของมิเตอร์ตัวใหม่',
    );

    // เลขปิดต้องไม่ต่ำกว่าเลขตั้งต้นของตัวเอง ไม่งั้นหน่วยที่ใช้จะติดลบ
    if (final_unit < Number(current.initial_unit)) {
      throw new BadRequestException(
        `เลขปิดของมิเตอร์ตัวเก่า (${final_unit.toLocaleString('th-TH')}) น้อยกว่าเลขตอนติดตั้ง (${Number(current.initial_unit).toLocaleString('th-TH')}) กรุณาตรวจสอบอีกครั้งครับ`,
      );
    }

    // เตือนล่วงหน้าว่าหน่วยค้างก้อนนี้จะไปโผล่ในบิลใบไหน — ตัวเลขที่คนกรอกควรได้เห็น
    const baseline = await this.billsService
      .getPreviousUnit(
        dto.members_id,
        String(replaced_at.getMonth() + 1).padStart(2, '0'),
        String(replaced_at.getFullYear()),
      )
      .catch(() => ({ previous_unit: 0 }));

    const residual_unit = Math.max(0, final_unit - baseline.previous_unit);

    return await this.meterRepository.manager.transaction(async (manager) => {
      await manager.update(MeterEntity, current.id, {
        removed_at: replaced_at,
        final_unit,
        note: dto.note?.trim() || current.note,
      });

      const installed = await manager.save(
        manager.create(MeterEntity, {
          members_id: dto.members_id,
          serial_no: dto.new_serial_no?.trim() || null,
          digits: this.parseDigits(dto.new_digits),
          installed_at: replaced_at,
          initial_unit: new_initial_unit,
          note: dto.note?.trim() || null,
          create_by: dto.create_by ?? null,
        }),
      );

      const removed = await manager.findOne(MeterEntity, {
        where: { id: current.id },
      });

      return { removed: removed!, installed, residual_unit };
    });
  }

  private async assertMemberExists(membersId: number): Promise<void> {
    const member = await this.memberRepository.findOne({
      where: { id: membersId },
    });
    if (!member) {
      throw new NotFoundException(`ไม่พบบ้านรหัส ${membersId} ในระบบ`);
    }
  }

  /**
   * 'YYYY-MM-DD' ต้องแยกเลขมาสร้างเอง ห้ามโยนเข้า new Date() ตรง ๆ
   * เพราะสเปกกำหนดให้ string รูปแบบนั้นถูกตีความเป็น UTC เที่ยงคืน แล้วขอบวันจะเคลื่อนไป 1 วัน
   * (เหตุผลเดียวกับ BillsService.parseReadingDate)
   */
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

  private parseUnit(value: number | undefined, label: string): number {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      throw new BadRequestException(`${label}ต้องเป็นจำนวนเต็มไม่ติดลบครับ`);
    }
    return num;
  }

  /** จำนวนหลักบนหน้าปัด — มิเตอร์จริงมี 4-8 หลัก ค่านอกช่วงนี้คือกรอกผิด */
  private parseDigits(value: number | undefined): number | null {
    if (value === undefined || value === null) return null;

    const num = Number(value);
    if (!Number.isInteger(num) || num < 3 || num > 10) {
      throw new BadRequestException(
        `จำนวนหลักบนหน้าปัด "${String(value)}" ไม่ถูกต้อง ต้องเป็นจำนวนเต็ม 3-10 ครับ`,
      );
    }
    return num;
  }
}
