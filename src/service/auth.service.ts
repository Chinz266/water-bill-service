import { Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminEntity } from 'src/entity/admin.entity';
import { AuthRegisterDto } from 'src/dto/auth-register.dto';
import { AuthLoginDto } from 'src/dto/auth-login.dto';

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(AdminEntity)
        private adminRepository: Repository<AdminEntity>,
    ) { }

    // สมัครสมาชิกใหม่
    // ⚠️ ยังเก็บรหัสผ่านแบบ plaintext ชั่วคราว (รอติดตั้ง bcrypt ในขั้นถัดไป)
    async register(data: AuthRegisterDto): Promise<AdminEntity> {
        // ไม่มี ValidationPipe อยู่ ถ้า email ว่างจะหลุดไปพังที่ระดับ TypeORM/DB เป็น 500
        if (!data.email || !data.password) {
            throw new UnprocessableEntityException('กรุณากรอกอีเมลและรหัสผ่าน');
        }

        const existing = await this.adminRepository.findOneBy({ email: data.email });
        if (existing) {
            throw new UnprocessableEntityException(`อีเมล: ${data.email} ถูกใช้งานแล้ว`);
        }

        const admin = this.adminRepository.create({
            ...data,
            role: 'admin',
            createDate: new Date(),
        });
        return this.adminRepository.save(admin);
    }

    // เข้าสู่ระบบ
    // ⚠️ ยังเทียบรหัสผ่านแบบ plaintext ชั่วคราว (รอติดตั้ง bcrypt + JWT ในขั้นถัดไป)
    async login(data: AuthLoginDto): Promise<AdminEntity> {
        // กัน findOneBy({ email: undefined }) ที่จะกลายเป็น 500 แทนที่จะเป็น 401
        if (!data.email || !data.password) {
            throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        }

        const admin = await this.adminRepository.findOneBy({ email: data.email });
        if (!admin || admin.password !== data.password) {
            throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        }
        return admin;
    }

    // เข้าสู่ระบบด้วย Google (รอเชื่อม Google Client ID + google-auth-library ในขั้นถัดไป)
    async loginWithGoogle(): Promise<never> {
        throw new UnprocessableEntityException('ระบบเข้าสู่ระบบด้วย Google ยังไม่เปิดใช้งาน');
    }
}
