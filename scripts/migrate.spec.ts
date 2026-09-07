import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  declaredObjects,
  declaredRequires,
  orderByDependency,
  splitStatements,
} from './migrate';

/**
 * ตัวตัดคำสั่ง SQL ของ `npm run migrate`
 *
 * ═══ ทำไมต้องมีเทสต์ชุดนี้ ═══
 *
 * ตัวรัน migration ตัดไฟล์เป็นคำสั่งย่อยก่อนส่งเข้า MySQL เพื่อให้บอกได้ว่าพังที่คำสั่งไหน
 * และข้ามคำสั่งที่ "ของมีอยู่แล้ว" เป็นรายตัวได้ — การตัดผิดจึงไม่ใช่แค่เรื่องความสวยงาม
 * แต่แปลว่าคำสั่งครึ่งท่อนถูกส่งเข้า DB จริง
 *
 * จุดที่ตัดพลาดง่ายคือ `;` ที่ไม่ได้เป็นตัวจบคำสั่ง — ในคอมเมนต์ภาษาไทย (ซึ่งไฟล์ในโปรเจกต์นี้
 * มีเต็มไปหมด) และในสตริงของ COMMENT '...'
 */
describe('splitStatements — ตัด SQL เป็นคำสั่งย่อย', () => {
  it('ตัดตาม ; ปกติ และทิ้งก้อนที่มีแต่คอมเมนต์', () => {
    const statements = splitStatements(`
      -- หัวเรื่อง
      USE \`water-bill-db\`;
      SELECT 1;
      -- ปิดท้ายด้วยคอมเมนต์เฉย ๆ
    `);

    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain('SELECT 1');
  });

  it('ไม่ตัดที่ ; ในคอมเมนต์ — ไฟล์ในโปรเจกต์นี้เขียนคำอธิบายยาว ๆ ทุกไฟล์', () => {
    const statements = splitStatements(`
      -- ทำแบบนี้เพราะ: อย่างแรก; อย่างที่สอง; อย่างที่สาม
      ALTER TABLE \`members\` ADD COLUMN \`x\` int DEFAULT NULL;
    `);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('ADD COLUMN');
  });

  it('ไม่ตัดที่ ; ในสตริง — COMMENT ของคอลัมน์มีเครื่องหมายวรรคตอนได้', () => {
    const statements = splitStatements(
      "ALTER TABLE `m` ADD COLUMN `x` int COMMENT 'ก่อน; หลัง';",
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("COMMENT 'ก่อน; หลัง'");
  });

  it('ไม่ตัดที่ ; ใน block comment', () => {
    expect(splitStatements('/* a; b */ SELECT 1;')).toHaveLength(1);
  });
});

describe('declaredObjects — ของที่ไฟล์นี้สร้าง (ใช้ตอน --baseline)', () => {
  it('จับ ADD COLUMN ได้ทุกตัวใน ALTER เดียว และผูกกับตารางให้ถูก', () => {
    const { columns, tables } = declaredObjects(`
      ALTER TABLE \`members\`
        ADD COLUMN \`cluster_group_id\` varchar(45) DEFAULT NULL,
        ADD COLUMN \`sequence_index\` tinyint unsigned DEFAULT NULL;
    `);

    expect(tables).toEqual([]);
    expect(columns).toEqual([
      { table: 'members', column: 'cluster_group_id' },
      { table: 'members', column: 'sequence_index' },
    ]);
  });

  it('จับ CREATE TABLE ได้', () => {
    const { tables } = declaredObjects(
      'CREATE TABLE IF NOT EXISTS `reading_flags` (`id` int);',
    );

    expect(tables).toEqual(['reading_flags']);
  });

  it('ไฟล์ที่มีแต่ MODIFY COLUMN → ไม่มีของให้ตรวจ (--baseline ต้องไม่เดาว่ารันแล้ว)', () => {
    // เดาผิดทางนี้เจ็บกว่า: จดว่า "รันแล้ว" ให้ไฟล์ที่ยังไม่ได้รัน = ซ่อนคอลัมน์ที่หายไป
    // ไว้ใต้พรม แล้วไปโผล่เป็น ER_BAD_FIELD_ERROR ตอนใช้งานจริง
    const { tables, columns } = declaredObjects(
      'ALTER TABLE `members` MODIFY COLUMN `longitude` decimal(11,8) DEFAULT NULL;',
    );

    expect(tables).toEqual([]);
    expect(columns).toEqual([]);
  });

  it('อ่านไฟล์จริงในโฟลเดอร์ db แล้วต้องได้คอลัมน์ครบตามที่ไฟล์นั้นเพิ่ม', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '..', 'db', 'migrate-review-queue.sql'),
      'utf8',
    );

    expect(declaredObjects(sql).columns).toEqual([
      { table: 'unassigned_readings', column: 'members_id' },
      { table: 'unassigned_readings', column: 'blocked_code' },
      { table: 'unassigned_readings', column: 'blocked_reason' },
    ]);
  });
});

/**
 * ลำดับการรัน — ก่อนมี `-- requires:` ตัวรันเรียงตามชื่อไฟล์อย่างเดียว ซึ่งพาให้
 * migrate-bill-audit.sql (ต่อท้าย villages.meter_pitch_m) ไปรันก่อนไฟล์ที่สร้างคอลัมน์นั้น
 * แล้วพังทุกครั้งที่ตั้ง DB ใหม่ เทสต์ชุดนี้กันไม่ให้ลำดับกลับไปยึดชื่อไฟล์อีก
 */
describe('orderByDependency — เรียงตามที่ไฟล์ประกาศไว้', () => {
  const make = (name: string, requires: string[] = []) => ({
    name,
    fullPath: '/db/' + name,
    sql: '',
    checksum: '',
    requires,
  });

  it('ดันไฟล์ที่ถูกพึ่งพาขึ้นมาก่อน แม้ชื่อจะเรียงทีหลัง', () => {
    const ordered = orderByDependency([
      make('migrate-bill-audit.sql', ['migrate-village-meter-pitch.sql']),
      make('migrate-village-meter-pitch.sql'),
    ]);

    expect(ordered.map((file) => file.name)).toEqual([
      'migrate-village-meter-pitch.sql',
      'migrate-bill-audit.sql',
    ]);
  });

  it('ไฟล์ที่ไม่เกี่ยวข้องกันยังเรียงตามชื่อเหมือนเดิม', () => {
    const ordered = orderByDependency([
      make('migrate-a.sql'),
      make('migrate-b.sql'),
      make('migrate-c.sql'),
    ]);

    expect(ordered.map((file) => file.name)).toEqual([
      'migrate-a.sql',
      'migrate-b.sql',
      'migrate-c.sql',
    ]);
  });

  it('requires ที่ชี้ไปไฟล์ที่ไม่มีอยู่ → โยน error ไม่ใช่เงียบ ๆ ข้ามไป', () => {
    expect(() =>
      orderByDependency([make('migrate-a.sql', ['migrate-ไม่มีจริง.sql'])]),
    ).toThrow('migrate-ไม่มีจริง.sql');
  });

  it('requires วนกลับมาหาตัวเอง → โยน error พร้อมบอกเส้นทาง', () => {
    expect(() =>
      orderByDependency([
        make('migrate-a.sql', ['migrate-b.sql']),
        make('migrate-b.sql', ['migrate-a.sql']),
      ]),
    ).toThrow(/วนกลับมาหาตัวเอง/);
  });

  it('ไฟล์จริงใน db/ เรียงแล้วต้องไม่มีใครมาก่อนของที่ตัวเองต้องการ', () => {
    const dir = path.resolve(__dirname, '..', 'db');
    const files = fs
      .readdirSync(dir)
      .filter((name) => /^migrate-.*\.sql$/.test(name))
      .sort()
      .map((name) => {
        const sql = fs.readFileSync(path.join(dir, name), 'utf8');
        return {
          name,
          fullPath: path.join(dir, name),
          sql,
          checksum: '',
          requires: declaredRequires(sql),
        };
      });

    const seen = new Set<string>();
    for (const file of orderByDependency(files)) {
      for (const name of file.requires) {
        expect(seen.has(name)).toBe(true);
      }
      seen.add(file.name);
    }
  });
});

describe('declaredRequires — อ่านบรรทัด -- requires:', () => {
  it('อ่านได้ทั้งแบบคั่นจุลภาคและหลายบรรทัด แล้วตัดตัวซ้ำทิ้ง', () => {
    expect(
      declaredRequires(
        '-- requires: migrate-a.sql, migrate-b.sql\n' +
          '-- requires: migrate-b.sql\n' +
          'ALTER TABLE `x` ADD COLUMN `y` int;',
      ),
    ).toEqual(['migrate-a.sql', 'migrate-b.sql']);
  });

  it('ไฟล์ที่ไม่ประกาศอะไร → ไม่มีเงื่อนไขลำดับ', () => {
    expect(declaredRequires('ALTER TABLE `x` ADD COLUMN `y` int;')).toEqual([]);
  });
});
