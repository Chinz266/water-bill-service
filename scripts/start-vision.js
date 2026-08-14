/**
 * ตัวช่วยสตาร์ท meter-vision-service (FastAPI + YOLO)
 * ถูกเรียกจาก `npm run start:dev` ผ่าน concurrently
 *
 * ถ้ายังไม่ได้ setup venv จะพิมพ์วิธีติดตั้งแล้วจบแบบไม่ error
 * เพื่อไม่ให้ NestJS ที่รันคู่กันถูก concurrently kill ทิ้ง
 */
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const serviceDir = join(__dirname, '..', 'meter-vision-service');

// venv ของ Windows อยู่ที่ Scripts/ ส่วน macOS/Linux อยู่ที่ bin/
const candidates = [
    join(serviceDir, 'venv', 'Scripts', 'python.exe'),
    join(serviceDir, 'venv', 'bin', 'python'),
    join(serviceDir, '.venv', 'Scripts', 'python.exe'),
    join(serviceDir, '.venv', 'bin', 'python'),
];

const python = candidates.find(existsSync);

if (!python) {
    console.warn('');
    console.warn('⚠️  ยังไม่พบ Python venv ของ meter-vision-service — ข้ามการสตาร์ท vision service');
    console.warn('   (NestJS จะรันต่อได้ตามปกติ แต่หน้าสแกนมิเตอร์จะใช้งานไม่ได้)');
    console.warn('');
    console.warn('   ติดตั้งครั้งแรกด้วย:');
    console.warn('     cd meter-vision-service');
    console.warn('     python -m venv venv');
    console.warn('     .\\venv\\Scripts\\Activate.ps1');
    console.warn('     pip install -r requirements.txt');
    console.warn('');
    process.exit(0);
}

const child = spawn(python, ['main.py'], { cwd: serviceDir, stdio: 'inherit' });

child.on('error', (error) => {
    console.error('❌ สตาร์ท vision service ไม่สำเร็จ:', error.message);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
});

// ให้ Ctrl+C ปิด Python ตามไปด้วย ไม่ทิ้ง process ค้างพอร์ต 8000
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
}
