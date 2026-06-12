import { Body, Controller, Get, Post } from '@nestjs/common';
import { AdminEntity } from 'src/entity/admin.entity';
import { AdminService } from 'src/service/admin.service';
import { AdminCreateDto } from 'src/dto/admin-create.dto';
import { AdminRemoveDto } from 'src/dto/admin-remove.dto';

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
        return this.adminService.create(userData);
    }

    @Post('/remove')
    remove(@Body() userData: AdminRemoveDto) {
        return this.adminService.remove(userData);
    }
    
}
