/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import { config } from 'dotenv';
import mysql, { Connection, RowDataPacket } from 'mysql2/promise';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  copyFile,
  rename,
} from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';

const root = resolve(__dirname, '..');
config({ path: join(root, '.env'), quiet: true });
export const sourceDatabase = process.env.DB_DATABASE ?? 'water-bill-db';
export const connectionOptions = {
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  connectTimeout: 5000,
};
const quote = (name: string) => '`' + name.replace(/`/g, '``') + '`';
type Manifest = {
  version: 1;
  source: string;
  createdAt: string;
  tables: Record<string, number>;
  files: Record<string, string>;
};

export async function tableCounts(
  connection: Connection,
  database: string,
): Promise<Record<string, number>> {
  const [tables] = await connection.query<RowDataPacket[]>(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ? ORDER BY TABLE_NAME',
    [database, 'BASE TABLE'],
  );
  const result: Record<string, number> = {};
  for (const table of tables) {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM ${quote(database)}.${quote(table.TABLE_NAME)}`,
    );
    result[table.TABLE_NAME] = Number(rows[0].n);
  }
  return result;
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function regularFiles(folder: string): Promise<string[]> {
  if (!existsSync(folder)) return [];
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = join(folder, entry.name);
    if (entry.isSymbolicLink())
      throw new Error('Backup refuses symbolic links');
    if (entry.isDirectory()) files.push(...(await regularFiles(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}

function cli(kind: 'mysql' | 'mysqldump'): string {
  const configured =
    process.env[kind === 'mysql' ? 'MYSQL_PATH' : 'MYSQLDUMP_PATH'];
  if (configured) return configured;
  const xampp = `C:/xampp/mysql/bin/${kind}.exe`;
  return process.platform === 'win32' && existsSync(xampp) ? xampp : kind;
}

function runCli(
  kind: 'mysql' | 'mysqldump',
  args: string[],
  input?: string,
): Promise<void> {
  return new Promise((complete, reject) => {
    const child = spawn(
      cli(kind),
      [
        '--no-defaults',
        '--protocol=tcp',
        `--host=${connectionOptions.host}`,
        `--port=${connectionOptions.port}`,
        `--user=${connectionOptions.user}`,
        '--default-character-set=utf8mb4',
        ...args,
      ],
      {
        windowsHide: true,
        shell: false,
        // The password is never included in command arguments, logs, or the archive.
        env: { ...process.env, MYSQL_PWD: connectionOptions.password },
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    );
    let error = '';
    child.stderr.on('data', (chunk) => {
      error = (error + String(chunk)).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? complete()
        : reject(new Error(`${kind} failed (${code}): ${error}`)),
    );
    child.stdin.on('error', () => undefined);
    if (input) {
      const stream = createReadStream(input);
      stream.on('error', reject);
      stream.pipe(child.stdin);
    } else child.stdin.end();
  });
}

export async function createBackup(): Promise<string> {
  const connection = await mysql.createConnection(connectionOptions);
  try {
    // This application's archive format supports InnoDB base tables. Fail rather
    // than silently omit advanced objects or claim a consistent MyISAM snapshot.
    const [unsupported] = await connection.query<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND (TABLE_TYPE <> 'BASE TABLE' OR ENGINE <> 'InnoDB')
       UNION ALL SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?
       UNION ALL SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?
       UNION ALL SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?`,
      [sourceDatabase, sourceDatabase, sourceDatabase, sourceDatabase],
    );
    if (unsupported.length)
      throw new Error('Advanced database objects require a DBA-managed backup');
    const tables = await tableCounts(connection, sourceDatabase);
    if (!Object.keys(tables).length)
      throw new Error('Source database is empty or inaccessible');
    const name =
      new Date().toISOString().replace(/[:.]/g, '-') +
      '-' +
      randomBytes(4).toString('hex');
    const folder = join(root, 'backups', name);
    await mkdir(folder, { recursive: true });
    const pending = join(folder, 'database.sql.partial');
    await runCli('mysqldump', [
      '--single-transaction',
      '--skip-lock-tables',
      '--skip-add-locks',
      '--hex-blob',
      '--skip-triggers',
      `--result-file=${pending}`,
      sourceDatabase,
    ]);
    await rename(pending, join(folder, 'database.sql'));
    const manifest: Manifest = {
      version: 1,
      source: sourceDatabase,
      createdAt: new Date().toISOString(),
      tables,
      files: {},
    };
    manifest.files['database.sql'] = await sha256(join(folder, 'database.sql'));
    for (const file of await regularFiles(join(root, 'uploads'))) {
      const name = relative(root, file).split(sep).join('/');
      const target = join(folder, name);
      await mkdir(resolve(target, '..'), { recursive: true });
      await copyFile(file, target);
      manifest.files[name] = await sha256(target);
    }
    // Refuse an obviously changing snapshot; stop writes for the backup window
    // to coordinate the SQL snapshot and filesystem copies fully.
    if (
      JSON.stringify(tables) !==
      JSON.stringify(await tableCounts(connection, sourceDatabase))
    ) {
      throw new Error(
        'Source changed during backup. Stop writes and run backup again',
      );
    }
    await writeFile(
      join(folder, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
    return folder;
  } finally {
    await connection.end();
  }
}

export function assertRestoreTarget(target: string): void {
  if (
    !/^water_bill_restore_[a-z0-9_]{1,40}$/.test(target) ||
    target === sourceDatabase
  ) {
    throw new Error(
      'Restore target must be a NEW water_bill_restore_... database, never the source',
    );
  }
}

export async function restoreBackup(
  folder: string,
  target: string,
): Promise<void> {
  assertRestoreTarget(target);
  folder = resolve(folder);
  const manifest: Manifest = JSON.parse(
    await readFile(join(folder, 'manifest.json'), 'utf8'),
  );
  if (manifest.version !== 1 || !manifest.files['database.sql'])
    throw new Error('Invalid backup manifest');
  for (const [name, hash] of Object.entries(manifest.files)) {
    const file = resolve(folder, name);
    const rel = relative(folder, file);
    if (
      isAbsolute(rel) ||
      rel.startsWith('..') ||
      (!['database.sql'].includes(name) && !name.startsWith('uploads/'))
    )
      throw new Error('Unsafe backup path');
    if ((await sha256(file)) !== hash)
      throw new Error('Backup integrity check failed');
  }
  const connection = await mysql.createConnection(connectionOptions);
  let created = false;
  try {
    // Deliberately no IF NOT EXISTS: restoration may never overwrite a database.
    await connection.query(
      `CREATE DATABASE ${quote(target)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    created = true;
    await runCli('mysql', [target], join(folder, 'database.sql'));
    const actual = await tableCounts(connection, target);
    if (JSON.stringify(actual) !== JSON.stringify(manifest.tables))
      throw new Error('Restored table counts do not match the backup');
    const restored = join(folder, target);
    await mkdir(restored); // Never overwrite an existing restored image directory.
    for (const name of Object.keys(manifest.files).filter((name) =>
      name.startsWith('uploads/'),
    )) {
      const destination = join(restored, name);
      await mkdir(resolve(destination, '..'), { recursive: true });
      await copyFile(join(folder, name), destination);
      if ((await sha256(destination)) !== manifest.files[name])
        throw new Error('Restored image verification failed');
    }
  } catch (error) {
    if (created) {
      assertRestoreTarget(target);
      await connection.query(`DROP DATABASE ${quote(target)}`);
    }
    throw error;
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  const [command, folder, target] = process.argv.slice(2);
  const task =
    command === 'restore' && folder && target
      ? restoreBackup(folder, target).then(() =>
          console.log(
            `Restore verified; original database unchanged. Images: ${resolve(folder, target, 'uploads')}`,
          ),
        )
      : command === 'create'
        ? createBackup().then((folder) =>
            console.log(`Backup complete: ${folder}`),
          )
        : Promise.reject(
            new Error(
              'Usage: backup.ts create | restore <backup-folder> <new-water_bill_restore_name>',
            ),
          );
  task.catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
