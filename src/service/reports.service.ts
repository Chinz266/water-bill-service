import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReportEntity } from 'src/entity/report.entity';
import { MemberEntity } from 'src/entity/member.entity';
import { AdminEntity } from 'src/entity/admin.entity';
import { CreateReportDto } from 'src/dto/create-report.dto';
import { ReplyReportDto } from 'src/dto/reply-report.dto';
import {
  REPORT_CATEGORIES,
  REPORT_DETAIL_MAX,
  REPORT_PHOTO_MAX,
  REPORT_STATUSES,
  ReportCategory,
  ReportStatus,
} from 'src/report/report.constants';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ReportEntity)
    private readonly reportRepository: Repository<ReportEntity>,
  ) {}

  // ==========================================
  // ตรวจข้อมูลที่รับเข้ามา
  // ==========================================
  // 🌟 โปรเจกต์นี้ยังไม่ได้เปิด global ValidationPipe และ DTO ไม่มี class-validator
  //    ถ้าไม่ตรวจเอง ข้อมูลผิดรูปจะทะลุไปพังที่ MySQL เป็น 500 ที่ผู้ใช้อ่านไม่รู้เรื่อง
  //    (ทำแบบเดียวกับ villages.service / bills.service ที่ตรวจเองในระดับ service)
  private validateCategory(category: string): ReportCategory {
    if (!REPORT_CATEGORIES.includes(category as ReportCategory)) {
      throw new BadRequestException('กรุณาเลือกหมวดหมู่เรื่องที่ต้องการแจ้ง');
    }
    return category as ReportCategory;
  }

  private validateDetail(detail: string | undefined): string {
    const trimmed = (detail ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('กรุณากรอกรายละเอียดของเรื่องที่ต้องการแจ้ง');
    }
    if (trimmed.length > REPORT_DETAIL_MAX) {
      throw new BadRequestException(
        `รายละเอียดยาวเกินไป (ไม่เกิน ${REPORT_DETAIL_MAX} ตัวอักษร)`,
      );
    }
    return trimmed;
  }

  private validatePhoto(photo: string | null | undefined): string | null {
    if (!photo) return null;
    if (!photo.startsWith('data:image/')) {
      throw new BadRequestException('ไฟล์แนบต้องเป็นรูปภาพเท่านั้น');
    }
    if (photo.length > REPORT_PHOTO_MAX) {
      throw new BadRequestException(
        'รูปภาพมีขนาดใหญ่เกินไป กรุณาถ่ายใหม่หรือเลือกรูปที่เล็กลง',
      );
    }
    return photo;
  }

  // ==========================================
  // ฝั่งลูกบ้าน
  // ==========================================

  /**
   * ส่งเรื่องใหม่
   *
   * ⚠️ allowedMemberIds มาจาก account_members ของบัญชีที่ล็อกอินอยู่ (ไม่ใช่จาก client)
   *    ถ้าไม่เช็คตรงนี้ ลูกบ้านจะยิง members_id ของบ้านคนอื่นเข้ามาแจ้งแทนได้
   */
  async create(
    accountId: number,
    dto: CreateReportDto,
    allowedMemberIds: number[],
  ) {
    const membersId = Number(dto.members_id);
    if (!membersId || !allowedMemberIds.includes(membersId)) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์แจ้งเรื่องแทนบ้านหลังนี้');
    }

    const report = this.reportRepository.create({
      members_id: membersId,
      account_id: accountId,
      category: this.validateCategory(dto.category),
      detail: this.validateDetail(dto.detail),
      photo: this.validatePhoto(dto.photo),
      // เรื่องที่เพิ่งส่งต้องเป็น Pending เสมอ ไม่ว่า client จะส่งอะไรมา
      status: 'Pending',
    });

    return await this.reportRepository.save(report);
  }

  /** เรื่องของบ้านที่บัญชีนี้ดูแล (ใหม่สุดก่อน) */
  async findAllForMembers(memberIds: number[]) {
    if (memberIds.length === 0) return [];

    const { entities, raw } = await this.detailQuery()
      .where('report.members_id IN (:...memberIds)', { memberIds })
      .orderBy('report.create_date', 'DESC')
      .getRawAndEntities();

    return entities.map((report, index) => this.toDetail(report, raw[index]));
  }

  // ==========================================
  // ฝั่งแอดมิน
  // ==========================================

  /** เรื่องทั้งหมดทุกบ้าน (ใหม่สุดก่อน) */
  async findAll() {
    const { entities, raw } = await this.detailQuery()
      .orderBy('report.create_date', 'DESC')
      .getRawAndEntities();

    return entities.map((report, index) => this.toDetail(report, raw[index]));
  }

  /** ตอบกลับ และ/หรือ เปลี่ยนสถานะ — ส่งมาแค่อย่างใดอย่างหนึ่งก็ได้ */
  async reply(id: number, dto: ReplyReportDto, adminId: number) {
    const report = await this.reportRepository.findOne({ where: { id } });
    if (!report) {
      throw new NotFoundException(`ไม่พบเรื่องหมายเลข ${id}`);
    }

    if (dto.status !== undefined) {
      if (!REPORT_STATUSES.includes(dto.status)) {
        throw new BadRequestException('สถานะไม่ถูกต้อง');
      }
      report.status = dto.status as ReportStatus;
    }

    if (dto.admin_reply !== undefined) {
      const reply = dto.admin_reply.trim();
      if (reply.length > REPORT_DETAIL_MAX) {
        throw new BadRequestException(
          `ข้อความตอบกลับยาวเกินไป (ไม่เกิน ${REPORT_DETAIL_MAX} ตัวอักษร)`,
        );
      }
      // สตริงว่าง = ลบคำตอบทิ้ง (แอดมินพิมพ์ผิดแล้วอยากล้าง)
      report.admin_reply = reply || null;
      report.replied_by = reply ? adminId : null;
      report.replied_date = reply ? new Date() : null;
    }

    report.modify_date = new Date();
    return await this.reportRepository.save(report);
  }

  async remove(id: number) {
    const report = await this.reportRepository.findOne({ where: { id } });
    if (!report) {
      throw new NotFoundException(`ไม่พบเรื่องหมายเลข ${id}`);
    }
    await this.reportRepository.delete(id);
    return { message: `ลบเรื่อง ID ${id} เรียบร้อยแล้ว` };
  }

  // ==========================================
  // ประกอบข้อมูลให้หน้าเว็บใช้ได้เลย
  // ==========================================
  // ตาราง reports เก็บแค่ members_id หน้าเว็บเลยไม่รู้ว่าเป็นบ้านหลังไหน/ใครตอบ
  // ต้อง join ไปหา members และ admin (คนตอบ) เหมือนที่ bills.service ทำกับบิล
  private detailQuery() {
    return this.reportRepository
      .createQueryBuilder('report')
      .leftJoin(MemberEntity, 'member', 'member.id = report.members_id')
      .leftJoin(AdminEntity, 'replier', 'replier.id = report.replied_by')
      .addSelect([
        'member.id',
        'member.house_no',
        'member.fname',
        'member.lname',
        'member.phone',
        'replier.id',
        'replier.fname',
        'replier.lname',
      ]);
  }

  private toDetail(report: ReportEntity, row: Record<string, any>) {
    return {
      ...report,
      member: row?.member_id
        ? {
            id: row.member_id,
            house_no: row.member_house_no,
            fname: row.member_fname,
            lname: row.member_lname,
            phone: row.member_phone,
          }
        : null,
      replier: row?.replier_id
        ? {
            id: row.replier_id,
            fname: row.replier_fname,
            lname: row.replier_lname,
          }
        : null,
    };
  }
}
