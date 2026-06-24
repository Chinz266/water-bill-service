import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
bootstrap();