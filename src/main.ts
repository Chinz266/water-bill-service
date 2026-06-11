import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. ตั้งค่าพื้นฐานสำหรับหน้า Document
  const config = new DocumentBuilder()
    .setTitle('Smart Water Bill API')
    .setDescription('API documentation for the water bill service')
    .setVersion('1.0')
    .build();

  // 2. สร้าง Document จาก config
  const document = SwaggerModule.createDocument(app, config);
  
  // 3. ผูก Swagger UI ไว้ที่ path '/api-docs'
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();