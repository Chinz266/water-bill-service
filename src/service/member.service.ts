import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { MemberEntity } from 'src/entity/member.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberRemoveDto } from 'src/dto/member-remove.dto';

@Injectable()
export class MemberService {

    constructor(
        @InjectRepository(MemberEntity)
        private memberRepository: Repository<MemberEntity>,
    ) { }

    findAll(): Promise<MemberEntity[]> {
        return this.memberRepository.find();
    }

    // ดึงข้อมูลสมาชิกตาม ID
    findOne(id: number): Promise<MemberEntity | null> {
        return this.memberRepository.findOneBy({ id });
    }

    // สร้างสมาชิกใหม่
    async create(userData: Partial<MemberEntity>): Promise<MemberEntity> {
        let newMember = new MemberEntity();
        
        // ตรวจสอบชื่อ-นามสกุลซ้ำ (ถ้ามีการส่งมา)
        if (userData.fname && userData.lname) {
            const member = await this.memberRepository.findOneBy({ fname: userData.fname, lname: userData.lname });
            if (member) {
                throw new UnprocessableEntityException(`สมาชิก: ${member.fname} ${member.lname} มีอยู่แล้ว`);
            }
        }

        // ตรวจสอบเบอร์โทรซ้ำ (ถ้ามีการส่งมา)
        if (userData.phone) {
            const memberByPhone = await this.memberRepository.findOneBy({ phone: userData.phone });
            if (memberByPhone) {
                throw new UnprocessableEntityException(`เบอร์โทรศัพท์: ${memberByPhone.phone} มีอยู่แล้ว`);
            }
        }

        // 1. สร้าง Instance ของ Entity ก่อน
            const memberToSave = this.memberRepository.create({
                ...userData,
                craeta_date: new Date(),
            });
            // 2. แล้วค่อยบันทึก
            newMember = await this.memberRepository.save(memberToSave);
        return newMember;
    }

    // อัปเดตข้อมูลสมาชิก
    async update(userData: Partial<MemberEntity>): Promise<MemberEntity> {
        if (!userData.id) {
            throw new UnprocessableEntityException(`ต้องระบุ ID ของสมาชิกที่ต้องการแก้ไข`);
        }

        const member = await this.memberRepository.findOneBy({ id: userData.id });
        if (!member) {
            throw new UnprocessableEntityException(`ไม่พบสมาชิกที่มี ID: ${userData.id}`);
        }

        const fname = userData.fname ?? member.fname;
        const lname = userData.lname ?? member.lname;
        const phone = userData.phone ?? member.phone;

        const memberByName = await this.memberRepository.findOneBy({ fname, lname });
        if (memberByName && memberByName.id !== member.id) {
            throw new UnprocessableEntityException(`สมาชิก: ${memberByName.fname} ${memberByName.lname} มีอยู่แล้ว`);
        }

        const memberByPhone = await this.memberRepository.findOneBy({ phone });
        if (memberByPhone && memberByPhone.id !== member.id) {
            throw new UnprocessableEntityException(`เบอร์โทรศัพท์: ${memberByPhone.phone} มีอยู่แล้ว`);
        }

        const memberModify = this.memberRepository.merge(member, {
            ...userData,
            modify_date: new Date(),
        });
        return await this.memberRepository.save(memberModify);
    }

    // ลบข้อมูลสมาชิก
    async remove(userData: MemberRemoveDto): Promise<void> {
        const member = await this.memberRepository.findOneBy({ id: userData.id });
        if (!member) {
            throw new UnprocessableEntityException(`ไม่พบสมาชิกที่มี ID: ${userData.id}`);
        }
        await this.memberRepository.delete(userData.id);
    }
}
