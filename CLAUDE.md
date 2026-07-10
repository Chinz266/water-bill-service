# 💧 Smart Water Bill System (ระบบจัดการค่าน้ำประปาหมู่บ้าน)

## 📌 Project Overview
โปรเจกต์นี้คือระบบจัดการค่าน้ำประปาสำหรับหมู่บ้าน มีจุดเด่นคือการใช้เทคโนโลยี OCR ในการสแกนและอ่านตัวเลขจากรูปถ่ายมิเตอร์น้ำ เพื่อนำมาคำนวณบิลค่าน้ำแบบอัตโนมัติ ลดความผิดพลาดจากการจดมือ

## 🛠️ Tech Stack
*   **Frontend:** Angular (TypeScript) แบบ Standalone Components
*   **Backend:** NestJS (REST API)
*   **Styling:** Pure CSS (Custom Sci-Fi / Space Theme)
*   **AI Assistant:** Cline (VS Code Extension) with Google Gemini Pro

## ✅ Current Progress (สิ่งที่ทำเสร็จแล้ว)
1.  **UI/UX Design (Sci-Fi Theme):**
    *   วางระบบตัวแปร CSS (CSS Variables) สำหรับธีม Dark Mode อวกาศ (โทนสีดำ, ม่วง, น้ำเงิน, เขียวเรืองแสง)
    *   ปรับแต่งหน้าต่างหลัก: `home` (Dashboard), `navbar` (เมนูนำทาง), `member-list` (จัดการลูกบ้าน) และ `meter-cropper` (หน้าสแกนมิเตอร์) ให้คุมโทนล้ำยุค
2.  **Member Management (จัดการลูกบ้าน):**
    *   สร้างระบบ CRUD (เพิ่ม/แก้ไข/ลบ) ข้อมูลลูกบ้าน
    *   เชื่อมต่อ API กับ NestJS หลังบ้านสมบูรณ์ 
    *   แก้ปัญหากล่อง Modal ค้าง โดยใช้ `window.location.reload()` เพื่อรีเฟรชตารางหลังอัปเดตข้อมูล
3.  **Billing History (ประวัติบิลค่าน้ำ):**
    *   สร้างหน้าตารางแสดงประวัติบิล พร้อมป้ายสถานะ (Badge) แยกสี "ชำระแล้ว (เขียว)" และ "ค้างชำระ (แดง)"
    *   เพิ่มปุ่มกดยืนยันการรับชำระเงิน (อัปเดตสถานะเป็น PAID)
4.  **System Config:**
    *   อัปเดต Angular HttpClient ให้รองรับ `withFetch()` ตามมาตรฐานใหม่เพื่อลด Warning

## 🚀 Future Roadmap (สิ่งที่จะทำในอนาคต)
1.  **OCR Integration (ระบบสแกนตัวเลข):**
    *   พัฒนาระบบหลังบ้านให้สกัดตัวเลขจากภาพที่ส่งมาจากหน้า `meter-cropper` ให้สมบูรณ์
    *   นำตัวเลขที่สแกนได้มาคำนวณหักลบกับหน่วยเดือนก่อนหน้า เพื่อสร้างบิลเก็บเงินอัตโนมัติ
2.  **Error Handling (การจัดการข้อผิดพลาด):**
    *   ดักจับ Error กรณีลบลูกบ้านที่ติด Foreign Key (เช่น มีบิลค่าน้ำค้างอยู่ในระบบ) แล้วแจ้งเตือนให้ผู้ใช้ทราบอย่างเป็นมิตร
3.  **Dashboard Analytics (หน้าแรก):**
    *   สรุปยอดรายได้ประจำเดือน และจำนวนบ้านที่ยังไม่ได้จ่ายน้ำ ไปแสดงผลที่หน้า Home Dashboard
4.  **Production Deployment:**
    *   เตรียมตั้งค่า Environment ให้พร้อมสำหรับการนำเว็บและ API ขึ้น Server จริง

## 💻 Commands (คำสั่งสำคัญ)
*   **Start Frontend (Angular):** `ng serve` (รันบนพอร์ต 4200)
*   **Start Backend (NestJS):** `npm run start:dev` (รันบนพอร์ต 3000)

## ⚠️ Coding Rules (กฎการเขียนโค้ด)
*   ใช้ภาษา **TypeScript** เป็นหลัก (ห้ามใช้ JavaScript)
*   Component ของ Angular ให้ใช้รูปแบบ Standalone (`standalone: true`) เสมอ
*   การออกแบบ UI ให้ใช้คลาส CSS และตัวแปรสีจาก `styles.css` ที่เป็นธีม Sci-Fi เป็นหลัก ห้ามใช้สีนอกกรอบโดยไม่จำเป็น
*   การแจ้งเตือนหลังจากการกระทำ (Success/Error) ให้แจ้งเตือนด้วยภาษาไทยที่เป็นมิตร