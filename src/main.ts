import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
