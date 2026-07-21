import { Body, Controller, Post } from '@nestjs/common';
import { AdminService } from 'src/service/admin.service';
import { AdminCreateDto } from 'src/dto/admin-create.dto';
import { AdminRemoveDto } from 'src/dto/admin-remove.dto';
import { Roles } from 'src/auth/roles.decorator';
import { ApiBearerAuth } from '@nestjs/swagger';

// 🔐 ทั้ง controller นี้เป็นงานฝั่งผู้ดูแลหมู่บ้าน — ต้องล็อกอินเป็น admin เท่านั้น
//    เมื่อเปิดระบบล็อกอินลูกบ้านแล้ว ค่อยแยก route ที่ลูกบ้านดูได้ออกมาทีหลัง
@Roles('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('/all')
  findAll() {
    return this.adminService.findAll();
  }

  @Post('/find-one')
  findOne(@Body() userData: AdminRemoveDto) {
    return this.adminService.findOne(userData.id);
  }

  @Post('/create')
  create(@Body() userData: AdminCreateDto) {
    return this.adminService.create(userData);
  }

  @Post('/update')
  update(@Body() userData: AdminCreateDto) {
    return this.adminService.update(userData);
  }

  @Post('/remove')
  remove(@Body() userData: AdminRemoveDto) {
    return this.adminService.remove(userData);
  }
}
