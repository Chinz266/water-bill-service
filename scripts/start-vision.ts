/**
 * ตัวช่วยสตาร์ท meter-vision-service (FastAPI + YOLO)
 * ถูกเรียกจาก `npm start` / `npm run start:dev` ผ่าน concurrently
 *
 * ครั้งแรกที่รัน (ยังไม่มี venv) จะสร้าง venv + pip install ให้อัตโนมัติ
 * ถ้าติดตั้งไม่สำเร็จ (เช่นไม่มี Python ในเครื่อง) จะพิมพ์วิธีติดตั้งแล้วจบแบบ
 * ไม่ error เพื่อไม่ให้ NestJS ที่รันคู่กันถูก concurrently kill ทิ้ง
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const serviceDir = join(__dirname, '..', 'meter-vision-service');
const venvDir = join(serviceDir, 'venv');
const isWindows = process.platform === 'win32';

/** path ของ python ใน venv (Windows อยู่ที่ Scripts/ ส่วน macOS/Linux อยู่ที่ bin/) */
function venvPython(dir: string): string {
  return isWindows
    ? join(dir, 'Scripts', 'python.exe')
    : join(dir, 'bin', 'python');
}

/** หา venv ที่มีอยู่แล้ว รองรับทั้งชื่อ venv และ .venv */
function findExistingVenv(): string | undefined {
  return [venvDir, join(serviceDir, '.venv')].map(venvPython).find(existsSync);
}

/** หา Python ของเครื่องไว้ใช้สร้าง venv — บน Windows `py` มักใช้ได้ชัวร์กว่า */
function findSystemPython(): string | undefined {
  const commands = isWindows
    ? ['py', 'python', 'python3']
    : ['python3', 'python'];

  return commands.find((command) => {
    const result = spawnSync(command, ['--version'], {
      stdio: 'ignore',
      shell: isWindows,
    });
    return result.status === 0;
  });
}

function printManualSetup(): void {
  console.warn('');
  console.warn('   ติดตั้งเองด้วยคำสั่งนี้:');
  console.warn('     cd meter-vision-service');
  console.warn('     python -m venv venv');
  console.warn(
    isWindows
      ? '     .\\venv\\Scripts\\Activate.ps1'
      : '     source venv/bin/activate',
  );
  console.warn('     pip install -r requirements.txt');
  console.warn('');
}

/**
 * สร้าง venv + ลง dependency ให้อัตโนมัติ คืน path ของ python ถ้าสำเร็จ
 * ครั้งแรกใช้เวลานาน (ultralytics ลาก torch มาด้วย ~2GB) — รันครั้งเดียวพอ
 */
function bootstrapVenv(): string | undefined {
  const systemPython = findSystemPython();

  if (!systemPython) {
    console.warn('');
    console.warn(
      '⚠️  ไม่พบ Python ในเครื่อง — ข้ามการสตาร์ท vision service',
    );
    console.warn(
      '   (NestJS จะรันต่อได้ตามปกติ แต่หน้าสแกนมิเตอร์จะใช้งานไม่ได้)',
    );
    console.warn('   ติดตั้ง Python 3 ก่อนที่ https://www.python.org/downloads/');
    return undefined;
  }

  console.log('');
  console.log('📦 ยังไม่มี venv ของ vision service — กำลังติดตั้งให้อัตโนมัติ');
  console.log('   ครั้งแรกใช้เวลาสักพัก (ดาวน์โหลด torch/ultralytics ~2GB)');
  console.log('');

  const createVenv = spawnSync(systemPython, ['-m', 'venv', venvDir], {
    cwd: serviceDir,
    stdio: 'inherit',
    shell: isWindows,
  });

  if (createVenv.status !== 0) {
    console.warn('⚠️  สร้าง venv ไม่สำเร็จ — ข้ามการสตาร์ท vision service');
    printManualSetup();
    return undefined;
  }

  const python = venvPython(venvDir);

  const install = spawnSync(
    python,
    ['-m', 'pip', 'install', '-r', 'requirements.txt'],
    { cwd: serviceDir, stdio: 'inherit' },
  );

  if (install.status !== 0) {
    console.warn('');
    console.warn(
      '⚠️  ติดตั้ง dependency ไม่สำเร็จ — ข้ามการสตาร์ท vision service',
    );
    console.warn(
      '   (Python ที่ใช้อยู่อาจยังไม่มี wheel ของ torch — ลองใช้ Python 3.12)',
    );
    printManualSetup();
    return undefined;
  }

  console.log('');
  console.log('✓ ติดตั้ง vision service เรียบร้อย');
  return python;
}

const python = findExistingVenv() ?? bootstrapVenv();

// ติดตั้งไม่ได้ก็ปล่อยผ่าน อย่าให้ concurrently ลาก NestJS ตายตาม
if (!python) {
  process.exit(0);
}

const child = spawn(python, ['main.py'], { cwd: serviceDir, stdio: 'inherit' });

child.on('error', (error: Error) => {
  console.error('❌ สตาร์ท vision service ไม่สำเร็จ:', error.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});

// ให้ Ctrl+C ปิด Python ตามไปด้วย ไม่ทิ้ง process ค้างพอร์ต 8000
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
