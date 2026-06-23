import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateVillageDto } from 'src/dto/create-village.dto';
import { VillagesService } from 'src/service/villages.service';
@ApiTags('Villages (ข้อมูลหมู่บ้าน)') // จัดกลุ่มในหน้า Swagger
@Controller('villages')
export class VillagesController {
  constructor(private readonly villagesService: VillagesService) {}

  @Post()
  @ApiOperation({ summary: 'เพิ่มข้อมูลหมู่บ้านใหม่' })
  async create(@Body() createVillageDto: CreateVillageDto) {
    return await this.villagesService.create(createVillageDto);
  }

  @Get()
  @ApiOperation({ summary: 'ดึงข้อมูลหมู่บ้านทั้งหมด' })
  async findAll() {
    return await this.villagesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดึงข้อมูลหมู่บ้านตาม ID' })
  async findOne(@Param('id') id: string) {
    // อย่าลืมแปลง id จาก string เป็น number เพราะรับมาจาก URL
    return await this.villagesService.findOne(+id); 
  }
}