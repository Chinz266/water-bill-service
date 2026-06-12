import { Injectable } from '@nestjs/common';
import { CalculateDto } from '../dto/calculate.dto';
import { AdminEntity } from 'src/entity/admin.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminRemoveDto } from 'src/dto/admin-remove.dto';

@Injectable()
export class AdminService {

    constructor(
        @InjectRepository(AdminEntity)
        private adminRepository: Repository<AdminEntity>,
    ) { }

    calculate(request: CalculateDto): number {
        const sum = request.numA + request.numB;
        return sum;
    }

    findAll(): Promise<AdminEntity[]> {
        return this.adminRepository.find();
    }

    // ดึงข้อมูลผู้ใช้ตาม ID
    findOne(id: number): Promise<AdminEntity | null> {
        return this.adminRepository.findOneBy({ id });
    }

    // สร้างผู้ใช้ใหม่
    create(userData: Partial<AdminEntity>): Promise<AdminEntity> {
        const newUser = this.adminRepository.create(userData);
        return this.adminRepository.save(newUser);
    }

    // ลบข้อมูลผู้ใช้
    async remove(userData: AdminRemoveDto): Promise<void> {
        await this.adminRepository.delete(userData.id);
    }
}
