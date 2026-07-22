import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 🌟 ขยายเพดานขนาด request body จากค่าเริ่มต้นของ Express (100kb)
  //
  //    ระบบส่งรูปเป็น base64 มากับ JSON (รูปแนบตอนแจ้งเรื่อง และรูปโปรไฟล์ผู้ดูแล)
  //    รูปจากมือถือที่ย่อเหลือ 1024px แล้วยังอยู่ราว 100–300KB ซึ่งเกิน 100kb
  //    ถ้าไม่ขยาย Express จะตอบ 413 "request entity too large" ตั้งแต่ก่อนเข้า controller
  //    → ผู้ใช้จะเจอ error ที่ไม่มีข้อความไทยและไม่รู้ว่าเพราะรูปใหญ่
  //
  //    ตั้ง 5mb ให้มีที่เผื่อเหนือเพดาน 2MB ที่ ReportsService ตรวจเอง
  //    (ให้ฝั่งเราเป็นคนปฏิเสธพร้อมข้อความไทย แทนที่จะให้ Express ตัดจบก่อน)
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  // 🌟 เปิดใช้งาน CORS เพื่อให้ Angular (localhost:4200) สามารถเชื่อมต่อกับ NestJS (localhost:3000) ได้
  app.enableCors();

  // เริ่มต้นตั้งค่า Swagger
  const config = new DocumentBuilder()
    .setTitle('My API Documentation') // ชื่อ API ของคุณ
    .setDescription('The API description') // คำอธิบาย
    .setVersion('1.0') // เวอร์ชัน
    .addBearerAuth() // เพิ่มระบบ Authentication (ถ้ามี)
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // กำหนด path สำหรับเข้าดู Swagger UI
  SwaggerModule.setup('api', app, document);

  await app.listen(3000);
}
// void = บอกชัดว่าตั้งใจไม่รอผลลัพธ์ (ไม่งั้น eslint เตือน floating promise)
void bootstrap();
