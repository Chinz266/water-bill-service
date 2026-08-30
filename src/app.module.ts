import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { AdminController } from './controller/admin.controller';
import { AdminService } from './service/admin.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminEntity } from './entity/admin.entity';
import { MemberEntity } from './entity/member.entity';
import { AccountMemberEntity } from './entity/account-member.entity';
import { AccountEntity } from './entity/account.entity';
import { MemberController } from './controller/member.controller';
import { MemberService } from './service/member.service';
import { WaterRatesController } from './controller/water-rates.controller';
import { WaterRatesService } from './service/water-rates.service';
import { WaterRateEntity } from './entity/water-rate.entity';
import { VillagesController } from './controller/villages.controller';
import { VillagesService } from './service/villages.service';
import { VillageEntity } from './entity/village.entity';
import { MeterReadingEntity } from './entity/meter-reading.entity';
import { BillDeletionLogEntity } from './entity/bill-deletion-log.entity';
import { MeterReadingsController } from './controller/meter-readings.controller';
import { MeterReadingsService } from './service/meter-readings.service';
import { MeterPhotoService } from './service/meter-photo.service';
import { ScanBatchService } from './service/scan-batch.service';
import { PhotoMetadataService } from './service/photo-metadata.service';
import { BillEntity } from './entity/bill.entity';
import { BillsService } from './service/bills.service';
import { BillsController } from './controller/bills.controller';
import { AuthController } from './controller/auth.controller';
import { AuthService } from './service/auth.service';
import { MemberPortalController } from './controller/member-portal.controller';
import { MemberPortalService } from './service/member-portal.service';
import { LocationsController } from './controller/locations.controller';
import { ReportEntity } from './entity/report.entity';
import { ReportsController } from './controller/reports.controller';
import { ReportsService } from './service/reports.service';
import {
  ProvinceEntity,
  DistrictEntity,
  SubdistrictEntity,
} from './entity/location.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { BillArrearsEntity } from './entity/bill-arrears.entity';
import { MeterEntity } from './entity/meter.entity';
import { TenancyEntity } from './entity/tenancy.entity';
import { ReadingFlagEntity } from './entity/reading-flag.entity';
import { MeterReadingLogEntity } from './entity/meter-reading-log.entity';
import { UnassignedReadingEntity } from './entity/unassigned-reading.entity';
import { MetersController } from './controller/meters.controller';
import { MetersService } from './service/meters.service';
import { TenanciesController } from './controller/tenancies.controller';
import { TenancyService } from './service/tenancy.service';
import { UnassignedReadingsController } from './controller/unassigned-readings.controller';
import { UnassignedReadingsService } from './service/unassigned-readings.service';
import { AuditController } from './controller/audit.controller';
import { ReadingFlagsService } from './service/reading-flags.service';
import { ReadingLogsService } from './service/reading-logs.service';
import { HousekeepingService } from './service/housekeeping.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule,
    // ⏰ งานที่ต้องเกิดขึ้นเองแม้ไม่มีใครเข้าเว็บทั้งเดือน (ดู HousekeepingService)
    //    พื้นที่ดิสก์ต่างจากสถานะบิลตรงที่ไม่มีใคร "เปิดดู" มันหมดเงียบ ๆ
    //    แล้วระบบล้มตอนที่ยังต้องใช้งานอยู่
    ScheduleModule.forRoot(),
    // 🌟 อ่านค่าต่อ DB จาก .env ที่เดียว — ค่าเดิม hardcode ไว้ตรงนี้ ทำให้ .env กับ
    //    scripts/migrate.ts ชี้คนละฐานข้อมูลได้โดยไม่มีอะไรเตือน (migration ลงที่หนึ่ง
    //    แอปอ่านอีกที่หนึ่ง แล้วโผล่เป็น ER_BAD_FIELD_ERROR ตอนใช้งาน)
    //    ค่า default ตรงกับของเดิมทุกตัว เครื่องที่ไม่มี .env จึงยังรันได้เหมือนเดิม
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.get<string>('DB_HOST') ?? 'localhost',
        port: Number(config.get<string>('DB_PORT') ?? 3306),
        username: config.get<string>('DB_USERNAME') ?? 'root',
        password: config.get<string>('DB_PASSWORD') ?? '',
        database: config.get<string>('DB_DATABASE') ?? 'water-bill-db',
        charset: 'utf8mb4', // 🌟 บังคับ connection เป็น utf8mb4 ไม่งั้นภาษาไทยจะเก็บเป็น ????? (เพี้ยน)
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false, // ห้ามเปิด — ดู docs/known-issues.md
      }),
    }),
    // 🔐 อ่านกุญแจเซ็น JWT จาก .env — ถ้าไม่ตั้งไว้จะโยน error ตั้งแต่ตอน boot
    //    ตั้งใจให้ล้มเลยดีกว่าปล่อยให้ระบบรันด้วย secret ค่าว่าง ซึ่งใครก็ปลอม token ได้
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error(
            'ไม่พบ JWT_SECRET ใน .env — คัดลอกจาก .env.example แล้วใส่ค่าสุ่มของคุณเอง',
          );
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
    TypeOrmModule.forFeature([
      AdminEntity,
      AccountEntity,
      MemberEntity,
      AccountMemberEntity,
      WaterRateEntity,
      VillageEntity,
      MeterReadingEntity,
      BillEntity,
      ReportEntity,
      ProvinceEntity,
      DistrictEntity,
      SubdistrictEntity,
      BillArrearsEntity,
      MeterEntity,
      TenancyEntity,
      ReadingFlagEntity,
      MeterReadingLogEntity,
      UnassignedReadingEntity,
      BillDeletionLogEntity,
    ]),
  ],
  controllers: [
    AdminController,
    MemberController,
    WaterRatesController,
    VillagesController,
    MeterReadingsController,
    BillsController,
    AuthController,
    MemberPortalController,
    LocationsController,
    ReportsController,
    MetersController,
    TenanciesController,
    UnassignedReadingsController,
    AuditController,
  ],
  providers: [
    AdminService,
    MemberService,
    WaterRatesService,
    VillagesService,
    MeterReadingsService,
    MeterPhotoService,
    ScanBatchService,
    PhotoMetadataService,
    BillsService,
    AuthService,
    MemberPortalService,
    ReportsService,
    MetersService,
    TenancyService,
    UnassignedReadingsService,
    ReadingFlagsService,
    ReadingLogsService,
    HousekeepingService,
    // 🔐 ตั้ง guard เป็น global = ทุก endpoint ปิดไว้ก่อนเป็นค่าเริ่มต้น
    //    route ไหนที่ตั้งใจเปิดสาธารณะต้องแปะ @Public() เอง
    //    ปลอดภัยกว่าไล่แปะ guard ทีละ route เพราะ "ลืมแปะ = ปิด" ไม่ใช่ "ลืมแปะ = เปิดทิ้ง"
    //    ลำดับสำคัญ: JwtAuthGuard ต้องมาก่อน RolesGuard เพราะ RolesGuard อ่าน request.user ที่ตัวแรกแปะไว้
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
