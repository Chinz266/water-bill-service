import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AccountMemberEntity } from 'src/entity/account-member.entity';
import { MemberEntity } from 'src/entity/member.entity';
import { VillageEntity } from 'src/entity/village.entity';
import { AdminEntity } from 'src/entity/admin.entity';
import { BillsService } from './bills.service';

/**
 * สิ่งที่ลูกบ้านเห็นได้เอง — ต่างจาก MemberService (ฝั่งแอดมินจัดการทุกบ้าน)
 * ตรงที่ทุกคิวรีในนี้ต้องกรองผ่าน account_members เสมอ ไม่มีทางเห็นบ้านคนอื่น
 */
@Injectable()
export class MemberPortalService {
  constructor(
    @InjectRepository(AccountMemberEntity)
    private readonly accountMemberRepository: Repository<AccountMemberEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    private readonly billsService: BillsService,
  ) {}

  /** id ของบ้านทั้งหมดที่บัญชีนี้มีสิทธิ์เห็น */
  async getLinkedMemberIds(accountId: number): Promise<number[]> {
    const links = await this.accountMemberRepository.findBy({
      account_id: accountId,
    });
    return links.map((link) => link.members_id);
  }

  // รายชื่อบ้านที่ผูกกับบัญชีนี้ — ให้หน้าเว็บโชว์ตอนเลือกบ้าน (เผื่อดูแลหลายหลัง)
  // แนบชื่อหมู่บ้านไปด้วย เพราะ /villages เป็นสิทธิ์ admin ลูกบ้านเรียกเองไม่ได้
  async getMyHouses(accountId: number) {
    const memberIds = await this.getLinkedMemberIds(accountId);
    if (memberIds.length === 0) return [];

    const houses = await this.memberRepository.findBy({ id: In(memberIds) });

    const villageIds = [
      ...new Set(houses.map((h) => h.villages_id).filter(Boolean)),
    ];
    const villages = villageIds.length
      ? await this.memberRepository.manager.findBy(VillageEntity, {
          id: In(villageIds),
        })
      : [];
    const villageById = new Map(villages.map((v) => [v.id, v]));

    return houses.map((house) => {
      const village = villageById.get(house.villages_id);
      return {
        ...house,
        village: village
          ? {
              id: village.id,
              village_name: village.village_name,
              village_no: village.village_no,
            }
          : null,
      };
    });
  }

  // บิลของทุกบ้านที่บัญชีนี้ดูแล
  async getMyBills(accountId: number) {
    const memberIds = await this.getLinkedMemberIds(accountId);
    return this.billsService.findAllForMembers(memberIds);
  }

  // ข้อมูลผู้ดูแลไว้ให้ลูกบ้านติดต่อ (เช่น ถามเรื่องชำระเงิน)
  // ส่งเฉพาะชื่อกับเบอร์ ไม่แตะอีเมล/รหัสผ่าน — /admin/all เป็นสิทธิ์ admin ลูกบ้านเรียกเองไม่ได้
  async getAdminContacts() {
    const admins = await this.memberRepository.manager.find(AdminEntity, {
      where: { role: 'admin' },
      select: { id: true, fname: true, lname: true, phone: true, photo: true },
      order: { id: 'ASC' },
    });
    return admins;
  }
}
