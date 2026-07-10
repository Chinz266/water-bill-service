/**
 * เคลียร์ process ที่ค้างถือพอร์ต 3000 (NestJS) และ 8000 (vision service)
 * ถูกเรียกอัตโนมัติผ่าน `prestart:dev` ก่อน `npm run start:dev` ทุกครั้ง
 *
 * ทำไมต้องมี: `nest start --watch` แตก process ลูกเป็น `node dist/main`
 * และ start-vision.js ก็แตกลูกเป็น python.exe เวลาปิด terminal หรือถูก kill แบบ
 * force บน Windows ตัวลูกจะไม่ตายตาม กลายเป็น orphan ค้างพอร์ต -> EADDRINUSE
 */
const { execSync } = require('node:child_process');

const PORTS = [3000, 8000];

/** คืน PID ทั้งหมดที่ LISTEN อยู่บนพอร์ตนี้ */
function findListeners(port) {
    try {
        if (process.platform === 'win32') {
            const output = execSync(`netstat -ano -p TCP | findstr LISTENING | findstr :${port}`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            const pids = output
                .split('\n')
                .map((line) => line.trim().split(/\s+/))
                // เอาเฉพาะแถวที่ local address ลงท้ายด้วย :<port> จริง ๆ กัน :30000 หลุดมา
                .filter((parts) => parts.length >= 5 && parts[1].endsWith(`:${port}`))
                .map((parts) => Number(parts[4]))
                .filter((pid) => Number.isInteger(pid) && pid > 0);
            return [...new Set(pids)];
        }

        const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return [...new Set(output.split('\n').map(Number).filter(Boolean))];
    } catch {
        // ไม่เจออะไร -> netstat/findstr/lsof คืน exit code ไม่ใช่ 0
        return [];
    }
}

function kill(pid) {
    try {
        if (process.platform === 'win32') {
            // /T เก็บลูกหลานด้วย เผื่อ node แม่ยังถือ dist/main อยู่
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        } else {
            process.kill(pid, 'SIGKILL');
        }
        return true;
    } catch {
        return false;
    }
}

let cleaned = 0;
for (const port of PORTS) {
    for (const pid of findListeners(port)) {
        // อย่าฆ่าตัวเอง (กรณีสุดวิสัยที่ PID ชนกัน)
        if (pid === process.pid) continue;

        if (kill(pid)) {
            console.log(`🧹 ปิด process ค้างบนพอร์ต ${port} แล้ว (PID ${pid})`);
            cleaned++;
        } else {
            console.warn(`⚠️  ปิด PID ${pid} บนพอร์ต ${port} ไม่สำเร็จ — อาจต้องรัน terminal แบบ Administrator`);
        }
    }
}

if (cleaned === 0) {
    console.log('✓ พอร์ต 3000 และ 8000 ว่าง พร้อมสตาร์ท');
}
