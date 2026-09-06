/**
 * ตัวรันไฟล์ `db/migrate-*.sql` พร้อมสมุดบันทึกว่ารันอันไหนไปแล้ว
 *
 * ═══ ทำไมต้องมี ═══
 *
 * โปรเจกต์นี้ตั้ง `synchronize: false` (ถูกแล้ว — ห้ามให้ TypeORM แก้ schema ของจริงเอง)
 * แต่เดิมไม่มีที่ไหนบันทึกว่า DB เครื่องไหนรัน migration ตัวใดไปแล้ว อาการที่ตามมาคือ
 * `ER_BAD_FIELD_ERROR: Unknown column ...` ตอนรันจริง ซึ่งอ่านแล้วเหมือนบั๊กในโค้ด
 * ทั้งที่เป็นแค่ DB ตามหลัง repo อยู่หนึ่งไฟล์
 *
 * ตารางที่มาจดให้คือ `schema_migrations` — ชื่อไฟล์ + checksum + เวลาที่รัน
 *
 * ═══ วิธีใช้ ═══
 *
 *   npm run migrate                      รันทุกไฟล์ที่ยังไม่ได้รัน (เรียงตามชื่อไฟล์)
 *   npm run migrate -- db/migrate-x.sql  รันไฟล์เดียว (ระบุ path หรือแค่ชื่อไฟล์ก็ได้)
 *   npm run migrate -- --status          ดูว่ารันอะไรไปแล้ว เหลืออะไร ไม่แตะ DB
 *   npm run migrate -- --baseline        จด DB ปัจจุบันเป็นจุดตั้งต้น (ดูหัวข้อล่าง)
 *   npm run migrate -- --auto            โหมดที่ prestart เรียกเอง (ดูหัวข้อล่าง)
 *
 * ═══ โหมด --auto: รันพร้อมเซิร์ฟเวอร์ ═══
 *
 * ผูกไว้กับ `prestart` / `prestart:dev` ใน package.json — `npm start` ทุกครั้งจึงพา DB
 * ตามทัน repo ให้เองก่อนเซิร์ฟเวอร์จะขึ้น ต่างจากโหมดปกติสองข้อ:
 *
 *   1) ถ้าสมุด `schema_migrations` ยังว่าง จะ --baseline ให้ก่อนอัตโนมัติ ไม่งั้น DB ที่เคย
 *      รัน migration ด้วยมือมาก่อนจะถูกรันซ้ำทั้งชุดตั้งแต่ต้น
 *   2) ต่อ MySQL ไม่ติด/ไม่มีฐานข้อมูล = เตือนแล้วปล่อยผ่าน (เซิร์ฟเวอร์ยังขึ้นได้เหมือนเดิม)
 *      แต่ถ้าต่อติดแล้ว migration พัง = หยุดไม่ให้เซิร์ฟเวอร์ขึ้น เพราะนั่นแปลว่า schema
 *      ค้างกลางทาง ซึ่งจะไปโผล่เป็น ER_BAD_FIELD_ERROR ตอนมีคนใช้งานจริงแทน
 *
 * ═══ ลำดับการรัน ═══
 *
 * ตั้งต้นเรียงตามชื่อไฟล์ แล้วจัดใหม่ตามที่แต่ละไฟล์ประกาศไว้ในหัวไฟล์:
 *
 *   -- requires: migrate-village-meter-pitch.sql, migrate-meter-digits.sql
 *
 * เดิมลำดับยึดชื่อไฟล์อย่างเดียว ซึ่ง **ไม่ตรงกับลำดับที่รันได้จริง** — ตัวอย่างที่ชัดที่สุดคือ
 * migrate-bill-audit.sql เติมคอลัมน์ต่อท้าย meter_pitch_m ซึ่ง migrate-village-meter-pitch.sql
 * เป็นคนสร้าง แต่ชื่อ bill- มาก่อน village- ตามตัวอักษร การรันรวดบน DB ที่ตั้งใหม่จึงพังเสมอ
 * (บน DB ที่ baseline มาแล้วอาการนี้ถูกบังไว้จนมองไม่เห็น)
 *
 * ไฟล์ที่ไม่ประกาศอะไรยังเรียงตามชื่อเหมือนเดิม — ใส่ `-- requires:` เฉพาะตอนที่ไฟล์นั้น
 * อ้างถึงตาราง/คอลัมน์ที่ไฟล์อื่นเป็นคนสร้าง
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import mysql, { Connection, RowDataPacket } from 'mysql2/promise';
import { config as loadEnv } from 'dotenv';

// สคริปต์นี้รันนอก Nest จึงไม่มี ConfigModule มาอ่าน .env ให้ ต้องอ่านเอง
// (อ้างจากตำแหน่งไฟล์ ไม่ใช่ cwd — prestart ถูกเรียกจากที่ไหนก็ได้)
loadEnv({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const DB = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  // รับทั้งสองชื่อ: .env ของโปรเจกต์ใช้ DB_USERNAME/DB_DATABASE ส่วน DB_USER/DB_NAME
  // เป็นชื่อที่สคริปต์นี้เคยอ่านมาก่อน — เครื่องที่ตั้งชื่อเก่าไว้จะได้ไม่พัง
  user: process.env.DB_USERNAME ?? process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  // app.module.ts อ่านจาก .env ชุดเดียวกันนี้แล้ว ไม่ต้องแก้สองที่อีก
  database: process.env.DB_DATABASE ?? process.env.DB_NAME ?? 'water-bill-db',
};

/**
 * error ที่แปลว่า "ยังไปไม่ถึง DB" — คนละเรื่องกับ "migration พัง"
 *
 * โหมด --auto ปล่อยผ่านกลุ่มนี้ เพราะเซิร์ฟเวอร์ที่ไม่มี DB ก็แค่ error ตอนมีคนเรียก API
 * เหมือนเดิมทุกประการ ไม่ใช่สถานะใหม่ที่ตัวรันนี้ทำให้เกิด — การบล็อกไม่ให้ start
 * ตรงนี้จะกลายเป็นว่าเปิด MySQL ไม่ทันแล้วแตะโค้ดฝั่ง frontend ไม่ได้เลย
 */
const CANNOT_REACH_DB = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ER_BAD_DB_ERROR',
  'ER_ACCESS_DENIED_ERROR',
]);

const MIGRATION_DIR = path.resolve(__dirname, '..', 'db');

/**
 * รับเฉพาะ `migrate-*.sql` — ไฟล์อื่นในโฟลเดอร์เดียวกันเป็นคนละชนิดงาน
 * (`water-bill-db.sql` = schema ทั้งก้อน, `seed-minimum.sql` = ข้อมูลตั้งต้น,
 * `cleanup-orphan-readings.sql` = งานเก็บกวาดที่ตั้งใจให้รันซ้ำได้เรื่อย ๆ)
 */
const MIGRATION_PATTERN = /^migrate-.*\.sql$/;

/** error ที่แปลว่า "ของชิ้นนี้มีอยู่แล้ว" — ข้ามได้ ไม่ใช่ความผิดพลาด */
const ALREADY_EXISTS = new Set([
  'ER_DUP_FIELDNAME', // ADD COLUMN ซ้ำ
  'ER_DUP_KEYNAME', // ADD KEY / ADD UNIQUE ซ้ำ
  'ER_TABLE_EXISTS_ERROR', // CREATE TABLE ซ้ำ
  'ER_CANT_DROP_FIELD_OR_KEY', // DROP ของที่ถูกลบไปแล้ว
]);

interface MigrationFile {
  name: string;
  fullPath: string;
  sql: string;
  checksum: string;
  /** ไฟล์ที่ต้องรันก่อนหน้าไฟล์นี้ — ประกาศด้วย `-- requires:` ในหัวไฟล์ */
  requires: string[];
}

/**
 * อ่านบรรทัด `-- requires: a.sql, b.sql` ออกจากคอมเมนต์ในไฟล์
 *
 * รับได้ทั้งหลายบรรทัดและคั่นจุลภาคในบรรทัดเดียว — เขียนแบบไหนก็อ่านออกเหมือนกัน
 * เพราะสิ่งที่ต้องกันคือ "ลืมประกาศ" ไม่ใช่ "ประกาศผิดรูปแบบ"
 */
export function declaredRequires(sql: string): string[] {
  const required: string[] = [];
  for (const match of sql.matchAll(/^\s*--\s*requires:\s*(.+)$/gim)) {
    for (const name of match[1].split(',')) {
      const trimmed = name.trim();
      if (trimmed) required.push(path.basename(trimmed));
    }
  }
  return [...new Set(required)];
}

/**
 * เรียงไฟล์ให้ตัวที่ถูกพึ่งพามาก่อนเสมอ
 *
 * ไล่ตามลำดับชื่อไฟล์เป็นตัวตั้ง แต่ก่อนจะหยิบไฟล์ไหน ลงไปหยิบไฟล์ที่มันต้องการขึ้นมาก่อน
 * ผลคือไฟล์ที่ไม่เกี่ยวข้องกันยังเรียงตามชื่อเหมือนเดิม ลำดับจึงยังเดาได้ ไม่ใช่สลับไปทั้งชุด
 * ทุกครั้งที่เพิ่มไฟล์ใหม่เข้ามา
 */
export function orderByDependency(files: MigrationFile[]): MigrationFile[] {
  const byName = new Map(files.map((file) => [file.name, file]));
  const ordered: MigrationFile[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (file: MigrationFile, trail: string[]): void => {
    if (done.has(file.name)) return;
    if (visiting.has(file.name)) {
      throw new Error(
        `requires วนกลับมาหาตัวเอง: ${[...trail, file.name].join(' -> ')}`,
      );
    }
    visiting.add(file.name);

    for (const name of file.requires) {
      const dependency = byName.get(name);
      if (!dependency) {
        throw new Error(
          `${file.name} ประกาศ requires: ${name} แต่ไม่มีไฟล์นั้นอยู่ใน db/`,
        );
      }
      visit(dependency, [...trail, file.name]);
    }

    visiting.delete(file.name);
    done.add(file.name);
    ordered.push(file);
  };

  for (const file of files) visit(file, []);
  return ordered;
}

function loadFiles(): MigrationFile[] {
  const files = fs
    .readdirSync(MIGRATION_DIR)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort()
    .map((name) => {
      const fullPath = path.join(MIGRATION_DIR, name);
      const sql = fs.readFileSync(fullPath, 'utf8');
      return {
        name,
        fullPath,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
        requires: declaredRequires(sql),
      };
    });

  return orderByDependency(files);
}

/**
 * ตัด SQL ก้อนเดียวเป็นคำสั่งย่อย โดยไม่หลงเครื่องหมาย `;` ที่อยู่ในคอมเมนต์หรือในสตริง
 *
 * ต้องรันทีละคำสั่งเพราะสองเหตุผล: ข้อความ error จะได้ชี้ว่าคำสั่งไหนพัง
 * และคำสั่งที่ล้มเพราะ "ของมีอยู่แล้ว" จะได้ข้ามเป็นรายตัวได้ (ดู ALREADY_EXISTS)
 *
 * ⚠️ ไม่รองรับ DELIMITER / stored procedure — ไฟล์ในโปรเจกต์นี้ไม่มี ถ้าวันหลังมี
 *    ต้องมาแก้ตรงนี้ก่อน ไม่งั้นจะถูกตัดกลางตัว
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      current += char;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        current += '*/';
        i++;
        continue;
      }
      current += char;
      continue;
    }
    if (quote) {
      current += char;
      // MySQL หนีอักขระได้ทั้ง `\'` และ `''` — ตัวหลังจะถูกอ่านเป็นปิดแล้วเปิดใหม่
      // ซึ่งให้ผลเหมือนกันสำหรับงานตัดคำสั่ง จึงไม่ต้องแยกเคส
      if (char === '\\') {
        current += next ?? '';
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      lineComment = true;
      current += char;
      continue;
    }
    if (char === '#') {
      lineComment = true;
      current += char;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      current += '/*';
      i++;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';') {
      statements.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  statements.push(current);

  // ตัดก้อนที่เหลือแต่คอมเมนต์/ช่องว่างทิ้ง — ส่งเข้า MySQL จะได้ syntax error เปล่า ๆ
  return statements.filter((statement) => hasSql(statement));
}

/** ก้อนนี้มีคำสั่งจริงไหม หรือมีแต่คอมเมนต์กับช่องว่าง */
function hasSql(statement: string): boolean {
  return (
    statement
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*(--|#).*$/gm, '')
      .trim().length > 0
  );
}

/**
 * ของที่ไฟล์นี้ตั้งใจสร้าง — ใช้เดาว่า DB ปัจจุบัน "รันไฟล์นี้ไปแล้วหรือยัง" ตอน baseline
 *
 * ดูแค่ตารางกับคอลัมน์ที่ถูกเพิ่ม เพราะเป็นสองอย่างที่ตรวจย้อนหลังได้ตรง ๆ จาก
 * information_schema ส่วน index/ค่า default/การแก้ชนิดคอลัมน์ ตรวจแล้วก็ยังไม่ชี้ขาด
 */
export function declaredObjects(sql: string): {
  tables: string[];
  columns: { table: string; column: string }[];
} {
  const tables: string[] = [];
  const columns: { table: string; column: string }[] = [];

  for (const statement of splitStatements(sql)) {
    const clean = statement
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*(--|#).*$/gm, ' ');

    const created = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/i.exec(
      clean,
    );
    if (created) {
      tables.push(created[1]);
      continue;
    }

    const altered = /ALTER\s+TABLE\s+`?(\w+)`?/i.exec(clean);
    if (!altered) continue;

    for (const match of clean.matchAll(/ADD\s+COLUMN\s+`?(\w+)`?/gi)) {
      columns.push({ table: altered[1], column: match[1] });
    }
  }

  return { tables, columns };
}

async function ensureLedger(connection: Connection): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS \`schema_migrations\` (
      \`name\` varchar(191) NOT NULL,
      \`checksum\` char(64) NOT NULL,
      \`applied_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`applied_by\` varchar(100) DEFAULT NULL COMMENT 'ชื่อเครื่อง/คนที่รัน',
      \`baselined\` tinyint NOT NULL DEFAULT 0 COMMENT '1 = จดว่ารันแล้วโดยไม่ได้รันจริง',
      PRIMARY KEY (\`name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function appliedMap(
  connection: Connection,
): Promise<Map<string, { checksum: string; baselined: number }>> {
  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT `name`, `checksum`, `baselined` FROM `schema_migrations`',
  );
  return new Map(
    rows.map((row) => [
      String(row.name),
      { checksum: String(row.checksum), baselined: Number(row.baselined) },
    ]),
  );
}

async function record(
  connection: Connection,
  file: MigrationFile,
  baselined: boolean,
): Promise<void> {
  await connection.query(
    'INSERT INTO `schema_migrations` (`name`, `checksum`, `applied_by`, `baselined`) VALUES (?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE `checksum` = VALUES(`checksum`), `applied_at` = CURRENT_TIMESTAMP',
    [file.name, file.checksum, process.env.USERNAME ?? null, baselined ? 1 : 0],
  );
}

/** รันไฟล์เดียว — คืนจำนวนคำสั่งที่ข้ามเพราะของมีอยู่แล้ว */
async function runFile(
  connection: Connection,
  file: MigrationFile,
): Promise<number> {
  const statements = splitStatements(file.sql);
  let skipped = 0;

  for (const [index, statement] of statements.entries()) {
    try {
      await connection.query(statement);
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err.code && ALREADY_EXISTS.has(err.code)) {
        // เกิดตอนไฟล์เคยรันไปได้ครึ่งทางแล้วพัง (DDL ของ MySQL ย้อนกลับไม่ได้)
        // ข้ามแล้วไปต่อ เพื่อให้รันซ้ำจนจบไฟล์ได้ ไม่ใช่ติดค้างตรงคำสั่งเดิมตลอดไป
        console.log(
          `    ↷ ข้ามคำสั่งที่ ${index + 1} — มีอยู่แล้ว (${err.code})`,
        );
        skipped++;
        continue;
      }
      console.error(
        `\n❌ ${file.name} พังที่คำสั่งที่ ${index + 1}:\n${statement.trim().slice(0, 400)}\n`,
      );
      throw error;
    }
  }

  return skipped;
}

/**
 * เดาว่าไฟล์นี้ถูกรันไปแล้วหรือยัง จากของที่มีอยู่จริงใน DB
 *
 * 'applied'  = ของที่ไฟล์นี้สร้างมีครบแล้ว
 * 'pending'  = ยังไม่มีสักชิ้น
 * 'partial'  = มีบางชิ้น -> อันตรายที่สุด ต้องให้คนดูเอง ห้ามจดว่ารันแล้ว
 * 'unknown'  = ไฟล์นี้ไม่ได้สร้างตาราง/คอลัมน์ใหม่ (มีแต่ UPDATE ข้อมูล ฯลฯ) ตรวจไม่ได้
 */
async function guessState(
  connection: Connection,
  file: MigrationFile,
): Promise<'applied' | 'pending' | 'partial' | 'unknown'> {
  const { tables, columns } = declaredObjects(file.sql);
  if (tables.length === 0 && columns.length === 0) return 'unknown';

  const checks: boolean[] = [];

  for (const table of tables) {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [DB.database, table],
    );
    checks.push(rows.length > 0);
  }

  for (const { table, column } of columns) {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [DB.database, table, column],
    );
    checks.push(rows.length > 0);
  }

  if (checks.every(Boolean)) return 'applied';
  if (checks.every((found) => !found)) return 'pending';
  return 'partial';
}

async function showStatus(
  connection: Connection,
  files: MigrationFile[],
): Promise<void> {
  const applied = await appliedMap(connection);

  console.log(`\n📋 สถานะ migration ของ DB "${DB.database}"\n`);
  for (const file of files) {
    const row = applied.get(file.name);
    if (!row) {
      const guess = await guessState(connection, file);
      const hint =
        guess === 'applied'
          ? ' (แต่ของใน DB มีครบแล้ว — น่าจะเคยรันมือ ใช้ --baseline จดให้ตรง)'
          : guess === 'partial'
            ? ' ⚠️ มีของบางชิ้นแล้ว — เคยรันค้างไว้กลางทาง ต้องดูเอง'
            : '';
      console.log(`  ⬜ ${file.name}${hint}`);
      continue;
    }

    const changed = row.checksum !== file.checksum;
    const mark = row.baselined ? '📎' : '✅';
    console.log(
      `  ${mark} ${file.name}${row.baselined ? ' (baseline)' : ''}` +
        // ไฟล์ที่ถูกแก้หลังรันไปแล้ว = ของใน DB กับในไฟล์ไม่ตรงกันอีกต่อไป
        (changed ? ' ⚠️ ไฟล์ถูกแก้หลังรันไปแล้ว' : ''),
    );
  }
  console.log('');
}

/**
 * จด DB ปัจจุบันเป็นจุดตั้งต้น — สำหรับเครื่องที่รัน migration มือมาก่อนมีตัวรันนี้
 *
 * จดเฉพาะไฟล์ที่ตรวจแล้วว่าของมีครบใน DB จริง ๆ ไม่ใช่จดรวดทุกไฟล์ —
 * การจดว่า "รันแล้ว" ให้ไฟล์ที่ยังไม่ได้รัน คือการซ่อนคอลัมน์ที่หายไปไว้ใต้พรม
 * แล้วมันจะไปโผล่เป็น ER_BAD_FIELD_ERROR ตอนใช้งานจริงแทน
 */
async function baseline(
  connection: Connection,
  files: MigrationFile[],
): Promise<void> {
  const applied = await appliedMap(connection);
  let marked = 0;

  for (const file of files) {
    if (applied.has(file.name)) continue;

    const state = await guessState(connection, file);
    if (state === 'applied') {
      await record(connection, file, true);
      console.log(`  📎 จด ${file.name} ว่ารันแล้ว (ของมีครบใน DB)`);
      marked++;
    } else if (state === 'partial') {
      console.log(
        `  ⚠️  ${file.name} มีของบางชิ้นแล้ว — ไม่จดให้ ต้องเปิดไฟล์ดูเองว่าค้างตรงไหน`,
      );
    } else if (state === 'unknown') {
      console.log(
        `  ❔ ${file.name} ไม่ได้สร้างตาราง/คอลัมน์ใหม่ ตรวจย้อนหลังไม่ได้ — ` +
          'ถ้ารู้ว่ารันไปแล้วให้สั่งรันไฟล์นี้ตรง ๆ (คำสั่งที่ซ้ำจะถูกข้ามให้)',
      );
    } else {
      console.log(
        `  ⬜ ${file.name} ยังไม่ได้รัน — ปล่อยไว้ให้ npm run migrate`,
      );
    }
  }

  console.log(`\nจดเป็นจุดตั้งต้นแล้ว ${marked} ไฟล์\n`);
}

async function migrate(
  connection: Connection,
  files: MigrationFile[],
  only?: string,
): Promise<void> {
  const applied = await appliedMap(connection);

  const targets = only
    ? files.filter((file) => file.name === only)
    : files.filter((file) => !applied.has(file.name));

  if (only && targets.length === 0) {
    throw new Error(
      `ไม่พบไฟล์ "${only}" ใน ${MIGRATION_DIR} (ต้องขึ้นต้นด้วย migrate- และลงท้ายด้วย .sql)`,
    );
  }
  if (targets.length === 0) {
    console.log('\n✨ ไม่มีอะไรต้องรัน — DB ตามทัน repo แล้วครับ\n');
    return;
  }

  console.log(`\n▶ จะรัน ${targets.length} ไฟล์:\n`);
  for (const file of targets) {
    const seen = applied.get(file.name);
    if (seen && only) {
      console.log(
        `  ↻ ${file.name} เคยรันไปแล้ว (${seen.baselined ? 'baseline' : 'รันจริง'}) — รันซ้ำตามที่สั่ง`,
      );
    }

    const skipped = await runFile(connection, file);
    await record(connection, file, false);
    console.log(
      `  ✅ ${file.name}${skipped ? ` (ข้าม ${skipped} คำสั่งที่มีอยู่แล้ว)` : ''}`,
    );
  }
  console.log('');
}

/**
 * โหมดที่ prestart เรียก — พา DB ตามทัน repo แบบไม่ต้องมีคนสั่ง
 *
 * baseline ให้เองเฉพาะตอนสมุดยังว่างเปล่า ซึ่งแปลได้อย่างเดียวว่า DB ก้อนนี้ตั้งมา
 * ก่อนตัวรันนี้จะมี — ตัว baseline เองจดเฉพาะไฟล์ที่ตรวจแล้วว่าของมีครบใน DB จริง
 * ไฟล์ที่ยังไม่ได้รันจะถูกปล่อยให้ migrate() รันต่อตามปกติ ไม่มีอะไรถูกซ่อนไว้
 */
async function auto(
  connection: Connection,
  files: MigrationFile[],
): Promise<void> {
  const applied = await appliedMap(connection);

  if (applied.size === 0) {
    console.log(
      '\n📎 DB นี้ยังไม่เคยจดจุดตั้งต้น — baseline ให้อัตโนมัติก่อนหนึ่งครั้ง\n',
    );
    await baseline(connection, files);
  }

  await migrate(connection, files);
}

/**
 * โหมด --auto สำหรับสคริปต์อื่นเรียกใช้ (db-setup)
 *
 * ต่างจากที่ main() ทำตรงที่ **ไม่ปล่อยผ่านตอนต่อ DB ไม่ติด** — ที่นั่นยอมผ่าน
 * เพราะเป้าหมายคือ "อย่าขวางไม่ให้เซิร์ฟเวอร์ขึ้น" แต่ตอนตั้งฐานข้อมูล การต่อไม่ติด
 * คือความล้มเหลวของงานนั้นตรง ๆ ไม่ใช่เรื่องที่ข้ามไปแล้วทำต่อได้
 */
export async function autoMigrate(): Promise<void> {
  const files = loadFiles();
  const connection = await mysql.createConnection({
    ...DB,
    multipleStatements: false,
  });
  try {
    await ensureLedger(connection);
    await auto(connection, files);
  } finally {
    await connection.end();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantStatus = args.includes('--status');
  const wantBaseline = args.includes('--baseline');
  const wantAuto = args.includes('--auto');
  const fileArg = args.find((arg) => !arg.startsWith('--'));
  const only = fileArg ? path.basename(fileArg) : undefined;

  const files = loadFiles();
  if (files.length === 0) {
    throw new Error(`ไม่พบไฟล์ migrate-*.sql ใน ${MIGRATION_DIR}`);
  }

  let connection: Connection;
  try {
    connection = await mysql.createConnection({
      ...DB,
      multipleStatements: false,
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    // ดูคอมเมนต์ที่ CANNOT_REACH_DB ว่าทำไม --auto ถึงไม่บล็อกการ start ตรงนี้
    if (wantAuto && code && CANNOT_REACH_DB.has(code)) {
      console.warn(
        `\n⚠️  ข้าม migration อัตโนมัติ — ต่อ DB "${DB.database}" ที่ ${DB.host}:${DB.port} ไม่ได้ (${code})\n` +
          '   เซิร์ฟเวอร์จะขึ้นต่อ แต่ทุก endpoint ที่แตะ DB จะ error จนกว่าจะเปิด MySQL\n' +
          '   เปิดแล้วสั่ง npm run migrate เองได้เลย ไม่ต้องรีสตาร์ท\n',
      );
      return;
    }
    throw error;
  }

  try {
    await ensureLedger(connection);

    if (wantStatus) {
      await showStatus(connection, files);
      return;
    }
    if (wantBaseline) {
      await baseline(connection, files);
      return;
    }
    if (wantAuto) {
      await auto(connection, files);
      return;
    }

    await migrate(connection, files, only);
  } finally {
    await connection.end();
  }
}

// รันเป็นสคริปต์ (ไม่ใช่ตอนถูก import เข้าไปในเทสต์)
if (require.main === module) {
  main().catch((error) => {
    const err = error as { code?: string; message?: string };
    if (err.code === 'ECONNREFUSED') {
      console.error(
        `\n❌ ต่อ MySQL ที่ ${DB.host}:${DB.port} ไม่ได้ — เปิด MySQL อยู่หรือเปล่าครับ\n`,
      );
    } else if (err.code === 'ER_BAD_DB_ERROR') {
      console.error(
        `\n❌ ไม่พบฐานข้อมูล "${DB.database}" — สร้างก่อนด้วย db/water-bill-db.sql\n`,
      );
    } else {
      console.error(`\n❌ ${err.message ?? String(error)}\n`);
    }
    process.exitCode = 1;
  });
}
