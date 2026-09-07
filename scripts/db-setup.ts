/**
 * ตั้งฐานข้อมูลทั้งก้อนด้วยคำสั่งเดียว — `npm run db:setup`
 *
 * ═══ ทำไมต้องมี ═══
 *
 * ก่อนหน้านี้การตั้งเครื่องใหม่มีสี่ขั้นที่ต้องจำลำดับเอง: สร้าง database ใน
 * phpMyAdmin → import `db/water-bill-db.sql` → รัน migration → `npm run seed:admin`
 * ขั้นไหนหลุดไปก็ไปโผล่เป็น `ER_BAD_FIELD_ERROR` หรือ "ล็อกอินไม่ได้" ทีหลัง
 * ซึ่งอ่านแล้วเหมือนบั๊กในโค้ด ไม่เหมือนขั้นตอนติดตั้งที่ทำไม่ครบ
 *
 * ไฟล์นี้ทำสี่ขั้นนั้นให้ตามลำดับที่ถูก:
 *
 *   1) สร้าง database (ถ้ายังไม่มี) เป็น utf8mb4_unicode_ci ตั้งแต่แรก
 *   2) import `db/water-bill-db.sql` — schema + ข้อมูลจังหวัด/อำเภอ/ตำบล 8,342 แถว
 *   3) รัน migration ที่ยังไม่ได้รวมเข้า dump ทั้งหมด (ตัวเดียวกับที่ prestart เรียก)
 *   4) สร้างแอดมินเริ่มต้นจาก SEED_ADMIN_* ใน .env
 *
 * ⚠️ ลำดับนี้เดินทางเดียวได้เพราะคอลัมน์ที่ตาราง `admin` ในดัมป์ยังขาด ถูกย้าย
 *    ไปอยู่ใน `db/migrate-admin-columns.sql` แล้ว ก่อนหน้านี้มันซ่อนอยู่ใน seed:admin
 *    ทำให้ลำดับเป็นวงกลม (migration รอคอลัมน์จาก seed / seed รอคอลัมน์จาก migration)
 *
 * ═══ รันซ้ำได้ ═══
 *
 * ขั้น 2 จะ **ข้ามไปเลยถ้าฐานข้อมูลมีตารางอยู่แล้ว** — ไฟล์ dump มี INSERT ข้อมูล
 * จังหวัด/ตำบลอยู่ด้วย การ import ทับของที่มีอยู่จะพังที่ primary key ซ้ำกลางทาง
 * แล้วทิ้ง schema ค้างครึ่ง ๆ ไว้ ส่วนขั้น 3 กับ 4 รันซ้ำได้อยู่แล้วโดยตัวมันเอง
 *
 * ⚠️ ไม่มีโหมดล้างฐานข้อมูลทิ้งแล้วสร้างใหม่โดยตั้งใจ — คำสั่งที่ลบข้อมูลจริงได้
 *    ไม่ควรอยู่ในสคริปต์ที่คนพิมพ์บ่อย ๆ ถ้าจะเริ่มใหม่ทั้งก้อนให้ DROP DATABASE
 *    เองใน phpMyAdmin แล้วค่อยรันคำสั่งนี้
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { config as loadEnv } from 'dotenv';
import { autoMigrate, splitStatements } from './migrate';
import { seedAdmin } from '../src/seed/seed-admin';

loadEnv({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const DB = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME ?? process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
};

const DATABASE =
  process.env.DB_DATABASE ?? process.env.DB_NAME ?? 'water-bill-db';

const DUMP = path.resolve(__dirname, '..', 'db', 'water-bill-db.sql');

/** สร้าง database ถ้ายังไม่มี — คืนค่าว่าเพิ่งสร้างใหม่หรือมีอยู่แล้ว */
async function ensureDatabase(): Promise<boolean> {
  const connection = await mysql.createConnection(DB);
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [DATABASE],
    );
    if (rows.length > 0) {
      console.log(`  • มีฐานข้อมูล "${DATABASE}" อยู่แล้ว`);
      return false;
    }

    // ตั้ง charset ตั้งแต่ตอนสร้าง ตารางที่เกิดทีหลังจะได้ไม่ต้องตามแปลงอีกรอบ
    await connection.query(
      `CREATE DATABASE \`${DATABASE.replace(/`/g, '``')}\` ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    );
    console.log(`  ✅ สร้างฐานข้อมูล "${DATABASE}" แล้ว`);
    return true;
  } finally {
    await connection.end();
  }
}

/**
 * import dump ถ้าฐานข้อมูลยังว่าง
 *
 * ตัดเป็นคำสั่งย่อยด้วยตัวเดียวกับที่ `npm run migrate` ใช้ (splitStatements)
 * เพื่อให้บอกได้ว่าพังที่คำสั่งไหน — ส่งทั้งไฟล์ก้อนเดียวเข้าไปแล้วพัง
 * จะได้แต่ "You have an error in your SQL syntax" โดยไม่รู้ว่าบรรทัดไหน
 */
async function importDump(): Promise<void> {
  if (!fs.existsSync(DUMP)) {
    throw new Error(`ไม่พบไฟล์ dump ที่ ${DUMP}`);
  }

  const connection = await mysql.createConnection({
    ...DB,
    database: DATABASE,
    multipleStatements: false,
  });

  try {
    const [tables] = await connection.query<RowDataPacket[]>(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [DATABASE],
    );
    if (tables.length > 0) {
      console.log(
        `  • ข้ามการ import — มีตารางอยู่แล้ว ${tables.length} ตาราง (ดูเหตุผลหัวไฟล์)`,
      );
      return;
    }

    const statements = splitStatements(fs.readFileSync(DUMP, 'utf8'));
    console.log(
      `  ▶ import ${path.basename(DUMP)} (${statements.length} คำสั่ง)`,
    );

    for (const [index, statement] of statements.entries()) {
      try {
        await connection.query(statement);
      } catch (error) {
        console.error(
          `\n❌ dump พังที่คำสั่งที่ ${index + 1}:\n${statement.trim().slice(0, 300)}\n`,
        );
        throw error;
      }
    }
    console.log('  ✅ import dump เรียบร้อย');
  } finally {
    await connection.end();
  }
}

async function main(): Promise<void> {
  console.log(`\n🛠  ตั้งฐานข้อมูล "${DATABASE}" ที่ ${DB.host}:${DB.port}\n`);

  console.log('[1/4] ฐานข้อมูล');
  await ensureDatabase();

  console.log('\n[2/4] schema + ข้อมูลจังหวัด/อำเภอ/ตำบล');
  await importDump();

  console.log('\n[3/4] migration');
  await autoMigrate();

  console.log('[4/4] แอดมินเริ่มต้น');
  await seedAdmin();

  console.log(
    '\n✨ ฐานข้อมูลพร้อมใช้งานแล้ว — สั่ง npm run start:dev ได้เลยครับ\n',
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const err = error as { code?: string; message?: string };
    if (err.code === 'ECONNREFUSED') {
      console.error(
        `\n❌ ต่อ MySQL ที่ ${DB.host}:${DB.port} ไม่ได้ — เปิด MySQL ใน XAMPP แล้วหรือยังครับ\n`,
      );
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error(
        `\n❌ ผู้ใช้ "${DB.user}" เข้า MySQL ไม่ได้ — เช็ค DB_USERNAME / DB_PASSWORD ใน .env\n`,
      );
    } else {
      console.error(`\n❌ ${err.message ?? String(error)}\n`);
    }
    process.exitCode = 1;
  });
}
