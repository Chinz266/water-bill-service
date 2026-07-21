import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Roles } from 'src/auth/roles.decorator';
import {
  ProvinceEntity,
  DistrictEntity,
  SubdistrictEntity,
} from 'src/entity/location.entity';

/**
 * รายชื่อเขตการปกครองไทย — ใช้ทำ dropdown จังหวัด → อำเภอ → ตำบล ในหน้าตั้งค่าหมู่บ้าน
 * เป็นข้อมูลอ้างอิงอ่านอย่างเดียว จึงมี controller เดียวจบ ไม่ต้องมี service แยก
 */
@ApiTags('Locations (จังหวัด/อำเภอ/ตำบล)')
@Roles('admin')
@ApiBearerAuth()
@Controller('locations')
export class LocationsController {
  constructor(
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepository: Repository<ProvinceEntity>,
    @InjectRepository(DistrictEntity)
    private readonly districtRepository: Repository<DistrictEntity>,
    @InjectRepository(SubdistrictEntity)
    private readonly subdistrictRepository: Repository<SubdistrictEntity>,
  ) {}

  @Get('provinces')
  @ApiOperation({ summary: 'รายชื่อจังหวัดทั้งหมด (เรียงตามชื่อไทย)' })
  async provinces() {
    return await this.provinceRepository.find({
      select: { id: true, name_in_thai: true },
      order: { name_in_thai: 'ASC' },
    });
  }

  @Get('districts/:provinceId')
  @ApiOperation({ summary: 'รายชื่ออำเภอในจังหวัดที่เลือก' })
  async districts(@Param('provinceId', ParseIntPipe) provinceId: number) {
    return await this.districtRepository.find({
      select: { id: true, name_in_thai: true },
      where: { province_id: provinceId },
      order: { name_in_thai: 'ASC' },
    });
  }

  @Get('subdistricts/:districtId')
  @ApiOperation({ summary: 'รายชื่อตำบลในอำเภอที่เลือก' })
  async subdistricts(@Param('districtId', ParseIntPipe) districtId: number) {
    return await this.subdistrictRepository.find({
      select: { id: true, name_in_thai: true },
      where: { district_id: districtId },
      order: { name_in_thai: 'ASC' },
    });
  }
}
