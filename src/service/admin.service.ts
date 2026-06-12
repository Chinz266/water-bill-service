import { Injectable, UnprocessableEntityException } from '@nestjs/common';
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

    findAll(): Promise<AdminEntity[]> {
        return this.adminRepository.find();
    }

    // ดึงข้อมูลผู้ใช้ตาม ID
    findOne(id: number): Promise<AdminEntity | null> {
        return this.adminRepository.findOneBy({ id });
    }

    // สร้างผู้ใช้ใหม่
    async create(userData: Partial<AdminEntity>): Promise<AdminEntity> {
        let newAdmin = new AdminEntity();
        const admin = await this.adminRepository.findOneBy({ fname: userData.fname, lname: userData.lname });
        if (admin) {
            throw new UnprocessableEntityException(`แอดมิน: ${admin.fname} ${admin.lname} มีอยู่แล้ว`);
        }
        const adminByPhone = await this.adminRepository.findOneBy({ phone: userData.phone });
        if (adminByPhone) {
            throw new UnprocessableEntityException(`เบอร์โทรศัพท์: ${adminByPhone.phone} มีอยู่แล้ว`);
        } else {
            // 1. สร้าง Instance ของ Entity ก่อน
            const adminToSave = this.adminRepository.create({
                ...userData,
                createDate: new Date(), // ในภาพของคุณพิมพ์ Date เป็น date ระวังเรื่องตัวพิมพ์เล็ก/ใหญ่ด้วยนะครับ
            });
            // 2. แล้วค่อยบันทึก
            newAdmin = await this.adminRepository.save(adminToSave);
        }
        return newAdmin;
    }

    // ลบข้อมูลผู้ใช้
    async remove(userData: AdminRemoveDto): Promise<void> {
        await this.adminRepository.delete(userData.id);
    }
}
