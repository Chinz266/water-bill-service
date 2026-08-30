import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

/**
 * จดมิเตอร์ + ออกบิล ในคำสั่งเดียว (หน้าสแกนมิเตอร์ใช้ตัวนี้)
 *
 * ⚠️ ตั้งใจไม่รับ previous_unit / usage_unit / total_amount จาก body
 *    ทั้งหมดหลังบ้านคำนวณเอง ไม่งั้นแก้ยอดเงินจากฝั่ง client ได้
 */
export class CreateBillFromScanDto {
  // ตรวจแค่ "ส่งมาหรือเปล่า" ไม่ตรวจชนิด — เหตุผลเดียวกับ CreateBillDto
  @IsDefined({ message: 'ต้องระบุ members_id (ID ของบ้าน)' })
  @ApiProperty({ description: 'ID ของบ้านที่จดมิเตอร์', example: 1 })
  members_id!: number;

  @IsDefined({ message: 'ต้องระบุ water_rates_id (ID ของเรทค่าน้ำ)' })
  @ApiProperty({ description: 'ID ของเรทค่าน้ำที่ใช้คำนวณ', example: 1 })
  water_rates_id!: number;

  @IsDefined({ message: 'ต้องระบุ current_unit (เลขมิเตอร์ครั้งนี้)' })
  @ApiProperty({ description: 'เลขมิเตอร์ที่จดได้ครั้งนี้', example: 1250 })
  current_unit!: number;

  @IsDefined({ message: 'ต้องระบุ billing_month (บิลประจำเดือน)' })
  @ApiProperty({ description: 'บิลประจำเดือน (01-12)', example: '06' })
  billing_month!: string;

  @IsDefined({ message: 'ต้องระบุ billing_year (บิลประจำปี)' })
  @ApiProperty({ description: 'บิลประจำปี (ค.ศ.)', example: '2026' })
  billing_year!: string;

  @ApiPropertyOptional({
    description: 'วันที่จดมิเตอร์ (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
  })
  reading_date?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้จด', example: 1 })
  create_by?: number;

  @ApiPropertyOptional({
    description:
      'จำนวนหลักบนหน้าปัดที่ OCR ตรวจเจอ (ค่า meter_digits จาก /meter-readings/ocr-upload) — ' +
      'ส่งมาด้วยแล้วระบบจะเทียบกับครั้งก่อนของบ้านหลังนี้ เพื่อจับเคสอ่านหลักหาย/หลักเกิน ' +
      'ไม่ส่งมา (เช่นกรอกเลขเอง) จะข้ามด่านนี้ไป',
    example: 5,
  })
  meter_digits?: number;

  @ApiPropertyOptional({
    description:
      'ความมั่นใจของหลักที่อ่อนที่สุดจาก OCR (ค่า confidence จาก /meter-readings/ocr-upload) — ' +
      'ต่ำกว่า 0.85 ระบบจะขอให้กดยืนยันก่อน เพราะเป็นด่านเดียวที่จับเคส "อ่านผิดค่าโดยจำนวนหลักไม่เปลี่ยน" ' +
      '(1250 → 1258) ซึ่งด่านจำนวนหลักและด่านหน่วยพุ่งจับไม่ได้ ไม่ส่งมา (กรอกเลขเอง) จะข้ามด่านนี้ไป',
    example: 0.93,
  })
  read_confidence?: number;

  // ── พิกัดของจุดที่ยืนถ่ายรูป ────────────────────────────────────────────
  // ควรมาจาก navigator.geolocation.getCurrentPosition() ตอนกดชัตเตอร์
  // ไม่ใช่จาก EXIF เพราะหน้าเว็บย่อรูปด้วย canvas ก่อนส่ง EXIF จึงหายไปแล้ว
  // ข้อดีอีกอย่างคือ Geolocation API แถม accuracy มาให้ ซึ่ง EXIF ไม่มี

  @ApiPropertyOptional({
    description: 'ละติจูดของจุดที่ยืนถ่ายรูปมิเตอร์',
    example: 14.9799,
  })
  latitude?: number;

  @ApiPropertyOptional({
    description: 'ลองจิจูดของจุดที่ยืนถ่ายรูปมิเตอร์',
    example: 102.097771,
  })
  longitude?: number;

  @ApiPropertyOptional({
    description:
      'ความคลาดเคลื่อนของพิกัดเป็นเมตร (coords.accuracy) — เกิน 50 ม. ระบบจะไม่เอาไปใช้ตัดสิน',
    example: 12,
  })
  gps_accuracy_m?: number;

  @ApiPropertyOptional({
    description:
      'ยืนยันว่าพิกัดที่ตรงกับการจดครั้งก่อนเป๊ะทุกทศนิยมนั้นถ่ายใหม่จริง — ' +
      'ปกติ GPS ไม่เคยให้ค่าเดิมซ้ำ ค่าที่ซ้ำจึงมักแปลว่าพิกัดถูกคัดลอกมาไม่ได้วัดใหม่ ' +
      '(ถ้า captured_at ซ้ำด้วยจะบล็อกตาย ปุ่มนี้ช่วยไม่ได้ เพราะนั่นคือไฟล์เดิมแน่นอน)',
    default: false,
  })
  confirm_duplicate_location?: boolean;

  @ApiPropertyOptional({
    description:
      'ยืนยันว่ารูปที่ถ่ายไว้นานกว่า 30 วันก่อนวันจดนั้นเป็นรูปที่ถูกต้องของรอบนี้',
    default: false,
  })
  confirm_stale_photo?: boolean;

  @ApiPropertyOptional({
    description:
      'ยืนยันว่าเลขที่ OCR อ่านได้ไม่ชัด (confidence ต่ำกว่า 0.85) นั้นตรงกับหน้าปัดจริง — ' +
      'ให้คนตรวจเทียบทีละหลักกับรูปก่อนกด',
    default: false,
  })
  confirm_low_confidence?: boolean;

  @ApiPropertyOptional({
    description: 'วันเวลาที่กดชัตเตอร์จริง (ISO 8601)',
    example: '2026-08-14T10:23:45',
  })
  captured_at?: string;

  @ApiPropertyOptional({
    description: 'ยืนยันจดทับบิลเดือนเดียวกันที่มีอยู่แล้ว (ลบใบเดิมทิ้งก่อน)',
    default: false,
  })
  replace?: boolean;

  @ApiPropertyOptional({
    description: 'ยืนยันว่าหน่วยน้ำที่สูงผิดปกตินั้นถูกต้องจริง',
    default: false,
  })
  confirm_high_usage?: boolean;

  @ApiPropertyOptional({
    description:
      'ยืนยันว่าจำนวนหลักบนหน้าปัดที่ต่างจากเดือนก่อนนั้นถูกต้องจริง — ' +
      'ใช้เมื่อเปลี่ยนมิเตอร์เป็นรุ่นที่หลักไม่เท่าเดิม หรือคนตรวจดูรูปแล้วยืนยันว่า OCR อ่านถูก',
    default: false,
  })
  confirm_digit_change?: boolean;

  @ApiPropertyOptional({
    description:
      'ยืนยันว่าเลขที่ต่ำกว่าเดือนก่อนเกิดจากการเปลี่ยนมิเตอร์ใหม่ หรือมิเตอร์นับครบรอบแล้ววนกลับเป็น 0 — ' +
      'ระบบจะเริ่มนับจาก 0 ให้ ไม่ใช่ปฏิเสธการออกบิล',
    default: false,
  })
  confirm_meter_reset?: boolean;

  @ApiPropertyOptional({
    description:
      'เลขปิดของมิเตอร์ตัวเก่า ณ วันที่ถอดออก (ใช้คู่กับ confirm_meter_reset) — ' +
      'กรอกมาด้วยจะได้คิดน้ำที่ใช้ก่อนเปลี่ยนมิเตอร์เข้าไปในบิลนี้ครบ ไม่กรอกจะคิดเฉพาะมิเตอร์ตัวใหม่',
    example: 1320,
  })
  old_meter_final_unit?: number;

  @ApiPropertyOptional({
    description:
      'รูปหน้าปัดมิเตอร์เป็น data URL (data:image/jpeg;base64,...) — ' +
      'เก็บเป็นไฟล์แล้วบันทึกเฉพาะ path ลง meter_readings.evidence_photo',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  meter_photo?: string;

  @ApiPropertyOptional({
    description:
      'เลขมิเตอร์นี้มาจากไหน — ocr / manual / manual_after_ocr_fail\n\n' +
      '⚠️ ค่าที่ขึ้นต้นด้วย manual **บังคับให้แนบ meter_photo มาด้วยเสมอ** ไม่มีปุ่มยืนยันให้ข้าม ' +
      'เพราะเลขที่กรอกเองแล้วไม่มีรูปคือข้อมูลที่ไม่เหลืออะไรให้ตรวจสอบย้อนหลังได้เลย\n\n' +
      'ไม่ส่งมา = ระบบเดาจากว่ามีค่า read_confidence ติดมาไหม (หน้าเว็บรุ่นเก่าจึงยังทำงานได้)',
    enum: ['ocr', 'manual', 'manual_after_ocr_fail'],
    example: 'manual_after_ocr_fail',
  })
  entry_method?: string;

  @ApiPropertyOptional({
    description:
      '**บ้าน**ของใบนี้ใครเป็นคนเลือก — system = ระบบจับคู่ให้ / manual = คนเลือกเอง / none = ยังไม่มีที่มา\n\n' +
      '⚠️ เก็บเป็น**หลักฐานย้อนหลังอย่างเดียว ไม่ได้ถูกใช้เป็นด่านใด ๆ** เพราะค่ามาจาก client ซึ่งปลอมได้ ' +
      'มีไว้ตอบคำถามที่ตอบไม่ได้มาตลอดว่า "บิลที่ระบบเลือกบ้านเอง ถูกลบทิ้งทีหลังกี่ใบ" ' +
      'ซึ่งเป็นตัวเลขที่ต้องรู้ก่อนจะผ่อนหรือรัดเกณฑ์การออกบิลอัตโนมัติ',
    enum: ['system', 'manual', 'none'],
    example: 'system',
  })
  matched_by?: string;

  @ApiPropertyOptional({
    description:
      'ความมั่นใจของการจับคู่บ้าน ณ ตอนออกบิล (ค่า confidence จาก /bills/scan-batch)\n\n' +
      'เก็บคู่กับ matched_by เพราะ system เฉย ๆ แยกไม่ออกระหว่างใบที่ไหลออกไปเองแบบไม่มีคนดู (high) ' +
      'กับใบที่คนกดยืนยันตามที่ระบบเสนอ (medium) — สองอย่างนี้เป็นคนละความเสี่ยงกัน ' +
      '⚠️ หลักฐานย้อนหลังเท่านั้น ไม่ได้ถูกใช้เป็นด่าน',
    enum: ['high', 'medium', 'ambiguous', 'none'],
    example: 'high',
  })
  match_confidence?: string;

  @ApiPropertyOptional({
    description:
      'รหัสที่แอปสร้างตอน "กดบันทึก" ตอนอยู่หน้างาน (crypto.randomUUID) — ' +
      'ใช้กันบิลซ้ำเวลา auto-sync ยิงซ้ำเพราะเน็ตหลุดก่อนได้รับคำตอบ\n\n' +
      'ยิงซ้ำด้วย uuid เดิมจะได้บิลใบเดิมกลับไป (200) ไม่ใช่ error — ' +
      '⚠️ ต้องสร้างตอนกดบันทึกครั้งแรกเท่านั้น ถ้าสร้างใหม่ตอนจะยิงจะกันอะไรไม่ได้เลย',
    example: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  })
  client_uuid?: string;
}
