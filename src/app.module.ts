import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminController } from './controller/admin.controller';
import { AdminService } from './service/admin.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminEntity } from './entity/admin.entity';
import { MemberEntity } from './entity/member.entity';
import { MemberController } from './controller/member.controller';
import { MemberService } from './service/member.service';
import { WaterRatesController } from './controller/water-rates.controller';
import { WaterRatesService } from './service/water-rates.service';
import { WaterRateEntity } from './entity/water-rate.entity';
import { VillagesController } from './controller/villages.controller';
import { VillagesService } from './service/villages.service';
import { VillageEntity } from './entity/village.entity';
import { MeterReadingEntity } from './entity/meter-reading.entity';
import { MeterReadingsController } from './controller/meter-readings.controller';
import { MeterReadingsService } from './service/meter-readings.service';
import { BillEntity } from './entity/bill.entity';
import { BillsService } from './service/bills.service';
import { BillsController } from './controller/bills.controller';
import { AuthController } from './controller/auth.controller';
import { AuthService } from './service/auth.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule,
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      username: 'root',      // ใส่ username ของ MySQL
      password: '',  // ใส่ password ของ MySQL
      database: 'water-bill-db',     // ใส่ชื่อฐานข้อมูลที่คุณสร้างไว้
      charset: 'utf8mb4',     // 🌟 บังคับ connection เป็น utf8mb4 ไม่งั้นภาษาไทยจะเก็บเป็น ????? (เพี้ยน)
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: false,     // แนะนำให้เปิด true แค่ตอน Dev (มันจะสร้างตารางให้ตาม Entity อัตโนมัติ)
    }),
    // 🔐 อ่านกุญแจเซ็น JWT จาก .env — ถ้าไม่ตั้งไว้จะโยน error ตั้งแต่ตอน boot
    //    ตั้งใจให้ล้มเลยดีกว่าปล่อยให้ระบบรันด้วย secret ค่าว่าง ซึ่งใครก็ปลอม token ได้
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('ไม่พบ JWT_SECRET ใน .env — คัดลอกจาก .env.example แล้วใส่ค่าสุ่มของคุณเอง');
        }
        return {
          secret,
          // cast เพราะ @nestjs/jwt ประกาศ expiresIn เป็น template type ของ ms ('1d' | '2h' | ...)
          // ซึ่งรับ string ธรรมดาจาก .env ตรง ๆ ไม่ได้
          signOptions: {
            expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '1d',
          } as JwtModuleOptions['signOptions'],
        };
      },
    }),
    TypeOrmModule.forFeature([AdminEntity, MemberEntity, WaterRateEntity, VillageEntity, MeterReadingEntity, BillEntity ])
  ],
  controllers: [AppController, AdminController, MemberController, WaterRatesController, VillagesController, MeterReadingsController, BillsController, AuthController],
  providers: [
    AppService, AdminService, MemberService, WaterRatesService, VillagesService, MeterReadingsService, BillsService, AuthService,
    // 🔐 ตั้ง guard เป็น global = ทุก endpoint ปิดไว้ก่อนเป็นค่าเริ่มต้น
    //    route ไหนที่ตั้งใจเปิดสาธารณะต้องแปะ @Public() เอง
    //    ปลอดภัยกว่าไล่แปะ guard ทีละ route เพราะ "ลืมแปะ = ปิด" ไม่ใช่ "ลืมแปะ = เปิดทิ้ง"
    //    ลำดับสำคัญ: JwtAuthGuard ต้องมาก่อน RolesGuard เพราะ RolesGuard อ่าน request.user ที่ตัวแรกแปะไว้
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
