import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminController } from './controller/admin.controller';
import { AdminService } from './service/admin.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminEntity } from './entity/admin.entity';

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
      synchronize: false,     // แนะนำให้เปิด true แค่ตอน Dev (มันจะสร้างตารางให้ตาม Entity อัตโนมัติ)
    }),
    TypeOrmModule.forFeature([AdminEntity])
  ],
  controllers: [AppController, AdminController],
  providers: [AppService, AdminService],
})
export class AppModule {}
