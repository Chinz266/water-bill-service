import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { MemberEntity } from 'src/entity/member.entity';
import { MeterReadingEntity } from 'src/entity/meter-reading.entity';
import { BillEntity } from 'src/entity/bill.entity';
import { AccountMemberEntity } from 'src/entity/account-member.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MemberRemoveDto } from 'src/dto/member-remove.dto';
import { CreateMemberDto } from 'src/dto/member-create.dto';

@Injectable()
export class MemberService {

    constructor(
        @InjectRepository(MemberEntity)
        private memberRepository: Repository<MemberEntity>,
        @InjectRepository(MeterReadingEntity)
        private meterReadingRepository: Repository<MeterReadingEntity>,
        @InjectRepository(BillEntity)
        private billRepository: Repository<BillEntity>,
    ) { }

    findAll(): Promise<MemberEntity[]> {
        return this.memberRepository.find();
    }

    // ดึงข้อมูลสมาชิกตาม ID
    findOne(id: number): Promise<MemberEntity | null> {
        return this.memberRepository.findOneBy({ id });
    }

    // สร้างสมาชิกใหม่
    async create(userData: CreateMemberDto): Promise<MemberEntity> {
        let newMember = new MemberEntity();

        // 🌟 กันซ้ำที่ "บ้านเลขที่" อย่างเดียว เพราะ 1 บ้าน = 1 มิเตอร์ = 1 บิล
        //    ไม่กันชื่อ/เบอร์ซ้ำ เพราะในหมู่บ้านมีคนชื่อ-นามสกุลเหมือนกัน (ญาติกัน)
        //    และหลายบ้านใช้เบอร์ติดต่อเดียวกันได้ (คนเดียวดูแลหลายหลัง)
        if (userData.house_no && userData.house_no.trim() !== '') {
            const houseNo = userData.house_no.trim();
            const existing = await this.memberRepository.findOneBy({ house_no: houseNo });
            if (existing) {
                throw new UnprocessableEntityException(`บ้านเลขที่ ${houseNo} มีอยู่ในระบบแล้ว`);
            }
        }

        // 1. สร้าง Instance ของ Entity ก่อน
            // 🌟 คอลัมน์จริงใน DB สะกดว่า craete_by (ไม่ใช่ create_by) และห้ามเป็น NULL
            //    ถ้าไม่ map ตรงนี้ ค่าจะหล่นหายแล้ว MySQL จะโยน 500 ออกมา
            const { create_by, ...memberData } = userData;
            const memberToSave = this.memberRepository.create({
                ...memberData,
                house_no: memberData.house_no?.trim(),
                craete_by: create_by,
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

        // 🌟 กันซ้ำที่บ้านเลขที่อย่างเดียว (ยกเว้นตัวเอง) — เหตุผลเดียวกับตอนสร้าง
        const houseNo = (userData.house_no ?? member.house_no)?.trim();
        if (houseNo) {
            const existing = await this.memberRepository.findOneBy({ house_no: houseNo });
            if (existing && existing.id !== member.id) {
                throw new UnprocessableEntityException(`บ้านเลขที่ ${houseNo} มีอยู่ในระบบแล้ว`);
            }
        }

        const memberModify = this.memberRepository.merge(member, {
            ...userData,
            house_no: houseNo,
            modify_date: new Date(),
        });
        return await this.memberRepository.save(memberModify);
    }

    // ลบข้อมูลสมาชิก (พร้อมประวัติจดมิเตอร์และบิลทั้งหมดของบ้านหลังนี้)
    async remove(userData: MemberRemoveDto): Promise<void> {
        const member = await this.memberRepository.findOneBy({ id: userData.id });
        if (!member) {
            throw new UnprocessableEntityException(`ไม่พบสมาชิกที่มี ID: ${userData.id}`);
        }

        // 🌟 ข้อมูลผูกกันเป็นลูกโซ่: บ้าน ← การจดมิเตอร์ ← บิล
        //    ต้องลบจากลูกสุด (บิล) ย้อนขึ้นมา ไม่งั้น MySQL จะกัน FK แล้วโยน 500
        //    ห่อไว้ใน transaction เดียว ถ้าพลาดกลางทางจะ rollback ทั้งหมด ไม่เหลือข้อมูลค้าง
        const readings = await this.meterReadingRepository.findBy({ members_id: userData.id });
        const readingIds = readings.map((r) => r.id);

        await this.memberRepository.manager.transaction(async (manager) => {
            if (readingIds.length > 0) {
                // 1. ลบบิลที่อ้างถึงการจดมิเตอร์ของบ้านนี้ก่อน
                await manager.delete(BillEntity, { meter_readings_id: In(readingIds) });
                // 2. แล้วลบการจดมิเตอร์
                await manager.delete(MeterReadingEntity, readingIds);
            }
            // 3. ตัดลิงก์บัญชีลูกบ้านที่ผูกกับบ้านนี้ (ถ้ามี) ไม่งั้นจะเหลือลิงก์ขยะชี้ไปบ้านที่หายไปแล้ว
            await manager.delete(AccountMemberEntity, { members_id: userData.id });
            // 4. สุดท้ายลบตัวบ้าน
            await manager.delete(MemberEntity, userData.id);
        });
    }
}
