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
import { MeterReadingEntity } from './entity/meter-reading.entity';
import { MeterReadingController } from './controller/meter-reading.controller';
import { MeterReadingService } from './service/meter-reading.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: 'localhost',
      port: 3306,
      username: 'root',      // ใส่ username ของ MySQL
      password: '',  // ใส่ password ของ MySQL
      database: 'water-bill-db',     // ใส่ชื่อฐานข้อมูลที่คุณสร้างไว้
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,     // แนะนำให้เปิด true แค่ตอน Dev (มันจะสร้างตารางให้ตาม Entity อัตโนมัติ)
    }),
    TypeOrmModule.forFeature([AdminEntity, MemberEntity, MeterReadingEntity])
  ],
  controllers: [AppController, AdminController, MemberController, MeterReadingController],
  providers: [AppService, AdminService, MemberService, MeterReadingService],
})
export class AppModule {}
