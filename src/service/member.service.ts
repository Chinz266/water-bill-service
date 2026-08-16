import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { MemberEntity } from 'src/entity/member.entity';
import { MeterReadingEntity } from 'src/entity/meter-reading.entity';
import { BillEntity } from 'src/entity/bill.entity';
import { AccountMemberEntity } from 'src/entity/account-member.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MemberRemoveDto } from 'src/dto/member-remove.dto';
import { CreateMemberDto } from 'src/dto/member-create.dto';
import { RegisterMemberOnsiteDto } from 'src/dto/member-onsite.dto';
import { MeterPhotoService } from './meter-photo.service';

@Injectable()
export class MemberService {
  constructor(
    @InjectRepository(MemberEntity)
    private memberRepository: Repository<MemberEntity>,
    @InjectRepository(MeterReadingEntity)
    private meterReadingRepository: Repository<MeterReadingEntity>,
    @InjectRepository(BillEntity)
    private billRepository: Repository<BillEntity>,
    private readonly meterPhotoService: MeterPhotoService,
  ) {}

  findAll(): Promise<MemberEntity[]> {
    return this.memberRepository.find();
  }

  // ดึงข้อมูลสมาชิกตาม ID
  findOne(id: number): Promise<MemberEntity | null> {
    return this.memberRepository.findOneBy({ id });
  }

  /**
   * พิกัดต้องอยู่ในช่วงที่ถูกต้องก่อนลงฐานข้อมูล
   *
   * คอลัมน์เป็น decimal ที่มีที่ให้พอดีกับช่วงจริง (lat ±90, lng ±180)
   * ค่าที่เกินช่วง — พิมพ์ผิด หรือสลับ lat/lng กัน ซึ่งเกิดบ่อยมาก —
   * จะทำให้ MySQL โยน error 1264 ออกมาเป็น 500 ที่ผู้ใช้อ่านไม่รู้เรื่อง
   * โปรเจกต์นี้ยังไม่ได้เปิด global ValidationPipe จึงต้องดักเองที่ชั้น service
   */
  private assertCoordinates(
    latitude?: number | null,
    longitude?: number | null,
  ): void {
    const check = (
      value: number | null | undefined,
      label: string,
      limit: number,
    ) => {
      if (value === undefined || value === null || (value as unknown) === '') {
        return;
      }
      const num = Number(value);
      if (!Number.isFinite(num) || Math.abs(num) > limit) {
        throw new UnprocessableEntityException(
          `${label}ต้องเป็นตัวเลขระหว่าง -${limit} ถึง ${limit} ครับ`,
        );
      }
    };

    check(latitude, 'ละติจูด', 90);
    check(longitude, 'ลองจิจูด', 180);
  }

  // สร้างสมาชิกใหม่
  async create(userData: CreateMemberDto): Promise<MemberEntity> {
    let newMember = new MemberEntity();

    this.assertCoordinates(userData.latitude, userData.longitude);

    // 🌟 กันซ้ำที่ "บ้านเลขที่" อย่างเดียว เพราะ 1 บ้าน = 1 มิเตอร์ = 1 บิล
    //    ไม่กันชื่อ/เบอร์ซ้ำ เพราะในหมู่บ้านมีคนชื่อ-นามสกุลเหมือนกัน (ญาติกัน)
    //    และหลายบ้านใช้เบอร์ติดต่อเดียวกันได้ (คนเดียวดูแลหลายหลัง)
    if (userData.house_no && userData.house_no.trim() !== '') {
      const houseNo = userData.house_no.trim();
      const existing = await this.memberRepository.findOneBy({
        house_no: houseNo,
      });
      if (existing) {
        throw new UnprocessableEntityException(
          `บ้านเลขที่ ${houseNo} มีอยู่ในระบบแล้ว`,
        );
      }
    }

    // 1. สร้าง Instance ของ Entity ก่อน
    // 🌟 คอลัมน์จริงใน DB สะกดว่า craete_by (ไม่ใช่ create_by) และห้ามเป็น NULL
    //    ถ้าไม่ map ตรงนี้ ค่าจะหล่นหายแล้ว MySQL จะโยน 500 ออกมา
    const { create_by, ...memberData } = userData;
    const memberToSave = this.memberRepository.create({
      ...memberData,
      house_no: memberData.house_no?.trim(),
      craete_by: create_by,
      craeta_date: new Date(),
    });
    // 2. แล้วค่อยบันทึก
    newMember = await this.memberRepository.save(memberToSave);
    return newMember;
  }

  /**
   * พิกัดที่คลาดเคลื่อนเกินนี้ใช้แยกบ้านไม่ได้อยู่แล้ว — มิเตอร์ห่างกัน 4-20 ม.
   * (ทาวน์โฮมหน้าแคบอยู่ปลายล่างของช่วง ระยะเดินจริงต่อมิเตอร์เฉลี่ย 10-15 ม.)
   *
   * ═══ ทำไมเข้มกว่าตอนจดมิเตอร์ ═══
   *
   * พิกัดจากตรงนี้เป็น "จุดอ้างอิง" ที่ทุกครั้งของการจดในอนาคตจะถูกเทียบเข้าหา
   * ความคลาดเคลื่อนจึงบวกกันสองชั้น: √(อ้างอิง² + ตอนจด²) ตอนจดคลาดได้ถึง 30 ม.
   * ถ้าปล่อยอ้างอิงไว้ที่ 50 จะได้ √(50² + 30²) ≈ 58 ม. ซึ่งเกิน GPS_NEAR_M (50 ม.)
   * ของ ScanBatchService ไปแล้ว แปลว่า band "ใกล้" ไม่การันตีอะไรเลยในเคสแย่สุด
   * ตั้งไว้ 20 จะเหลือ √(20² + 30²) ≈ 36 ม. อยู่ในระยะที่ยังตัดสินได้
   *
   * ยอมเข้มได้เพราะเป็นการวัดครั้งเดียวต่อบ้าน ยืนรอสัญญาณนิ่งได้
   * ต่างจากตอนจดเดือนละครั้งที่ต้องเดินให้ครบทั้งหมู่บ้าน
   */
  private static readonly MAX_ACCEPTABLE_ACCURACY_M = 20;

  /**
   * ลงทะเบียนลูกบ้านแบบยืนอยู่หน้ามิเตอร์ — สร้างทั้งบ้านและการจดครั้งแรกในทรานแซกชันเดียว
   *
   * การจดครั้งแรกที่สร้างขึ้นนี้คือสิ่งที่ BillsService.getPreviousUnit() มองหา
   * เป็นลำดับที่ 2 (source: 'registration') อยู่แล้ว จึงต่อกันได้พอดีโดยไม่ต้องแก้ตรงนั้น
   *
   * เขียนสองตารางในทรานแซกชันเดียว ถ้าล้มกลางทางจะไม่เหลือบ้านที่ไม่มีเลขตั้งต้น
   * ซึ่งเป็นสภาพที่อันตรายกว่าไม่มีบ้านเลย (บิลใบแรกจะคิดจาก 0)
   */
  async registerOnsite(dto: RegisterMemberOnsiteDto): Promise<{
    member: MemberEntity;
    initial_reading: MeterReadingEntity;
  }> {
    this.assertCoordinates(dto.latitude, dto.longitude);

    if (dto.latitude === undefined || dto.longitude === undefined) {
      throw new UnprocessableEntityException(
        'ต้องบันทึกพิกัดขณะยืนอยู่หน้ามิเตอร์ด้วยครับ ไม่งั้นระบบจะจับคู่รูปกับบ้านหลังนี้ไม่ได้',
      );
    }

    // พิกัดที่ห่วยเกินไปรับไว้ก็เป็นภาระ — เก็บไปแล้วจะไปทำให้ค่ามัธยฐานเพี้ยน
    // และหลอกให้ระบบคิดว่ามีพิกัดอ้างอิงทั้งที่ใช้จริงไม่ได้ ให้รอสัญญาณนิ่งแล้วกดใหม่ดีกว่า
    if (
      dto.gps_accuracy_m !== undefined &&
      dto.gps_accuracy_m > MemberService.MAX_ACCEPTABLE_ACCURACY_M
    ) {
      throw new UnprocessableEntityException(
        `สัญญาณ GPS ยังไม่นิ่ง (คลาดเคลื่อน ±${Math.round(dto.gps_accuracy_m)} เมตร) กรุณารอสักครู่แล้วกดบันทึกพิกัดใหม่ครับ — ต้องไม่เกิน ${MemberService.MAX_ACCEPTABLE_ACCURACY_M} เมตร`,
      );
    }

    const initialUnit = Number(dto.initial_meter_unit);
    if (!Number.isInteger(initialUnit) || initialUnit < 0) {
      throw new UnprocessableEntityException(
        'เลขมิเตอร์ตั้งต้นต้องเป็นจำนวนเต็มไม่ติดลบครับ',
      );
    }

    const houseNo = dto.house_no?.trim();
    if (houseNo) {
      const existing = await this.memberRepository.findOneBy({
        house_no: houseNo,
      });
      if (existing) {
        throw new UnprocessableEntityException(
          `บ้านเลขที่ ${houseNo} มีอยู่ในระบบแล้ว`,
        );
      }
    }

    // เขียนไฟล์รูปก่อนเข้าทรานแซกชัน — การเขียนดิสก์ย้อนกลับพร้อม rollback ไม่ได้
    const photoPath = dto.meter_photo
      ? await this.meterPhotoService.save(dto.meter_photo, 0)
      : null;

    try {
      return await this.memberRepository.manager.transaction(
        async (manager) => {
          const now = new Date();

          const member = await manager.save(
            manager.create(MemberEntity, {
              fname: dto.fname,
              lname: dto.lname,
              house_no: houseNo,
              phone: dto.phone,
              latitude: dto.latitude,
              longitude: dto.longitude,
              villages_id: dto.villages_id,
              // 🌟 คอลัมน์จริงใน DB สะกดว่า craete_by / craeta_date
              craete_by: dto.create_by,
              craeta_date: now,
            }),
          );

          const initial_reading = await manager.save(
            manager.create(MeterReadingEntity, {
              reading_date: now,
              meter_unit: initialUnit,
              members_id: member.id,
              create_by: dto.create_by,
              create_date: now,
              latitude: dto.latitude,
              longitude: dto.longitude,
              gps_accuracy_m: dto.gps_accuracy_m ?? null,
              captured_at: now,
              ...(photoPath ? { evidence_photo: photoPath } : {}),
            }),
          );

          return { member, initial_reading };
        },
      );
    } catch (error) {
      // ลงทะเบียนไม่สำเร็จ รูปที่เพิ่งเขียนจึงไม่มีเจ้าของ เก็บกวาดก่อนโยนต่อ
      await this.meterPhotoService.remove(photoPath);
      throw error;
    }
  }

  // อัปเดตข้อมูลสมาชิก
  async update(userData: Partial<MemberEntity>): Promise<MemberEntity> {
    if (!userData.id) {
      throw new UnprocessableEntityException(
        `ต้องระบุ ID ของสมาชิกที่ต้องการแก้ไข`,
      );
    }

    const member = await this.memberRepository.findOneBy({ id: userData.id });
    if (!member) {
      throw new UnprocessableEntityException(
        `ไม่พบสมาชิกที่มี ID: ${userData.id}`,
      );
    }

    this.assertCoordinates(userData.latitude, userData.longitude);

    // 🌟 กันซ้ำที่บ้านเลขที่อย่างเดียว (ยกเว้นตัวเอง) — เหตุผลเดียวกับตอนสร้าง
    const houseNo = (userData.house_no ?? member.house_no)?.trim();
    if (houseNo) {
      const existing = await this.memberRepository.findOneBy({
        house_no: houseNo,
      });
      if (existing && existing.id !== member.id) {
        throw new UnprocessableEntityException(
          `บ้านเลขที่ ${houseNo} มีอยู่ในระบบแล้ว`,
        );
      }
    }

    const memberModify = this.memberRepository.merge(member, {
      ...userData,
      house_no: houseNo,
      modify_date: new Date(),
    });
    return await this.memberRepository.save(memberModify);
  }

  // ลบข้อมูลสมาชิก (พร้อมประวัติจดมิเตอร์และบิลทั้งหมดของบ้านหลังนี้)
  async remove(userData: MemberRemoveDto): Promise<void> {
    const member = await this.memberRepository.findOneBy({ id: userData.id });
    if (!member) {
      throw new UnprocessableEntityException(
        `ไม่พบสมาชิกที่มี ID: ${userData.id}`,
      );
    }

    // 🌟 ข้อมูลผูกกันเป็นลูกโซ่: บ้าน ← การจดมิเตอร์ ← บิล
    //    ต้องลบจากลูกสุด (บิล) ย้อนขึ้นมา ไม่งั้น MySQL จะกัน FK แล้วโยน 500
    //    ห่อไว้ใน transaction เดียว ถ้าพลาดกลางทางจะ rollback ทั้งหมด ไม่เหลือข้อมูลค้าง
    const readings = await this.meterReadingRepository.findBy({
      members_id: userData.id,
    });
    const readingIds = readings.map((r) => r.id);

    await this.memberRepository.manager.transaction(async (manager) => {
      if (readingIds.length > 0) {
        // 1. ลบบิลที่อ้างถึงการจดมิเตอร์ของบ้านนี้ก่อน
        await manager.delete(BillEntity, { meter_readings_id: In(readingIds) });
        // 2. แล้วลบการจดมิเตอร์
        await manager.delete(MeterReadingEntity, readingIds);
      }
      // 3. ตัดลิงก์บัญชีลูกบ้านที่ผูกกับบ้านนี้ (ถ้ามี) ไม่งั้นจะเหลือลิงก์ขยะชี้ไปบ้านที่หายไปแล้ว
      await manager.delete(AccountMemberEntity, { members_id: userData.id });
      // 4. สุดท้ายลบตัวบ้าน
      await manager.delete(MemberEntity, userData.id);
    });

    // 5. เก็บกวาดไฟล์รูปหลัง commit สำเร็จ — แถวที่อ้างถึงรูปพวกนี้ไม่เหลือแล้ว
    //    ทางลบบิล (BillsService.remove) ลบไฟล์ให้อยู่แล้ว แต่ทางลบบ้านเคยลบแค่แถวในตาราง
    //    รูปมิเตอร์ของบ้านนั้นทุกเดือนจึงค้างบนดิสก์ถาวรโดยไม่มีอะไรอ้างถึงอีกเลย
    //    ลบทีหลังเพราะการลบไฟล์ย้อนกลับพร้อม rollback ไม่ได้ — ถ้าทรานแซกชันล้ม
    //    รูปต้องยังอยู่ครบคู่กับข้อมูลที่ยังไม่ได้ลบ
    for (const reading of readings) {
      await this.meterPhotoService.remove(reading.evidence_photo);
    }
  }
}
