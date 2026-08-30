import {
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AdminEntity } from 'src/entity/admin.entity';
import { AccountEntity } from 'src/entity/account.entity';
import { MemberEntity } from 'src/entity/member.entity';
import { AccountMemberEntity } from 'src/entity/account-member.entity';
import { AuthRegisterDto } from 'src/dto/auth-register.dto';
import { AuthLoginDto } from 'src/dto/auth-login.dto';
import { MemberAuthDto } from 'src/dto/member-auth.dto';
import { AdminRole, JwtPayload, UserRole } from 'src/auth/auth.constants';

/** จำนวนรอบการ hash — 10 เป็นค่ามาตรฐานที่สมดุลระหว่างความปลอดภัยกับความเร็ว */
const SALT_ROUNDS = 10;

/**
 * ข้อมูลผู้ใช้ที่ส่งกลับหน้าบ้านได้ (ไม่มีรหัสผ่าน)
 *
 * รูปเดียวกันทั้งผู้ดูแลและลูกบ้าน แม้จะมาจากคนละตาราง — หน้าบ้านอ่าน user.role
 * ตัวเดียวแล้วแยกทางเอง ไม่ต้องรู้ว่าหลังบ้านเก็บสองทะเบียนแยกกัน
 * ฟิลด์ที่ลูกบ้านไม่มี (อีเมล/ชื่อ/รูป) ส่งเป็น null ไม่ใช่ตัดคีย์ทิ้ง
 */
export interface AuthUser {
  id: number;
  fname: string | null;
  lname: string | null;
  email: string | null;
  phone: string | null;
  role: UserRole;
  admin_role: AdminRole | null;
  photo: string | null;
  createDate: Date;
  createBy: number | null;
  modifyBy: number | null;
  modifyDate: Date | null;
}

/** รูปแบบที่ login/register คืนกลับ — หน้าบ้านเก็บ access_token ไว้แนบกับ request ถัดไป */
export interface AuthResult {
  access_token: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AdminEntity)
    private adminRepository: Repository<AdminEntity>,
    @InjectRepository(AccountEntity)
    private accountRepository: Repository<AccountEntity>,
    @InjectRepository(MemberEntity)
    private memberRepository: Repository<MemberEntity>,
    @InjectRepository(AccountMemberEntity)
    private accountMemberRepository: Repository<AccountMemberEntity>,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * 🌟 ตัดรหัสผ่านออกก่อนส่งกลับเสมอ
   *    ของเดิมคืน AdminEntity ทั้งก้อน ทำให้ hash รหัสผ่านหลุดออกไปทาง API response
   *
   * role มาจาก "ตารางที่บัญชีอยู่" ไม่ใช่ค่าในคอลัมน์ — แถวในตาราง admin คือผู้ดูแล
   * เสมอ ไม่มีทางเป็นอย่างอื่นได้อีกแล้วหลังแยกตาราง accounts ออกไป
   */
  private toAuthUser(admin: AdminEntity): AuthUser {
    return {
      id: admin.id,
      fname: admin.fname ?? null,
      lname: admin.lname ?? null,
      email: admin.email,
      phone: admin.phone,
      role: 'admin',
      admin_role: admin.admin_role ?? 'staff',
      photo: admin.photo,
      createDate: admin.createDate,
      createBy: admin.createBy ?? null,
      modifyBy: admin.modifyBy ?? null,
      modifyDate: admin.modifyDate ?? null,
    };
  }

  /** บัญชีลูกบ้าน — ฟิลด์ฝั่งผู้ดูแลเป็น null ทั้งหมด เพราะไม่มีจริง ไม่ใช่ยังไม่กรอก */
  private toMemberAuthUser(account: AccountEntity): AuthUser {
    return {
      id: account.id,
      fname: null,
      lname: null,
      email: null,
      phone: account.phone,
      role: 'member',
      admin_role: null,
      photo: null,
      createDate: account.create_date,
      createBy: null,
      modifyBy: null,
      modifyDate: null,
    };
  }

  /** สร้าง token จากข้อมูลบัญชี — ใช้ร่วมกันทั้ง login และ register */
  private async issueToken(user: AuthUser): Promise<AuthResult> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      // 🌟 ฝัง admin_role ลง token ด้วย เพื่อให้ด่านแก้บิล (PATCH /bills/:id/reading)
      //    ตัดสินสิทธิ์จากสิ่งที่เซิร์ฟเวอร์เซ็นเอง ไม่ใช่ค่าที่หน้าเว็บส่งมาใน body
      //    บัญชีลูกบ้านไม่มีค่านี้ ใส่ staff ไปเป็นค่าต่ำสุด ซึ่งไม่มีผลอะไร
      //    เพราะ route ฝั่งผู้ดูแลกัน role='member' ไว้อีกชั้นอยู่แล้ว
      admin_role: user.admin_role ?? 'staff',
    };
    return {
      access_token: await this.jwtService.signAsync(payload),
      user,
    };
  }

  // สมัครสมาชิกใหม่ — คืน token มาเลยจะได้ไม่ต้องล็อกอินซ้ำหลังสมัครเสร็จ
  async register(data: AuthRegisterDto): Promise<AuthResult> {
    if (!data.email || !data.password) {
      throw new UnprocessableEntityException('กรุณากรอกอีเมลและรหัสผ่าน');
    }

    const existing = await this.adminRepository.findOneBy({
      email: data.email,
    });
    if (existing) {
      throw new UnprocessableEntityException(
        `อีเมล: ${data.email} ถูกใช้งานแล้ว`,
      );
    }

    // 🌟 เก็บเฉพาะ hash ไม่เก็บรหัสผ่านจริง ถ้าฐานข้อมูลรั่วก็ย้อนกลับเป็นรหัสเดิมไม่ได้
    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    const admin = this.adminRepository.create({
      ...data,
      password: passwordHash,
      createDate: new Date(),
    });
    const saved = await this.adminRepository.save(admin);
    return this.issueToken(this.toAuthUser(saved));
  }

  // เข้าสู่ระบบ — คืน token ให้หน้าบ้านเก็บไว้แนบกับ request ถัดไป
  async login(data: AuthLoginDto): Promise<AuthResult> {
    if (!data.email || !data.password) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    const admin = await this.adminRepository.findOneBy({ email: data.email });

    // 🌟 ตอบข้อความเดียวกันทั้งกรณี "ไม่มีอีเมลนี้" และ "รหัสผ่านผิด"
    //    ถ้าแยกข้อความ คนร้ายจะไล่เดาได้ว่าอีเมลไหนมีอยู่จริงในระบบ
    if (!admin || !admin.password) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    const passwordMatched = await bcrypt.compare(data.password, admin.password);
    if (!passwordMatched) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    }

    return this.issueToken(this.toAuthUser(admin));
  }

  /**
   * เข้าสู่ระบบลูกบ้านด้วย "เบอร์โทรอย่างเดียว" ไม่มีรหัสผ่าน
   *
   * ตัดสินใจร่วมกับผู้ดูแลระบบแล้วว่ายอมรับได้: ข้อมูลที่เห็นคือบิลค่าน้ำของบ้าน
   * ที่ลงทะเบียนเบอร์นั้นไว้ แลกกับลูกบ้านไม่ต้องจำรหัสผ่าน/ไม่มีขั้นตอนสมัคร
   * สิทธิ์ยังถูกคุมที่ account_members เสมอ — เห็นได้เฉพาะบ้านที่แอดมินลงทะเบียนเบอร์นี้ไว้
   */
  async loginMember(data: MemberAuthDto): Promise<AuthResult> {
    const phone = data.phone?.trim();
    if (!phone) {
      throw new UnauthorizedException('กรุณากรอกเบอร์โทรศัพท์');
    }

    // เบอร์ต้องถูกลงทะเบียนไว้กับบ้านอย่างน้อย 1 หลังโดยแอดมิน ถึงจะเข้าได้
    const linkedHouses = await this.memberRepository.findBy({ phone });
    if (linkedHouses.length === 0) {
      throw new UnauthorizedException(
        `ไม่พบบ้านที่ลงทะเบียนเบอร์ ${phone} ไว้ในระบบ กรุณาติดต่อผู้ดูแลหมู่บ้าน`,
      );
    }

    // มีบัญชีอยู่แล้วใช้ตัวเดิม ไม่มีก็เปิดให้เลย (ตาราง accounts ไม่มีคอลัมน์รหัสผ่าน)
    let account = await this.accountRepository.findOneBy({ phone });
    if (!account) {
      account = await this.accountRepository.save(
        this.accountRepository.create({ phone }),
      );
    }

    // ซิงก์ลิงก์บัญชี↔บ้านทุกครั้งที่เข้า — บ้านที่เพิ่งถูกเพิ่มด้วยเบอร์เดียวกัน
    // หลังเปิดบัญชีไปแล้ว จะโผล่ในหน้าบิลของลูกบ้านเองโดยไม่ต้องให้แอดมินมาผูกซ้ำ
    const existingLinks = await this.accountMemberRepository.findBy({
      account_id: account.id,
    });
    const linkedIds = new Set(existingLinks.map((link) => link.members_id));
    const missingLinks = linkedHouses
      .filter((house) => !linkedIds.has(house.id))
      .map((house) =>
        this.accountMemberRepository.create({
          account_id: account.id,
          members_id: house.id,
        }),
      );
    if (missingLinks.length > 0) {
      await this.accountMemberRepository.save(missingLinks);
    }

    return this.issueToken(this.toMemberAuthUser(account));
  }
}
