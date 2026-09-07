/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unnecessary-type-assertion */
/** Real MySQL integration tests, always against a newly restored copy. */
import { strict as assert } from 'node:assert';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import mysql, { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  createBackup,
  restoreBackup,
  sourceDatabase,
  connectionOptions,
  assertRestoreTarget,
  tableCounts,
} from './backup';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';

async function main() {
  const project = resolve(__dirname, '..');
  const originalCwd = process.cwd();
  const originalDatabase = process.env.DB_DATABASE;
  const target = `water_bill_restore_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const source = await mysql.createConnection(connectionOptions);
  let database: mysql.Connection | undefined;
  let app: NestExpressApplication | undefined;
  let created = false;
  let backup = '';
  let completed = false;
  const checks: string[] = [];
  const fingerprint = async () => {
    const counts = await tableCounts(source, sourceDatabase);
    const checksums: Record<string, unknown> = {};
    for (const table of Object.keys(counts)) {
      const name =
        '`' +
        sourceDatabase.replace(/`/g, '``') +
        '`.`' +
        table.replace(/`/g, '``') +
        '`';
      const [rows] = await source.query<RowDataPacket[]>(
        `CHECKSUM TABLE ${name}`,
      );
      checksums[table] = rows[0].Checksum;
    }
    return { counts, checksums };
  };
  const before = await fingerprint();
  try {
    backup = await createBackup();
    // Exercise image restoration even when this installation has no uploads yet.
    // The real backup remains untouched; only this explicitly separate fixture has a synthetic image.
    const fixture = join(backup, 'restore-test-fixture');
    await mkdir(join(fixture, 'uploads'), { recursive: true });
    await copyFile(join(backup, 'database.sql'), join(fixture, 'database.sql'));
    const manifest = JSON.parse(
      await readFile(join(backup, 'manifest.json'), 'utf8'),
    );
    for (const name of Object.keys(manifest.files).filter((name) =>
      name.startsWith('uploads/'),
    )) {
      await mkdir(resolve(fixture, name, '..'), { recursive: true });
      await copyFile(join(backup, name), join(fixture, name));
    }
    const sample = await sharp({
      create: { width: 8, height: 8, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const sampleName = `uploads/test-${randomUUID()}.png`;
    await writeFile(join(fixture, sampleName), sample);
    manifest.files[sampleName] = createHash('sha256')
      .update(sample)
      .digest('hex');
    manifest.testFixture = true;
    await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
    await restoreBackup(fixture, target);
    created = true;
    assert.deepEqual(await readFile(join(fixture, target, sampleName)), sample);
    checks.push('Backup SHA-256 and restored row counts match for every table');
    checks.push(
      'Restored image bytes match (synthetic fixture kept separate from real backup)',
    );
    database = await mysql.createConnection({
      ...connectionOptions,
      database: target,
    });
    const insert = async (
      sql: string,
      values: Array<string | number | null>,
    ) => {
      const [result] = await database!.execute<ResultSetHeader>(sql, values);
      return result.insertId;
    };
    const { hash } = await import('bcryptjs');
    const password = randomBytes(18).toString('base64url');
    const email = `integration-${randomBytes(5).toString('hex')}@example.invalid`;
    const admin = await insert(
      'INSERT INTO admin (fname,lname,email,password,admin_role,create_date) VALUES (?,?,?,?,?,NOW())',
      ['Integration', 'Test', email, await hash(password, 10), 'owner'],
    );
    const ids: number[] = [];
    for (const table of ['provinces', 'districts', 'subdistricts']) {
      const [rows] = await database.query<RowDataPacket[]>(
        `SELECT MIN(id) AS id FROM ${table}`,
      );
      assert(rows[0].id, 'Reference location data is missing');
      ids.push(rows[0].id);
    }
    const village = await insert(
      'INSERT INTO villages (provinces_id,districts_id,subdistricts_id,village_name,village_no,create_date,create_by) VALUES (?,?,?,?,?,CURDATE(),?)',
      [...ids, 'Integration test only', 'TEST', admin],
    );
    const rate = await insert(
      'INSERT INTO water_rates (price_per_unit,status,create_date,create_by) VALUES (?, ?, CURDATE(), ?)',
      [10, 'Active', admin],
    );
    // Random test-only phones; avoid sharing links with any restored resident.
    const phone = '09' + String(Date.now()).slice(-8);
    const member = await insert(
      'INSERT INTO members (fname,lname,house_no,phone,villages_id,create_date,create_by) VALUES (?,?,?,?,?,CURDATE(),?)',
      ['Test', 'Resident', randomUUID().slice(0, 12), phone, village, admin],
    );
    const other = await insert(
      'INSERT INTO members (fname,lname,house_no,phone,villages_id,create_date,create_by) VALUES (?,?,?,?,?,CURDATE(),?)',
      ['Other', 'Resident', randomUUID().slice(0, 12), null, village, admin],
    );
    process.env.DB_DATABASE = target;
    process.env.NODE_ENV = 'test';
    process.env.SWAGGER_ENABLED = 'false';
    process.env.CORS_ORIGINS = 'http://localhost:4200';
    process.env.TRUST_PROXY = '';
    const runtime = join(backup, 'integration-runtime');
    await mkdir(runtime);
    process.chdir(runtime); // All newly generated photos stay in the test archive.
    const { NestFactory } = await import('@nestjs/core');
    const { SchedulerRegistry } = await import('@nestjs/schedule');
    const { AppModule } = require('../src/app.module');
    const { configureApp } = require('../src/app.setup');
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bodyParser: false,
      logger: false,
      abortOnError: false,
    });
    configureApp(app);
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values())
      job.stop();
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const request = async (
      method: string,
      path: string,
      body?: unknown,
      token?: string,
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(35_000),
      });
      const data = await response.json();
      return { status: response.status, data };
    };
    assert.equal((await request('GET', '/bills')).status, 401);
    const login = await request('POST', '/auth/login', { email, password });
    assert.equal(login.status, 201, 'Admin login failed');
    const token = login.data.access_token as string;
    assert(token && !login.data.user.password);
    checks.push('Actual password login and JWT authorization');
    const registered = await request(
      'POST',
      '/auth/register',
      {
        fname: 'Test',
        lname: 'Staff',
        email: `staff-${randomUUID()}@example.invalid`,
        password,
        admin_role: 'owner',
      },
      token,
    );
    assert.equal(registered.status, 201);
    assert.equal(
      registered.data.user.admin_role,
      'staff',
      'Extra fields must not elevate role',
    );
    checks.push('Registration cannot elevate role through extra JSON fields');
    assert.equal(
      (await request('POST', '/auth/login', { email: {}, password: [] }))
        .status,
      400,
    );
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear());
    const jpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: 'white' },
    })
      .jpeg()
      .toBuffer();
    const payload = {
      members_id: member,
      water_rates_id: rate,
      current_unit: 10,
      billing_month: month,
      billing_year: year,
      client_uuid: randomUUID(),
      entry_method: 'manual',
      meter_photo: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    };
    const issued = await request('POST', '/bills/scan', payload, token);
    assert.equal(
      issued.status,
      201,
      `Bill creation failed: ${JSON.stringify(issued.data)}`,
    );
    const bill = issued.data;
    assert.equal(Number(bill.usage_unit), 10);
    assert.equal(Number(bill.total_amount), 100);
    const retry = await request('POST', '/bills/scan', payload, token);
    assert.equal(retry.data.id, bill.id, 'Retry must return the original bill');
    checks.push(
      'Create reading + bill, exact amount and retry after lost response without duplication',
    );
    const [countBefore] = await database.query<RowDataPacket[]>(
      'SELECT COUNT(*) n FROM meter_readings WHERE members_id = ?',
      [member],
    );
    const duplicate = await request(
      'POST',
      '/bills/scan',
      { ...payload, client_uuid: randomUUID() },
      token,
    );
    assert.equal(duplicate.status, 409);
    const [countAfter] = await database.query<RowDataPacket[]>(
      'SELECT COUNT(*) n FROM meter_readings WHERE members_id = ?',
      [member],
    );
    assert.equal(countBefore[0].n, countAfter[0].n);
    checks.push('Rejected duplicate leaves no orphan meter reading');
    const otherBill = await request(
      'POST',
      '/bills/scan',
      { ...payload, members_id: other, client_uuid: randomUUID() },
      token,
    );
    assert.equal(otherBill.status, 201);
    const resident = await request('POST', '/auth/member/login', { phone });
    assert.equal(resident.status, 201);
    const memberToken = resident.data.access_token;
    const ownBills = await request('GET', '/me/bills', undefined, memberToken);
    assert.equal(ownBills.status, 200);
    assert.deepEqual(
      ownBills.data.map((item: { id: number }) => item.id),
      [bill.id],
    );
    assert.equal(
      (
        await request(
          'GET',
          `/bills/${otherBill.data.id}`,
          undefined,
          memberToken,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request('POST', `/bills/${bill.id}/pay`, {}, memberToken)).status,
      403,
    );
    checks.push(
      'Resident sees only linked household and cannot read other bills or accept payment',
    );
    assert.equal(
      (await request('POST', `/bills/${bill.id}/pay`, {}, token)).status,
      201,
    );
    const [paid] = await database.query<RowDataPacket[]>(
      'SELECT payment_status FROM bills WHERE id = ?',
      [bill.id],
    );
    assert.equal(paid[0].payment_status, 'Paid');
    const staffEdit = await request(
      'PATCH',
      `/bills/${bill.id}/reading`,
      { current_unit: 11, reason: 'Integration permission test' },
      registered.data.access_token,
    );
    assert.equal(staffEdit.status, 409, 'Paid bill editing must be rejected');
    await database.execute(
      "UPDATE bills SET payment_status = 'Overdue' WHERE id = ?",
      [otherBill.data.id],
    );
    await database.execute(
      'UPDATE meter_readings SET reading_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = ?',
      [otherBill.data.meter_readings_id],
    );
    const overdueEdit = await request(
      'PATCH',
      `/bills/${otherBill.data.id}/reading`,
      { current_unit: 11, reason: 'Integration permission test' },
      registered.data.access_token,
    );
    assert.equal(
      overdueEdit.status,
      403,
      'Staff must not edit a historical overdue bill',
    );
    checks.push('Staff cannot edit historical overdue bills');
    assert.equal(
      (
        await request(
          'POST',
          '/bills/scan',
          { ...payload, client_uuid: randomUUID(), replace: true },
          token,
        )
      ).status,
      409,
    );
    checks.push('Payment is persisted and a paid bill cannot be overwritten');
    const health = await request('GET', '/health/ready');
    assert.equal(health.data.database, true);
    checks.push(
      `Real database readiness; vision ${health.data.vision ? 'available' : 'unavailable (degraded response verified)'}`,
    );
    const {
      MeterReadingsService,
    } = require('../src/service/meter-readings.service');
    const meterService = app.get(MeterReadingsService) as {
      visionServiceUrl: string;
    };
    const savedUrl = meterService.visionServiceUrl;
    const savedEnvUrl = process.env.VISION_SERVICE_URL;
    try {
      meterService.visionServiceUrl = 'http://127.0.0.1:1';
      process.env.VISION_SERVICE_URL = meterService.visionServiceUrl;
      const degraded = await request('GET', '/health/ready');
      assert.equal(degraded.status, 503);
      assert.equal(degraded.data.vision, false);
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }),
        'test.jpg',
      );
      const unavailable = await fetch(base + '/meter-readings/ocr-upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      assert.equal(unavailable.status, 503);
      checks.push(
        'AI outage returns controlled errors and degraded readiness without stopping billing API',
      );
    } finally {
      meterService.visionServiceUrl = savedUrl;
      if (savedEnvUrl === undefined) delete process.env.VISION_SERVICE_URL;
      else process.env.VISION_SERVICE_URL = savedEnvUrl;
    }
    completed = true;
    console.log(
      JSON.stringify({ passed: checks.length, checks, backup }, null, 2),
    );
  } finally {
    await app?.close();
    await database?.end();
    process.chdir(originalCwd);
    if (originalDatabase === undefined) delete process.env.DB_DATABASE;
    else process.env.DB_DATABASE = originalDatabase;
    if (created) {
      assertRestoreTarget(target);
      // Only this run's exact, random, newly created test database is removed.
      await source.query(`DROP DATABASE \`${target}\``);
    }
    const after = await fingerprint();
    await source.end();
    assert.deepEqual(
      after,
      before,
      'Source database changed during the test window',
    );
    await writeFile(
      join(project, 'docs', 'database-test-result.json'),
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          passed: completed,
          checks,
          sourceTables: Object.keys(before.counts).length,
          sourceUnchanged: true,
          testDatabaseRemoved: created,
          backup,
        },
        null,
        2,
      ),
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
