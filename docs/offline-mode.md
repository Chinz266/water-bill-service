# โหมดออฟไลน์ (หน้างานไม่มีสัญญาณ)

← [กลับหน้าหลัก](../README.md)

> ## สถานะ: ยังไม่ได้ทำ (พักไว้ตามที่ตกลง)
>
> | ส่วน | สถานะ |
> | --- | --- |
> | `client_uuid` ฝั่งหลังบ้าน (UNIQUE key + คืนบิลใบเดิมเมื่อยิงซ้ำ) | ✅ ทำแล้ว |
> | `client_uuid` ฝั่งหน้าเว็บ (สร้างตอนกดบันทึก + รอดข้ามการกู้คิว) | ✅ ทำแล้ว |
> | คิวเก็บรูปใน IndexedDB + auto-sync | ❌ ยังไม่ทำ |
>
> คิวของหน้าสแกนตอนนี้ยังเก็บใน `localStorage` และ **เก็บแต่ข้อมูลแถว ไม่เก็บตัวรูป**
> (ดู `batch-queue.store.ts`) กู้คิวได้เมื่อไฟดับ/ปิดแท็บ แต่ยังทำงานตอนไม่มีสัญญาณจริงไม่ได้
>
> ส่วนที่เหลือของหน้านี้คือแบบที่จะใช้ถ้ากลับมาทำต่อ — ส่วนที่ยากที่สุด (กันบิลซ้ำ)
> เสร็จไปแล้ว เหลือแค่ชั้นเก็บของ

หน้างานจริงในหมู่บ้านมีจุดอับสัญญาณเสมอ พนักงานที่เดินจดครบทั้งหมู่บ้านแล้วส่งไม่ได้
คือการเดินซ้ำทั้งรอบ — แอปจึงต้องบันทึกลงเครื่องก่อน แล้วซิงก์เองเมื่อกลับเข้าที่มีเน็ต

ฝั่ง backend รองรับครบแล้ว หน้านี้อธิบายว่าต้องทำอะไรฝั่ง Angular

---

## สิ่งที่ backend เตรียมไว้ให้: `client_uuid`

**ปัญหาที่ต้องกันให้ได้คือการยิงซ้ำ** — "ยิงแล้วเน็ตหลุดก่อนได้รับคำตอบ" แยกไม่ออกจาก
"ยิงไม่สำเร็จ" แอปจึงต้องยิงซ้ำเสมอ ถ้าไม่มีอะไรกัน บ้านหลังนั้นจะได้บิลสองใบในเดือนเดียว

`POST /bills/scan` จึงรับ `client_uuid`:

- ยิงซ้ำด้วย uuid เดิม → **คืนบิลใบเดิมกลับไป 200** ไม่ใช่ error
- ตัวที่กันจริงคือ `UNIQUE KEY` ของ `meter_readings.client_uuid` ระดับฐานข้อมูล
  ไม่ใช่การ `SELECT` ก่อน `INSERT` ที่ชั้น service — เพราะสองคำขอที่มาถึงพร้อมกัน
  จะ `SELECT` ไม่เจอทั้งคู่แล้ว `INSERT` ทั้งคู่

> ⚠️ **สร้าง uuid ตอนกด "บันทึก" ที่หน้างานเท่านั้น** ถ้าไปสร้างตอนกำลังจะยิง
> ทุกครั้งที่ retry จะได้ uuid ใหม่ = กันอะไรไม่ได้เลย ซึ่งเป็นจุดที่พลาดกันบ่อยที่สุด

การจดที่ซิงก์เข้ามาจะติดธง `offline_sync` ไว้ ดูย้อนหลังได้ที่ `GET /audit/flags`

---

## ทำไมต้อง IndexedDB ไม่ใช่ localStorage

`localStorage` เก็บได้ราว 5 MB และเก็บได้เฉพาะ string — รูปมิเตอร์ที่ย่อแล้วใบละ
200-500 KB (base64 บวมอีก 33%) เต็มตั้งแต่ใบที่ 10 ซึ่งน้อยกว่าหนึ่งรอบการเดินจดมาก

IndexedDB เก็บ `Blob` ได้ตรง ๆ ไม่ต้องแปลงเป็น base64 และโควตาเป็นหลักหลายร้อย MB

---

## โครงที่ต้องเพิ่มฝั่ง Angular

### 1. คิวใน IndexedDB — `offline-queue.service.ts`

```ts
import { Injectable, signal } from '@angular/core';

/** การจดหนึ่งครั้งที่รอส่ง */
export interface PendingReading {
  /** สร้างด้วย crypto.randomUUID() ตอนกดบันทึก — ห้ามสร้างใหม่ตอน retry */
  client_uuid: string;
  members_id: number;
  water_rates_id: number;
  current_unit: number;
  billing_month: string;
  billing_year: string;
  reading_date: string;
  entry_method: 'ocr' | 'manual' | 'manual_after_ocr_fail';
  meter_digits?: number;
  read_confidence?: number;
  latitude?: number;
  longitude?: number;
  gps_accuracy_m?: number;
  /** เวลาที่กดชัตเตอร์จริง ไม่ใช่เวลาที่ซิงก์ */
  captured_at: string;
  photo: Blob;
  /** 'pending' รอส่ง | 'needs_review' โดน 409 ต้องให้คนยืนยัน | 'invalid' ต้องแก้ข้อมูล */
  state: 'pending' | 'needs_review' | 'invalid';
  error_code?: string;
  error_message?: string;
  retry_count: number;
}

const DB_NAME = 'water-bill-offline';
const STORE = 'pending-readings';

@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  /** ให้ navbar ผูกกับตัวนี้เพื่อโชว์ badge จำนวนใบค้าง */
  readonly pendingCount = signal(0);

  private db?: IDBDatabase;

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'client_uuid' });
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async enqueue(item: PendingReading): Promise<void> {
    await this.tx('readwrite', (store) => store.put(item));
    await this.refreshCount();
  }

  async all(): Promise<PendingReading[]> {
    return await this.tx<PendingReading[]>('readonly', (store) =>
      store.getAll(),
    );
  }

  async remove(clientUuid: string): Promise<void> {
    await this.tx('readwrite', (store) => store.delete(clientUuid));
    await this.refreshCount();
  }

  private async refreshCount(): Promise<void> {
    const rows = await this.all();
    this.pendingCount.set(rows.filter((r) => r.state !== 'invalid').length);
  }
}
```

### 2. ย่อรูปก่อนเข้าคิว

ย่อ **ตอนกดบันทึก** ไม่ใช่ตอนซิงก์ — เครื่องที่เก็บรูปเต็มขนาดไว้ 60 ใบจะกินโควตา
จนเบราว์เซอร์เริ่มลบข้อมูลทิ้งเอง ซึ่งเป็นการสูญเสียที่กู้ไม่ได้

```ts
/** ย่อให้ด้านยาวสุดไม่เกิน 800 px คุณภาพ 0.6 — ตรงกับที่ backend ย่อซ้ำอยู่แล้ว */
export async function compressPhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));

  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale),
  );
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
}
```

> canvas วาดพิกเซลใหม่ = **EXIF หายทั้งหมด** รวมทั้งพิกัดและเวลาถ่าย
> จึงต้องเก็บ `captured_at` กับพิกัดแยกไว้เองตั้งแต่ตอนกดชัตเตอร์ (ข้อถัดไป)

### 3. พิกัดตอนกดชัตเตอร์

```ts
/** รอจนสัญญาณนิ่งพอ — ค่าที่ห่วยกว่านี้เอาไปแยกบ้านไม่ได้อยู่ดี */
export function readPosition(maxAccuracyM = 30): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (position.coords.accuracy <= maxAccuracyM) {
          navigator.geolocation.clearWatch(watchId);
          resolve(position);
        }
      },
      (error) => {
        navigator.geolocation.clearWatch(watchId);
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}
```

- **หน้าลงทะเบียนบ้าน** (`POST /member/register-onsite`) ต้อง `maxAccuracyM = 20`
  backend ปฏิเสธค่าที่แย่กว่านั้น เพราะเป็นจุดอ้างอิงที่การจดทุกครั้งจะถูกเทียบเข้าหา
- **หน้าจดมิเตอร์** ใช้ 30 ได้ — ดู [scan-batch.md](scan-batch.md) เรื่องรัศมี

### 4. ตัวซิงก์

```ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { OfflineQueueService, PendingReading } from './offline-queue.service';

@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  private readonly http = inject(HttpClient);
  private readonly queue = inject(OfflineQueueService);
  private running = false;

  /** เรียกตอนแอปเปิด + ตอน online + ตอนกดปุ่ม "ซิงก์เดี๋ยวนี้" */
  start(): void {
    window.addEventListener('online', () => void this.flush());
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.running || !navigator.onLine) return;
    this.running = true;

    try {
      const rows = (await this.queue.all())
        .filter((r) => r.state === 'pending')
        // ⚠️ เรียงตามเวลาถ่าย และส่ง **ทีละใบ** ห้าม Promise.all
        //    เลขตั้งต้นของใบถัดไปมาจากใบก่อนหน้า ยิงพร้อมกันจะได้ตัวตั้งผิด
        .sort((a, b) => a.captured_at.localeCompare(b.captured_at));

      for (const row of rows) {
        await this.send(row);
      }
    } finally {
      this.running = false;
    }
  }

  private async send(row: PendingReading): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post('/bills/scan', {
          ...row,
          meter_photo: await blobToDataUrl(row.photo),
          photo: undefined,
          state: undefined,
          retry_count: undefined,
        }),
      );
      await this.queue.remove(row.client_uuid);
    } catch (error) {
      await this.handleError(row, error as HttpErrorResponse);
    }
  }

  private async handleError(
    row: PendingReading,
    error: HttpErrorResponse,
  ): Promise<void> {
    // เน็ตหลุดกลางทาง — ยังไม่รู้ว่าฝั่ง server บันทึกไปหรือยัง
    // ปล่อยไว้ในคิวแล้วยิงซ้ำรอบหน้า client_uuid จะกันบิลซ้ำให้เอง
    if (error.status === 0) return;

    const code = error.error?.code as string | undefined;

    await this.queue.enqueue({
      ...row,
      // 409 = ด่านที่มีปุ่มยืนยัน ต้องให้คนตัดสิน ห้ามกดยืนยันแทนอัตโนมัติ
      // 400 = ข้อมูลผิดจริง ต้องแก้ก่อน
      state: error.status === 409 ? 'needs_review' : 'invalid',
      error_code: code,
      error_message: error.error?.message ?? 'ส่งข้อมูลไม่สำเร็จ',
      retry_count: row.retry_count + 1,
    });
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
```

> 🔴 **ห้ามกด `confirm_*` แทนผู้ใช้อัตโนมัติเวลาเจอ 409**
> ด่านพวกนั้นมีไว้ให้ **คน** ตัดสิน การให้แอปกดผ่านเองเท่ากับถอดด่านทิ้งทั้งชุด
> โดยที่หน้าเว็บยังดูเหมือนมีด่านอยู่ — อันตรายกว่าการไม่มีด่านตั้งแต่แรก
> ใบที่ติด `needs_review` ต้องขึ้นหน้าจอให้คนเปิดดูรูปแล้วกดเอง

### 5. สิ่งที่ต้องมีบน UI

| ต้องมี | เพราะ |
| --- | --- |
| Badge จำนวนใบค้างคิวบน navbar | ไม่เห็น = คนปิดแอปทั้งที่ยังไม่ได้ส่ง แล้วรู้ตัวอีกทีตอนสิ้นเดือน |
| หน้า "รอตรวจ" สำหรับใบที่ติด 409 | ต้องเปิดรูปเทียบแล้วกดยืนยันเอง |
| ปุ่ม "ซิงก์เดี๋ยวนี้" | เน็ตติด ๆ ดับ ๆ ทำให้ event `online` ไม่ยิง |
| แคชรายชื่อบ้าน + `previous_unit` ลง IndexedDB ตอนออนไลน์ | ไม่มีแคช = หน้างานไม่มีเน็ตก็เลือกบ้านไม่ได้เลย |

### 6. ช่องกรอกเลขมิเตอร์

- แยกช่องละหลัก จำนวนช่องเท่ากับ `meters.digits` ของบ้านหลังนั้น
- `inputmode="numeric"` และ **ไม่มีจุดทศนิยมให้พิมพ์ได้เลย** — วิธีกันอ่านเลขแดง
  (ทศนิยม) ที่ได้ผลกว่าคำเตือนบนจอ เพราะไม่ต้องพึ่งให้คนอ่าน
- ใต้ช่องโชว์เลขเดือนก่อนและหน่วยที่จะถูกคิดแบบเรียลไทม์ — คนที่เห็นว่า "ใช้ไป 800 หน่วย"
  ตั้งแต่ยังยืนอยู่หน้ามิเตอร์จะรู้ตัวเองว่าอ่านผิด ก่อนที่ระบบจะต้องเด้ง 409
- กรอกเองเมื่อไหร่ **บังคับให้ถ่ายรูป** — backend บล็อกตายอยู่แล้ว
  (ดู [billing-rules.md](billing-rules.md)) หน้าเว็บควรกันตั้งแต่ก่อนกดส่ง

---

## รูปที่ยังไม่รู้ว่าของบ้านไหน

หน้างานที่ OCR อ่านไม่ออกและคนก็ไม่แน่ใจว่าเป็นบ้านหลังไหน ให้ส่งเข้า
`POST /readings/unassigned` แทนการเดา แล้ว Admin ค่อยจับคู่ทีหลังจากที่ทำงาน

คิวนี้จะถูกตีทิ้งอัตโนมัติเมื่อค้างเกิน 90 วัน (ดู `HousekeepingService`)
