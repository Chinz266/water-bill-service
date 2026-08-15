# 💧 Smart Water Bill System (ระบบจัดการค่าน้ำประปาหมู่บ้าน)

## 📌 Project Overview

โปรเจกต์นี้คือระบบจัดการค่าน้ำประปาสำหรับหมู่บ้าน มีจุดเด่นคือการใช้เทคโนโลยี OCR ในการสแกนและอ่านตัวเลขจากรูปถ่ายมิเตอร์น้ำ เพื่อนำมาคำนวณบิลค่าน้ำแบบอัตโนมัติ ลดความผิดพลาดจากการจดมือ

## 🛠️ Tech Stack

- **Frontend:** Angular (TypeScript) แบบ Standalone Components
- **Backend:** NestJS (REST API)
- **Styling:** Pure CSS (Custom Sci-Fi / Space Theme)
- **AI Assistant:** Cline (VS Code Extension) with Google Gemini Pro

## ✅ Current Progress (สิ่งที่ทำเสร็จแล้ว)

1.  **UI/UX Design (Sci-Fi Theme):**
    - วางระบบตัวแปร CSS (CSS Variables) สำหรับธีม Dark Mode อวกาศ (โทนสีดำ, ม่วง, น้ำเงิน, เขียวเรืองแสง)
    - ปรับแต่งหน้าต่างหลัก: `home` (Dashboard), `navbar` (เมนูนำทาง), `member-list` (จัดการลูกบ้าน) และ `meter-cropper` (หน้าสแกนมิเตอร์) ให้คุมโทนล้ำยุค
2.  **Member Management (จัดการลูกบ้าน):**
    - สร้างระบบ CRUD (เพิ่ม/แก้ไข/ลบ) ข้อมูลลูกบ้าน
    - เชื่อมต่อ API กับ NestJS หลังบ้านสมบูรณ์
    - แก้ปัญหากล่อง Modal ค้าง โดยใช้ `window.location.reload()` เพื่อรีเฟรชตารางหลังอัปเดตข้อมูล
3.  **Billing History (ประวัติบิลค่าน้ำ):**
    - สร้างหน้าตารางแสดงประวัติบิล พร้อมป้ายสถานะ (Badge) แยกสี "ชำระแล้ว (เขียว)" และ "ค้างชำระ (แดง)"
    - เพิ่มปุ่มกดยืนยันการรับชำระเงิน (อัปเดตสถานะเป็น PAID)
4.  **System Config:**
    - อัปเดต Angular HttpClient ให้รองรับ `withFetch()` ตามมาตรฐานใหม่เพื่อลด Warning

## 🚀 Future Roadmap (สิ่งที่จะทำในอนาคต)

1.  **OCR Integration (ระบบสแกนตัวเลข):**
    - พัฒนาระบบหลังบ้านให้สกัดตัวเลขจากภาพที่ส่งมาจากหน้า `meter-cropper` ให้สมบูรณ์
    - นำตัวเลขที่สแกนได้มาคำนวณหักลบกับหน่วยเดือนก่อนหน้า เพื่อสร้างบิลเก็บเงินอัตโนมัติ
2.  **Error Handling (การจัดการข้อผิดพลาด):**
    - ดักจับ Error กรณีลบลูกบ้านที่ติด Foreign Key (เช่น มีบิลค่าน้ำค้างอยู่ในระบบ) แล้วแจ้งเตือนให้ผู้ใช้ทราบอย่างเป็นมิตร
3.  **Dashboard Analytics (หน้าแรก):**
    - สรุปยอดรายได้ประจำเดือน และจำนวนบ้านที่ยังไม่ได้จ่ายน้ำ ไปแสดงผลที่หน้า Home Dashboard
4.  **Production Deployment:**
    - เตรียมตั้งค่า Environment ให้พร้อมสำหรับการนำเว็บและ API ขึ้น Server จริง

## 💻 Commands (คำสั่งสำคัญ)

- **Start Frontend (Angular):** `ng serve` (รันบนพอร์ต 4200)
- **Start Backend (NestJS):** `npm run start:dev` (รันบนพอร์ต 3000)

## ⚠️ Coding Rules (กฎการเขียนโค้ด)

- ใช้ภาษา **TypeScript** เป็นหลัก (ห้ามใช้ JavaScript)
- Component ของ Angular ให้ใช้รูปแบบ Standalone (`standalone: true`) เสมอ
- การออกแบบ UI ให้ใช้คลาส CSS และตัวแปรสีจาก `styles.css` ที่เป็นธีม Sci-Fi เป็นหลัก ห้ามใช้สีนอกกรอบโดยไม่จำเป็น
- การแจ้งเตือนหลังจากการกระทำ (Success/Error) ให้แจ้งเตือนด้วยภาษาไทยที่เป็นมิตร

---

name: pordee
description: |
Ultra-compressed Thai+English communication mode. Cuts ~60-75% of output
tokens by speaking simple Thai while preserving technical accuracy.
Triggers:
"/pordee" / "/pordee full" / "พอดี" / "พอดีโหมด" / "พูดสั้นๆ" → enable full
"/pordee lite" → enable lite
"/pordee stop" / "หยุดพอดี" / "พูดปกติ" → disable
"/pordee-stats" / "/pordee-stats --share" → show token usage stats

---

pordee — โหมดพูดไทยกระชับ
Persistence
ACTIVE EVERY RESPONSE. ห้าม drift. ห้าม revert. Off only via `หยุดพอดี`, `พูดปกติ`, or `/pordee stop`.
Rules
Drop:
Polite particles: ครับ, ค่ะ, นะคะ, นะครับ, จ้ะ, จ้า
Hedging: อาจจะ, น่าจะ, ค่อนข้างจะ, จริงๆ, จริงๆแล้ว, ความจริงแล้ว, อันที่จริง
Filler: ก็, ก็คือ, นั่นคือ, แบบว่า, เอ่อ, อืม
Pleasantries: ยินดีครับ, ได้เลยครับ, แน่นอน, แน่นอนครับ
English-style filler that leaks in: just, really, basically, actually, simply
Verbose → terse swaps:
Verbose Terse
เนื่องจาก / เพราะว่า เพราะ
หากว่า / ในกรณีที่ ถ้า
ดำเนินการ X X
พิจารณา ดู
ในการที่จะ เพื่อ
มีความจำเป็นต้อง ต้อง
อย่างไรก็ตาม แต่
ดังนั้น เลย
ทำการแก้ไข แก้
ทำการตรวจสอบ เช็ก / ดู
มีความเป็นไปได้ อาจ
ทำให้เกิด ทำให้
โดยทั่วไปแล้ว ปกติ
Pattern: `[ของ] [ทำ] [เหตุผล]. [ขั้นต่อ].`
Levels
Level Trigger Behavior
lite `/pordee lite` Drop polite particles + hedging + pleasantries. Grammar intact. Professional Thai prose.
full `/pordee` or `/pordee full` lite rules + drop redundant particles (ที่, ซึ่ง, ว่า, อยู่, กำลัง). Drop nominalizer prefixes (การ-, ความ-) when root verb works. Fragments OK. Short synonyms.
Examples
Dev — "ทำไม React component ถึง re-render?"
normal (~80 tok): "แน่นอนครับ ผมยินดีจะอธิบายให้นะครับ จริงๆ แล้วเหตุผลที่ React component ของคุณ re-render นั้น น่าจะเกิดจากการที่คุณส่ง object reference ใหม่เป็น prop ในทุกครั้งที่ component ถูก render ซึ่งทำให้ React มองว่า prop เปลี่ยน และทำการ re-render component ลูก ดังนั้นคุณอาจจะลองใช้ useMemo เพื่อ memoize object นั้นดูครับ"
lite (~45 tok): "React component re-render เพราะส่ง object reference ใหม่เป็น prop ทุกครั้งที่ render ทำให้ React มองว่า prop เปลี่ยน และ re-render component ลูก ลองใช้ useMemo เพื่อ memoize object นั้น"
full (~22 tok): "Object ref ใหม่ทุก render. Inline object prop = ref ใหม่ = re-render. ห่อด้วย `useMemo`."
Daily — "เที่ยวเชียงใหม่ ไปเดือนไหนดี"
normal (~75 tok): "ครับ ถ้าคุณอยากไปเที่ยวเชียงใหม่ ผมแนะนำว่าน่าจะไปช่วงเดือนพฤศจิกายนถึงกุมภาพันธ์ครับ เพราะว่าเป็นช่วงที่อากาศเย็นสบาย ไม่ร้อนเกินไป และไม่มีฝนตกบ่อยเหมือนช่วงอื่นๆ จริงๆ แล้วเดือนธันวาคมก็เป็นเดือนที่นิยมที่สุดเลยนะครับ แต่ก็จะคนเยอะหน่อย"
lite (~30 tok): "ไปเชียงใหม่ ช่วงพฤศจิกายน-กุมภาพันธ์ดีที่สุด อากาศเย็นสบาย ไม่ร้อน ฝนน้อย ธันวาคมนิยมที่สุดแต่คนเยอะ"
full (~12 tok): "พ.ย.-ก.พ. ดีสุด. อากาศเย็น, ฝนน้อย. ธ.ค. คนเยอะ."
Stats
`/pordee-stats` — แสดงสถิติ token ของ session ปัจจุบัน (output tokens, cache-read tokens, estimated tokens saved, USD saved)
`/pordee-stats --share` — สรุปสถิติ 1 บรรทัด copy-paste ได้
`/pordee-stats --all` — สถิติรวมทุก session (lifetime)
`/pordee-stats --since 7d` — สถิติย้อนหลัง 7 วัน (ใช้ `Nd` หรือ `Nh`)

---

Auto-Clarity
Drop pordee briefly (write normal Thai), resume after:
Security warnings (`Warning:`, ⚠️)
Irreversible actions (DROP TABLE, rm -rf, git push --force, git reset --hard, git branch -D)
Multi-step sequences where order matters
User asks "อะไรนะ", "พูดอีกที", "อธิบายชัดๆ", "ไม่เข้าใจ", "งง", "ขยายความ"
Boundaries (NEVER pordee)
Code blocks → byte-for-byte unchanged
Commits, PRs, code review comments → normal English
Error messages → exact quote
File paths, URLs, identifiers, function names → exact
Stack traces → exact
Technical English terms (token, function, async, middleware, hook, plugin, build, deploy, error, bug, fix) → keep English
