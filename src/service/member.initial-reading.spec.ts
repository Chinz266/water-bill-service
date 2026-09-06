import { Repository } from 'typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { MemberService } from './member.service';
import { MemberEntity } from '../entity/member.entity';
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { MeterPhotoService } from './meter-photo.service';
import { ReadingLogsService } from './reading-logs.service';

/**
 * แก้เลขมิเตอร์ตั้งต้น — ด่านที่ห้ามหลุด
 *
 * เลขตั้งต้นคือเส้นเริ่มต้นที่บิลใบแรกเอาไปลบ ปล่อยให้ตั้งสูงกว่าการจดครั้งถัดไปเมื่อไหร่
 * บิลใบแรกจะได้หน่วยติดลบแล้วยอดเงินติดลบตามไปด้วย โดยที่ด่านของการออกบิลจับไม่ได้
 * เพราะด่านพวกนั้นตรวจตอนออกบิล ไม่ได้ตรวจย้อนหลังตอนมีคนมาแก้เส้นเริ่มต้น
 *
 * และการแก้ทุกครั้งต้องมี log — ถ้าเขียน log ไม่ได้ การแก้ที่กระทบทุกบิลของบ้านหลังนั้น
 * จะกลายเป็นการแก้ที่ไม่มีร่องรอย
 */
describe('MemberService.updateInitialReading', () => {
  let service: MemberService;
  let memberRepository: { findOneBy: jest.Mock };
  let meterReadingRepository: { find: jest.Mock; manager: any };
  let readingLogs: { record: jest.Mock };
  let updated: { id: number; patch: any } | null;

  beforeEach(() => {
    updated = null;
    memberRepository = { findOneBy: jest.fn().mockResolvedValue({ id: 12 }) };
    readingLogs = { record: jest.fn().mockResolvedValue({}) };
    meterReadingRepository = {
      find: jest.fn().mockResolvedValue([{ id: 501, meter_unit: 12500 }]),
      manager: {
        transaction: jest.fn(async (cb: any) =>
          cb({
            update: jest.fn(async (_entity: unknown, id: number, patch: any) => {
              updated = { id, patch };
            }),
          }),
        ),
      },
    };

    service = new MemberService(
      memberRepository as unknown as Repository<MemberEntity>,
      meterReadingRepository as unknown as Repository<MeterReadingEntity>,
      {} as unknown as MeterPhotoService,
      readingLogs as unknown as ReadingLogsService,
    );
  });

  const dto = (over: Partial<Record<string, unknown>> = {}) =>
    ({ id: 12, initial_meter_unit: 1250, reason: 'พิมพ์เกินหนึ่งหลัก', ...over }) as any;

  it('แก้เลขได้ และเขียนค่าใหม่ลงการจดครั้งแรก', async () => {
    const result = await service.updateInitialReading(dto());

    expect(updated).toEqual({ id: 501, patch: { meter_unit: 1250 } });
    expect(result).toEqual({ members_id: 12, old_unit: 12500, new_unit: 1250 });
  });

  it('เขียน log ทุกครั้ง โดย bills_id เป็น null เพราะการจดครั้งแรกไม่มีบิล', async () => {
    await service.updateInitialReading(dto());

    expect(readingLogs.record).toHaveBeenCalledTimes(1);
    const log = readingLogs.record.mock.calls[0][1];
    expect(log.bills_id).toBeNull();
    expect(log.meter_readings_id).toBe(501);
    expect(log.members_id).toBe(12);
    expect(log.old_unit).toBe(12500);
    expect(log.new_unit).toBe(1250);
    expect(log.reason).toBe('พิมพ์เกินหนึ่งหลัก');
  });

  it('log ต้องเขียนในทรานแซกชันเดียวกับการแก้ ไม่ใช่แยกกัน', async () => {
    await service.updateInitialReading(dto());

    // manager ที่ส่งเข้า record() ต้องเป็นตัวเดียวกับที่ transaction() ให้มา
    expect(meterReadingRepository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(readingLogs.record.mock.calls[0][0]).toBeDefined();
  });

  it('เลขใหม่มากกว่าการจดครั้งถัดไป → ตีกลับ มิเตอร์ไม่เดินถอยหลัง', async () => {
    meterReadingRepository.find.mockResolvedValue([
      { id: 501, meter_unit: 1200 },
      { id: 502, meter_unit: 1300 },
    ]);

    await expect(service.updateInitialReading(dto({ initial_meter_unit: 1400 }))).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(updated).toBeNull();
    expect(readingLogs.record).not.toHaveBeenCalled();
  });

  it('เลขใหม่เท่ากับการจดครั้งถัดไปพอดี → ผ่าน (หน่วยเป็น 0 ไม่ใช่ติดลบ)', async () => {
    meterReadingRepository.find.mockResolvedValue([
      { id: 501, meter_unit: 1200 },
      { id: 502, meter_unit: 1300 },
    ]);

    await expect(service.updateInitialReading(dto({ initial_meter_unit: 1300 }))).resolves.toEqual({
      members_id: 12,
      old_unit: 1200,
      new_unit: 1300,
    });
  });

  it('ไม่กรอกเหตุผล → ตีกลับ การแก้ที่ไม่มีเหตุผลเท่ากับไม่มีร่องรอย', async () => {
    await expect(service.updateInitialReading(dto({ reason: '   ' }))).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(updated).toBeNull();
  });

  it('เลขติดลบหรือไม่ใช่จำนวนเต็ม → ตีกลับ', async () => {
    await expect(service.updateInitialReading(dto({ initial_meter_unit: -5 }))).rejects.toThrow(
      UnprocessableEntityException,
    );
    await expect(service.updateInitialReading(dto({ initial_meter_unit: 12.5 }))).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('ไม่พบลูกบ้าน หรือบ้านนั้นยังไม่เคยจดเลย → ตีกลับ', async () => {
    memberRepository.findOneBy.mockResolvedValue(null);
    await expect(service.updateInitialReading(dto())).rejects.toThrow(UnprocessableEntityException);

    memberRepository.findOneBy.mockResolvedValue({ id: 12 });
    meterReadingRepository.find.mockResolvedValue([]);
    await expect(service.updateInitialReading(dto())).rejects.toThrow(UnprocessableEntityException);
  });

  /** กดบันทึกโดยไม่ได้แก้อะไร ไม่ควรมี log ขยะที่บอกว่า "แก้จาก 1250 เป็น 1250" */
  it('เลขเดิมเท่าเลขใหม่ → ไม่แตะฐานข้อมูล และไม่เขียน log', async () => {
    meterReadingRepository.find.mockResolvedValue([{ id: 501, meter_unit: 1250 }]);

    await expect(service.updateInitialReading(dto({ initial_meter_unit: 1250 }))).resolves.toEqual({
      members_id: 12,
      old_unit: 1250,
      new_unit: 1250,
    });
    expect(meterReadingRepository.manager.transaction).not.toHaveBeenCalled();
    expect(readingLogs.record).not.toHaveBeenCalled();
  });
});
