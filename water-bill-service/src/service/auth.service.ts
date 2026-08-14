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
import { MemberEntity } from 'src/entity/member.entity';
import { AccountMemberEntity } from 'src/entity/account-member.entity';
import { AuthRegisterDto } from 'src/dto/auth-register.dto';
import { AuthLoginDto } from 'src/dto/auth-login.dto';
import { MemberAuthDto } from 'src/dto/member-auth.dto';
import { JwtPayload, UserRole } from 'src/auth/auth.constants';

/** จำนวนรอบการ hash — 10 เป็นค่ามาตรฐานที่สมดุลระหว่างความปลอดภัยกับความเร็ว */
const SALT_ROUNDS = 10;

/** ข้อมูลผู้ใช้ที่ส่งกลับหน้าบ้านได้ (ตัด password ออกแล้ว) */
type SafeAdmin = Omit<AdminEntity, 'password'>;

/** รูปแบบที่ login/register คืนกลับ — หน้าบ้านเก็บ access_token ไว้แนบกับ request ถัดไป */
export interface AuthResult {
  access_token: string;
  user: SafeAdmin;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AdminEntity)
    private adminRepository: Repository<AdminEntity>,
    @InjectRepository(MemberEntity)
    private memberRepository: Repository<MemberEntity>,
    @InjectRepository(AccountMemberEntity)
    private accountMemberRepository: Repository<AccountMemberEntity>,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * 🌟 ตัดรหัสผ่านออกก่อนส่งกลับเสมอ
   *    ของเดิมคืน AdminEntity ทั้งก้อน ทำให้ hash รหัสผ่านหลุดออกไปทาง API response
   */
  private toSafeAdmin(admin: AdminEntity): SafeAdmin {
    const { password: _password, ...safe } = admin;
    return safe;
  }

  /** สร้าง token จากข้อมูลบัญชี — ใช้ร่วมกันทั้ง login และ register */
  private async issueToken(admin: AdminEntity): Promise<AuthResult> {
    const payload: JwtPayload = {
      sub: admin.id,
      email: admin.email,
      role: (admin.role as UserRole) ?? 'admin',
    };
    return {
      access_token: await this.jwtService.signAsync(payload),
      user: this.toSafeAdmin(admin),
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
      role: 'admin',
      createDate: new Date(),
    });
    const saved = await this.adminRepository.save(admin);
    return this.issueToken(saved);
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

    return this.issueToken(admin);
  }

  // เข้าสู่ระบบด้วย Google (รอเชื่อม Google Client ID + google-auth-library ในขั้นถัดไป)
  // ไม่ใส่ async เพราะยังไม่มี await จริง — ฟังก์ชันที่โยน error เสมอมีชนิดเป็น never
  loginWithGoogle(): never {
    throw new UnprocessableEntityException(
      'ระบบเข้าสู่ระบบด้วย Google ยังไม่เปิดใช้งาน',
    );
  }

  // สมัครบัญชีลูกบ้าน — ตอนนี้เข้าด้วยเบอร์อย่างเดียว จึงเป็นแค่ทางเข้าเดียวกับ login
  // (เก็บ endpoint ไว้เผื่อ client เก่าที่ยังเรียก /auth/member/register อยู่)
  async registerMember(data: MemberAuthDto): Promise<AuthResult> {
    return this.loginMember(data);
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

    // มีบัญชีอยู่แล้วใช้ตัวเดิม ไม่มีก็เปิดให้เลย (ไม่มีรหัสผ่าน — คอลัมน์ password ปล่อย NULL)
    let account = await this.adminRepository.findOneBy({
      phone,
      role: 'member',
    });
    if (!account) {
      account = await this.adminRepository.save(
        this.adminRepository.create({
          phone,
          role: 'member',
          createDate: new Date(),
        }),
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

    return this.issueToken(account);
  }
}
