import * as fs from 'node:fs';
import * as path from 'node:path';
import { declaredObjects, splitStatements } from './migrate';

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
