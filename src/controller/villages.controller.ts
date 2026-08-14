import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CreateVillageDto } from 'src/dto/create-village.dto';
import { UpdateVillageDto } from 'src/dto/update-village.dto';
import { VillagesService } from 'src/service/villages.service';
import { Roles } from 'src/auth/roles.decorator';
import { CurrentUser } from 'src/auth/current-user.decorator';
import type { JwtPayload } from 'src/auth/auth.constants';

@ApiTags('Villages (ข้อมูลหมู่บ้าน)') // จัดกลุ่มในหน้า Swagger
// 🔐 ทั้ง controller นี้เป็นงานฝั่งผู้ดูแลหมู่บ้าน — ต้องล็อกอินเป็น admin เท่านั้น
//    เมื่อเปิดระบบล็อกอินลูกบ้านแล้ว ค่อยแยก route ที่ลูกบ้านดูได้ออกมาทีหลัง
@Roles('admin')
@ApiBearerAuth()
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

  @Patch(':id')
  @ApiOperation({
    summary: 'แก้ไขข้อมูลหมู่บ้าน (หน้าตั้งค่า — admin เท่านั้น)',
  })
  async update(
    // ParseIntPipe กัน id ที่ไม่ใช่ตัวเลข ไม่ให้หลุดไปเป็น NaN แล้วคิวรีเพี้ยน
    @Param('id', ParseIntPipe) id: number,
    @Body() updateVillageDto: UpdateVillageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // ส่ง id ของแอดมินที่ล็อกอินอยู่ไปบันทึกเป็น modify_by (ไม่รับจาก body)
    return await this.villagesService.update(id, updateVillageDto, user.sub);
  }
}
