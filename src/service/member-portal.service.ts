import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AccountMemberEntity } from 'src/entity/account-member.entity';
import { MemberEntity } from 'src/entity/member.entity';
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
    const links = await this.accountMemberRepository.findBy({ account_id: accountId });
    return links.map((link) => link.members_id);
  }

  // รายชื่อบ้านที่ผูกกับบัญชีนี้ — ให้หน้าเว็บโชว์ตอนเลือกบ้าน (เผื่อดูแลหลายหลัง)
  async getMyHouses(accountId: number) {
    const memberIds = await this.getLinkedMemberIds(accountId);
    if (memberIds.length === 0) return [];
    return this.memberRepository.findBy({ id: In(memberIds) });
  }

  // บิลของทุกบ้านที่บัญชีนี้ดูแล
  async getMyBills(accountId: number) {
    const memberIds = await this.getLinkedMemberIds(accountId);
    return this.billsService.findAllForMembers(memberIds);
  }
}
