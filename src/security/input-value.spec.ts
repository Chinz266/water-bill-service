import { validate } from 'class-validator';
import { CreateBillFromScanDto } from '../dto/create-bill-from-scan.dto';
import { CreateMemberDto } from '../dto/member-create.dto';
import { UpdateReadingDto } from '../dto/update-reading.dto';

describe('DTO input types', () => {
  it('rejects coercible objects, arrays, invalid coordinates and string flags', async () => {
    const dto = Object.assign(new CreateBillFromScanDto(), {
      members_id: [],
      water_rates_id: {},
      current_unit: true,
      billing_month: {},
      billing_year: [],
      latitude: 91,
      longitude: 181,
      confirm_high_usage: 'false',
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'members_id',
        'water_rates_id',
        'current_unit',
        'billing_month',
        'billing_year',
        'latitude',
        'longitude',
        'confirm_high_usage',
      ]),
    );
  });
  it('keeps numeric strings and omitted optional fields compatible', async () => {
    const dto = Object.assign(new CreateBillFromScanDto(), {
      members_id: '1',
      water_rates_id: '1',
      current_unit: '12',
      billing_month: '09',
      billing_year: '2026',
    });
    expect(await validate(dto)).toEqual([]);
    expect(
      await validate(
        Object.assign(new UpdateReadingDto(), {
          current_unit: '12',
          reason: 'แก้เลข',
          confirm_high_usage: 'false',
        }),
      ),
    ).toEqual([]);
  });
  it('rejects oversized names without changing partial-update semantics', async () => {
    expect(
      await validate(
        Object.assign(new CreateMemberDto(), { fname: 'x'.repeat(46) }),
      ),
    ).toHaveLength(1);
    expect(
      await validate(Object.assign(new CreateMemberDto(), { phone: null })),
    ).toEqual([]);
  });
});
