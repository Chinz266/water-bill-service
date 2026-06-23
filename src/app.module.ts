import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      username: 'root',      // ใส่ username ของ MySQL
      password: '123456',  // ใส่ password ของ MySQL
      database: 'water-bill-db',     // ใส่ชื่อฐานข้อมูลที่คุณสร้างไว้
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,     // แนะนำให้เปิด true แค่ตอน Dev (มันจะสร้างตารางให้ตาม Entity อัตโนมัติ)
    }),
    TypeOrmModule.forFeature([AdminEntity, MemberEntity, WaterRateEntity, VillageEntity, MeterReadingEntity, BillEntity ])
  ],
  controllers: [AppController, AdminController, MemberController, WaterRatesController, VillagesController, MeterReadingsController, BillsController],
  providers: [AppService, AdminService, MemberService, WaterRatesService, VillagesService, MeterReadingsService, BillsService],
})
export class AppModule {}
