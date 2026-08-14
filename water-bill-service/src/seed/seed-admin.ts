import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { AdminEntity } from '../entity/admin.entity';

loadEnv();

const SALT_ROUNDS = 10;

/** bcrypt hash ขึ้นต้นด้วย $2a$ / $2b$ / $2y$ เสมอ ใช้เช็คว่ารหัสถูก hash แล้วหรือยัง */
const isHashed = (value: string): boolean => /^\$2[aby]\$/.test(value);

// ค่า default ตรงกับบัญชีทดสอบที่ระบุไว้ใน README
const email = process.env.SEED_ADMIN_EMAIL ?? 'somying@example.com';
const password = process.env.SEED_ADMIN_PASSWORD ?? 'password123';
const fname = process.env.SEED_ADMIN_FNAME ?? 'สมหญิง';
const lname = process.env.SEED_ADMIN_LNAME ?? 'ใจดี';

const dataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  username: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'water-bill-db',
  entities: [AdminEntity],
  synchronize: false,
});

// db/water-bill-db.sql เก่ากว่า AdminEntity อยู่ 5 คอลัมน์ (ดู README หัวข้อ "การแก้ schema ที่ทำไปแล้ว")
// เติมให้ครบก่อน ไม่งั้น repository จะพังด้วย Unknown column 'AdminEntity.email'
async function ensureAdminSchema(runner: QueryRunner): Promise<void> {
  const columns: { Field: string }[] = await runner.query(
    'SHOW COLUMNS FROM `admin`',
  );
  const has = (name: string) => columns.some((column) => column.Field === name);

  // เพิ่มเป็น NULL ไว้ก่อนเสมอ แล้วค่อยบังคับ NOT NULL ทีหลัง เผื่อตารางมีข้อมูลเดิมอยู่
  if (!has('email')) {
    console.log('🔧 เพิ่มคอลัมน์ admin.email');
    await runner.query(
      'ALTER TABLE `admin` ADD COLUMN `email` varchar(100) NULL AFTER `lname`',
    );
    await runner.query(
      "UPDATE `admin` SET `email` = CONCAT('user', id, '@example.com') WHERE `email` IS NULL",
    );
    await runner.query(
      'ALTER TABLE `admin` MODIFY COLUMN `email` varchar(100) NOT NULL',
    );
  }

  if (!has('create_date')) {
    console.log('🔧 เพิ่มคอลัมน์ admin.create_date');
    await runner.query(
      'ALTER TABLE `admin` ADD COLUMN `create_date` datetime NULL',
    );
    await runner.query(
      'UPDATE `admin` SET `create_date` = NOW() WHERE `create_date` IS NULL',
    );
    await runner.query(
      'ALTER TABLE `admin` MODIFY COLUMN `create_date` datetime NOT NULL',
    );
  }

  for (const column of ['create_by', 'modify_by'] as const) {
    if (!has(column)) {
      console.log(`🔧 เพิ่มคอลัมน์ admin.${column}`);
      await runner.query(
        `ALTER TABLE \`admin\` ADD COLUMN \`${column}\` int(11) DEFAULT NULL`,
      );
    }
  }

  if (!has('modify_date')) {
    console.log('🔧 เพิ่มคอลัมน์ admin.modify_date');
    await runner.query(
      'ALTER TABLE `admin` ADD COLUMN `modify_date` datetime DEFAULT NULL',
    );
  }

  // 🌟 รูปโปรไฟล์เก็บเป็น base64 data URL จึงต้องเป็น MEDIUMTEXT (varchar สั้นเกิน)
  //    ⚠️ ต้องเติมคอลัมน์นี้ "ก่อน" ที่สคริปต์จะเรียก repository.find() ข้างล่าง
  //    ไม่งั้น TypeORM จะ SELECT คอลัมน์ photo แล้วพังด้วย Unknown column ตั้งแต่ยังกู้อะไรไม่ได้เลย
  if (!has('photo')) {
    console.log('🔧 เพิ่มคอลัมน์ admin.photo');
    await runner.query(
      'ALTER TABLE `admin` ADD COLUMN `photo` mediumtext NULL',
    );
  }

  // 🌟 bcrypt hash ยาว 60 ตัว แต่ schema เดิมเป็น varchar(45)
  //    ถ้าไม่ขยายก่อน MySQL จะตัด hash ทิ้งเงียบ ๆ แล้วล็อกอินไม่ผ่านตลอดกาล
  const passwordColumn: { Type: string }[] = await runner.query(
    "SHOW COLUMNS FROM `admin` WHERE Field = 'password'",
  );
  if (passwordColumn[0] && /varchar\((\d+)\)/i.test(passwordColumn[0].Type)) {
    const width = Number(RegExp.$1);
    if (width < 255) {
      console.log(
        `🔧 ขยาย admin.password จาก varchar(${width}) เป็น varchar(255) ให้พอกับ bcrypt hash`,
      );
      await runner.query(
        'ALTER TABLE `admin` MODIFY COLUMN `password` varchar(255) NULL',
      );
    }
  }

  const indexes: { Key_name: string }[] = await runner.query(
    'SHOW INDEX FROM `admin`',
  );
  if (!indexes.some((index) => index.Key_name === 'IDX_admin_email')) {
    console.log('🔧 เพิ่ม unique key บน admin.email');
    await runner.query(
      'ALTER TABLE `admin` ADD UNIQUE KEY `IDX_admin_email` (`email`)',
    );
  }
}

async function main(): Promise<void> {
  await dataSource.initialize();

  const runner = dataSource.createQueryRunner();
  try {
    await ensureAdminSchema(runner);
  } finally {
    await runner.release();
  }

  const repository = dataSource.getRepository(AdminEntity);

  // 🌟 แปลงรหัสผ่าน plaintext ที่ค้างอยู่จากยุคก่อนใช้ bcrypt ให้เป็น hash
  //    ทำกับทุกบัญชี ไม่ใช่แค่บัญชี seed เพราะบัญชีที่สมัครไว้ก่อนหน้าก็เป็น plaintext เหมือนกัน
  const allAdmins = await repository.find();
  for (const account of allAdmins) {
    if (account.password && !isHashed(account.password)) {
      account.password = await bcrypt.hash(account.password, SALT_ROUNDS);
      await repository.save(account);
      console.log(`🔐 แปลงรหัสผ่านของ ${account.email} เป็น bcrypt แล้ว`);
    }
  }

  const existing = await repository.findOneBy({ email });
  if (existing) {
    console.log(
      `ℹ️  มีแอดมิน ${email} อยู่แล้ว (id: ${existing.id}) ข้ามการสร้าง`,
    );
    if (existing.id !== 1) {
      console.log(
        `⚠️  หน้าบ้านยัง hardcode create_by = 1 อยู่ แต่แอดมินตัวนี้ id = ${existing.id}`,
      );
    }
    return;
  }

  const admin = repository.create({
    fname,
    lname,
    email,
    // เก็บเฉพาะ hash ไม่เก็บรหัสจริง
    password: await bcrypt.hash(password, SALT_ROUNDS),
    role: 'admin',
    createDate: new Date(),
  });

  // ตารางอื่น (water_rates, villages, members, meter_readings) อ้าง create_by = 1 แบบ hardcode
  // เพราะยังไม่มีระบบ login ที่ส่ง id ของแอดมินที่ล็อกอินอยู่จริงมาให้
  // ถ้าตารางว่าง จึงตรึง id = 1 ไว้ ไม่ปล่อยให้ auto-increment แจกเลขอื่น
  if ((await repository.count()) === 0) {
    admin.id = 1;
  }

  const saved = await repository.save(admin);

  console.log(`✅ สร้างแอดมินเริ่มต้นสำเร็จ (id: ${saved.id})`);
  console.log(`   อีเมล: ${email}`);
  console.log(`   รหัสผ่าน: ${password}`);
}

main()
  .catch((error: unknown) => {
    console.error(
      '❌ สร้างแอดมินเริ่มต้นไม่สำเร็จ:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });
