import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  /**
   * ตรวจ body ตาม decorator ใน DTO ก่อนเข้า controller
   *
   * ก่อนหน้านี้ไม่มีด่านนี้เลย ฟิลด์ที่ประกาศว่าจำเป็น (เช่น water_rates_id) ถ้าไม่ส่งมา
   * จะไหลเข้าไปถึง service แล้วระเบิดเป็น 500 ที่อ่านไม่รู้เรื่อง:
   *   TypeORMError: Undefined value encountered in property 'WaterRateEntity.id'
   * ทั้งที่ควรตอบ 400 บอกไปตรง ๆ ว่าขาดฟิลด์ไหน
   *
   * ⚠️ ตั้ง whitelist/forbidNonWhitelisted เป็น false ไว้ตั้งใจ — ฟิลด์ที่ client เก่า
   *    ยังส่งมาเกิน (เช่น create_by ที่เลิกใช้แล้ว) ต้องไม่ทำให้ request พัง
   *    และ transform ปิดไว้เพื่อไม่ให้ชนิดข้อมูลเปลี่ยนไปจากเดิมโดยไม่ตั้งใจ
   *
   * DTO ที่ยังไม่มี decorator จะผ่านด่านนี้ไปเฉย ๆ เหมือนเดิม — ค่อยไล่เติมทีละตัวได้
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: false,
    }),
  );

  // 🌟 เปิดใช้งาน CORS เพื่อให้ Angular (localhost:4200) สามารถเชื่อมต่อกับ NestJS (localhost:3000) ได้
  app.enableCors();

  /**
   * เสิร์ฟรูปหน้าปัดมิเตอร์ที่เก็บไว้ (ดู MeterPhotoService)
   *
   * ⚠️ โฟลเดอร์นี้เปิดให้เรียกได้โดยไม่ต้องมี token ต่างจาก endpoint อื่นทั้งระบบ
   *    เพราะ <img src> ของเบราว์เซอร์แนบ header Authorization ไปด้วยไม่ได้
   *    ที่กันไว้คือชื่อไฟล์สุ่ม เดาไม่ได้ (ไม่ได้ตั้งตามเลขบิล/เลขบ้าน)
   *    ถ้าวันหลังต้องปิดจริงจัง ต้องเปลี่ยนไปเสิร์ฟผ่าน endpoint ที่ออก URL ชั่วคราวให้
   */
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    // ไม่ต้องให้ express ไล่หา index.html ในโฟลเดอร์รูป
    index: false,
  });

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
