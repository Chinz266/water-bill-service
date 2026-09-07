import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AdminEntity } from 'src/entity/admin.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminRemoveDto } from 'src/dto/admin-remove.dto';

/** ข้อมูลผู้ดูแลที่ส่งออกทาง API ได้ — ไม่มี bcrypt hash ติดไปด้วย */
export type PublicAdmin = Omit<AdminEntity, 'password'>;

/** จำนวนรอบการ hash — ต้องตรงกับ AuthService ไม่งั้นบัญชีสองทางแข็งแรงไม่เท่ากัน */
const SALT_ROUNDS = 10;

/** bcrypt hash ขึ้นต้นด้วย $2a$ / $2b$ / $2y$ เสมอ (เหมือนที่ seed-admin.ts ใช้) */
const isHashed = (value: string): boolean => /^\$2[aby]\$/.test(value);

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(AdminEntity)
    private adminRepository: Repository<AdminEntity>,
  ) {}

  /**
   * 🌟 ระบุคอลัมน์ที่ส่งออกเสมอ — ห้ามคืน entity ทั้งก้อน
   *    find() เปล่า ๆ คืน `password` (bcrypt hash) ออกไปทาง API ด้วย
   *    hash ที่หลุดออกไปคือของที่เอาไป brute-force ออฟไลน์ได้ไม่จำกัดครั้ง
   *    (AuthService ตัดฟิลด์นี้ทิ้งอยู่แล้ว ที่นี่ยังตกหล่นอยู่)
   */
  private static readonly PUBLIC_COLUMNS = {
    id: true,
    fname: true,
    lname: true,
    email: true,
    phone: true,
    admin_role: true,
    photo: true,
    createDate: true,
    createBy: true,
    modifyBy: true,
    modifyDate: true,
  } as const;

  /** ตัด hash รหัสผ่านออกจากแถวที่เพิ่งบันทึก (save() คืน entity ทั้งก้อนกลับมา) */
  private static strip(admin: AdminEntity): PublicAdmin {
    const { password: _password, ...safe } = admin;
    return safe;
  }

  /**
   * 🌟 hash รหัสผ่านก่อนบันทึกเสมอ
   *
   * ของเดิม create()/update() โยน userData ที่รับมาจาก body ลง repository ตรง ๆ
   * รหัสผ่านจึงถูกเก็บเป็น **ข้อความธรรมดา** — ฐานข้อมูลรั่วเมื่อไหร่ก็อ่านได้ทันที
   * และเขียนทับ hash เดิมของบัญชีนั้นด้วย ทำให้ล็อกอินไม่ผ่านตลอดกาล
   * (AuthService.login เทียบด้วย bcrypt.compare ซึ่งไม่มีวันตรงกับ plaintext)
   *
   * เช็ค isHashed ก่อน เพราะ update() อาจได้ค่าที่ hash มาแล้วส่งกลับมาทั้งก้อน
   * การ hash ซ้ำจะทำให้รหัสเดิมใช้ไม่ได้
   */
  private static async withHashedPassword(
    userData: Partial<AdminEntity>,
  ): Promise<Partial<AdminEntity>> {
    if (!userData.password || isHashed(userData.password)) {
      return userData;
    }
    return {
      ...userData,
      password: await bcrypt.hash(userData.password, SALT_ROUNDS),
    };
  }

  findAll(): Promise<PublicAdmin[]> {
    return this.adminRepository.find({
      select: AdminService.PUBLIC_COLUMNS,
      order: { id: 'ASC' },
    });
  }

  // ดึงข้อมูลผู้ใช้ตาม ID
  findOne(id: number): Promise<PublicAdmin | null> {
    return this.adminRepository.findOne({
      where: { id },
      select: AdminService.PUBLIC_COLUMNS,
    });
  }

  // สร้างผู้ใช้ใหม่
  async create(userData: Partial<AdminEntity>): Promise<PublicAdmin> {
    let newAdmin = new AdminEntity();
    const admin = await this.adminRepository.findOneBy({
      fname: userData.fname,
      lname: userData.lname,
    });
    if (admin) {
      throw new UnprocessableEntityException(
        `แอดมิน: ${admin.fname} ${admin.lname} มีอยู่แล้ว`,
      );
    }
    // 🌟 เช็คเบอร์ซ้ำเฉพาะตอนที่มีเบอร์ส่งมาจริง — TypeORM โยน
    //    "Undefined value encountered in property 'AdminEntity.phone'" ถ้าส่ง undefined
    //    เข้าไปใน where (ผู้ดูแลที่ยังไม่ได้กรอกเบอร์เข้าเงื่อนไขนี้ทุกครั้ง)
    const adminByPhone = userData.phone
      ? await this.adminRepository.findOneBy({ phone: userData.phone })
      : null;
    if (adminByPhone) {
      throw new UnprocessableEntityException(
        `เบอร์โทรศัพท์: ${adminByPhone.phone} มีอยู่แล้ว`,
      );
    } else {
      // 1. สร้าง Instance ของ Entity ก่อน
      const adminToSave = this.adminRepository.create({
        ...(await AdminService.withHashedPassword(userData)),
        createDate: new Date(), // ในภาพของคุณพิมพ์ Date เป็น date ระวังเรื่องตัวพิมพ์เล็ก/ใหญ่ด้วยนะครับ
      });
      // 2. แล้วค่อยบันทึก
      newAdmin = await this.adminRepository.save(adminToSave);
    }
    return AdminService.strip(newAdmin);
  }

  async update(userData: Partial<AdminEntity>): Promise<PublicAdmin> {
    if (!userData.id) {
      throw new UnprocessableEntityException(
        `ต้องระบุ ID ของแอดมินที่ต้องการแก้ไข`,
      );
    }

    const admin = await this.adminRepository.findOneBy({ id: userData.id });
    if (!admin) {
      throw new UnprocessableEntityException(
        `ไม่พบแอดมินที่มี ID: ${userData.id}`,
      );
    }

    const fname = userData.fname ?? admin.fname;
    const lname = userData.lname ?? admin.lname;
    const phone = userData.phone ?? admin.phone;

    // 🌟 ทั้งสองด่านเช็คเฉพาะตอนที่มีค่าให้เช็คจริง — ส่ง undefined เข้า where
    //    TypeORM จะโยน "Undefined value encountered in property ..." ออกมาเป็น 500
    //    ซึ่งเกิดทุกครั้งที่แก้บัญชีที่ยังไม่ได้กรอกชื่อหรือเบอร์ (เช่นแอดมินคนแรกของระบบ)
    const adminByName =
      fname && lname
        ? await this.adminRepository.findOneBy({ fname, lname })
        : null;
    if (adminByName && adminByName.id !== admin.id) {
      throw new UnprocessableEntityException(
        `แอดมิน: ${adminByName.fname} ${adminByName.lname} มีอยู่แล้ว`,
      );
    }

    const adminByPhone = phone
      ? await this.adminRepository.findOneBy({ phone })
      : null;
    if (adminByPhone && adminByPhone.id !== admin.id) {
      throw new UnprocessableEntityException(
        `เบอร์โทรศัพท์: ${adminByPhone.phone} มีอยู่แล้ว`,
      );
    }

    const adminModify = this.adminRepository.merge(admin, {
      ...(await AdminService.withHashedPassword(userData)),
      modifyDate: new Date(),
    });
    return AdminService.strip(await this.adminRepository.save(adminModify));
  }

  // ลบข้อมูลผู้ใช้
  async remove(userData: AdminRemoveDto): Promise<void> {
    const admin = await this.adminRepository.findOneBy({ id: userData.id });
    if (!admin) {
      throw new UnprocessableEntityException(
        `ไม่พบแอดมินที่มี ID: ${userData.id}`,
      );
    }
    await this.adminRepository.delete(userData.id);
  }
}
