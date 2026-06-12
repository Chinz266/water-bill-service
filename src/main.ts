import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // เริ่มต้นตั้งค่า Swagger
  const config = new DocumentBuilder()
    .setTitle('My API Documentation') // ชื่อ API ของคุณ
    .setDescription('The API description') // คำอธิบาย
    .setVersion('1.0') // เวอร์ชัน
    .addBearerAuth() // เพิ่มระบบ Authentication (ถ้ามี)
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  
  // กำหนด path สำหรับเข้าดู Swagger UI (ในตัวอย่างนี้คือ /api)
  SwaggerModule.setup('api', app, document);

  await app.listen(3000);
}
bootstrap();
