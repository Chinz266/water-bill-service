import { Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
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
    ) { }

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

        const existing = await this.adminRepository.findOneBy({ email: data.email });
        if (existing) {
            throw new UnprocessableEntityException(`อีเมล: ${data.email} ถูกใช้งานแล้ว`);
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
    async loginWithGoogle(): Promise<never> {
        throw new UnprocessableEntityException('ระบบเข้าสู่ระบบด้วย Google ยังไม่เปิดใช้งาน');
    }

    // สมัครสมาชิกลูกบ้าน — ล็อกอินด้วยเบอร์โทร ไม่ใช่อีเมล
    async registerMember(data: MemberAuthDto): Promise<AuthResult> {
        if (!data.phone || !data.password) {
            throw new UnprocessableEntityException('กรุณากรอกเบอร์โทรและรหัสผ่าน');
        }
        const phone = data.phone.trim();

        const existing = await this.adminRepository.findOneBy({ phone });
        if (existing) {
            throw new UnprocessableEntityException(`เบอร์โทร ${phone} มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบแทน`);
        }

        // 🌟 ต้องมีบ้านที่ลงทะเบียนเบอร์นี้ไว้ในระบบก่อน ไม่งั้นใครก็สมัครมั่ว ๆ ได้
        //    โดยไม่มีบ้านจริงผูกอยู่ (เห็นข้อมูลของใครไม่ได้เลย)
        const linkedHouses = await this.memberRepository.findBy({ phone });
        if (linkedHouses.length === 0) {
            throw new UnprocessableEntityException(
                `ไม่พบบ้านที่ลงทะเบียนเบอร์ ${phone} ไว้ในระบบ กรุณาติดต่อผู้ดูแลหมู่บ้าน`,
            );
        }

        const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
        const account = this.adminRepository.create({
            phone,
            password: passwordHash,
            role: 'member',
            createDate: new Date(),
        });
        const saved = await this.adminRepository.save(account);

        // ผูกบัญชีนี้เข้ากับ "ทุกบ้าน" ที่ใช้เบอร์เดียวกัน (เช่น 0822222222 → 99/1 และ 99/1/2)
        const links = linkedHouses.map((house) =>
            this.accountMemberRepository.create({ account_id: saved.id, members_id: house.id }),
        );
        await this.accountMemberRepository.save(links);

        return this.issueToken(saved);
    }

    // เข้าสู่ระบบลูกบ้านด้วยเบอร์โทร
    async loginMember(data: MemberAuthDto): Promise<AuthResult> {
        if (!data.phone || !data.password) {
            throw new UnauthorizedException('เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง');
        }

        const account = await this.adminRepository.findOneBy({ phone: data.phone.trim(), role: 'member' });

        // ข้อความเดียวกันทั้ง "ไม่มีเบอร์นี้" และ "รหัสผิด" กันคนร้ายไล่เดาเบอร์ที่มีจริง
        if (!account || !account.password) {
            throw new UnauthorizedException('เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง');
        }

        const passwordMatched = await bcrypt.compare(data.password, account.password);
        if (!passwordMatched) {
            throw new UnauthorizedException('เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง');
        }

        return this.issueToken(account);
    }
}
