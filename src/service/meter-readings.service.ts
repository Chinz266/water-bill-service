import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeterReadingEntity } from '../entity/meter-reading.entity'; // เช็ค Path ให้ตรงกับโครงสร้างโฟลเดอร์ของคุณนะครับ
import { CreateMeterReadingDto } from '../dto/create-meter-reading.dto';
import vision from '@google-cloud/vision';
import sharp from 'sharp';

@Injectable()
export class MeterReadingsService {
  private readonly logger = new Logger(MeterReadingsService.name);

  // สร้าง Client เชื่อมต่อกับ Google Cloud Vision
  private visionClient = new vision.ImageAnnotatorClient({
    keyFilename: 'google-credentials.json',
  });

  constructor(
    @InjectRepository(MeterReadingEntity)
    private readonly meterReadingRepository: Repository<MeterReadingEntity>,
  ) {}

  // ==========================================
  // --- ส่วนฟังก์ชัน CRUD ปกติ ---
  // ==========================================
  async create(createMeterReadingDto: CreateMeterReadingDto) {
    const newReading = this.meterReadingRepository.create(createMeterReadingDto);
    return await this.meterReadingRepository.save(newReading);
  }

  async findAll() {
    return await this.meterReadingRepository.find({
      order: { reading_date: 'DESC' },
    });
  }

  async findByMember(memberId: number) {
    return await this.meterReadingRepository.find({
      where: { members_id: memberId },
      order: { reading_date: 'DESC' },
    });
  }

  // ==========================================
  // --- ส่วนฟังก์ชัน OCR (เวอร์ชันแม่นยำสูง: จัดการตัวเลขสีแดง, เลขห่าง, และคัดกรองตัวเลขขยะ) ---
  // ==========================================
  async extractMeterUnit(imageBuffer: Buffer) {
    try {
      const startTime = Date.now();
      this.logger.log('Starting water meter OCR analysis...');

      // === Pass 1: Grayscale ปกติ (เร็วที่สุด ใช้บ่อยที่สุด) ===
      const pass1Start = Date.now();
      const candidatesPass1 = await this.processOcrPass(imageBuffer, 'noThreshold');
      this.logger.log(`Pass 1 (Grayscale) completed in ${Date.now() - pass1Start}ms, found ${candidatesPass1.length} candidates`);

      // Early exit: ถ้า Pass 1 ได้ผลที่มั่นใจสูง ไม่ต้องรัน Pass 2, 3 ให้เสียเวลา
      const HIGH_CONFIDENCE_THRESHOLD = 300;
      const bestPass1 = candidatesPass1.length > 0
        ? candidatesPass1.reduce((best, c) => c.score > best.score ? c : best, candidatesPass1[0])
        : null;

      if (bestPass1 && bestPass1.score >= HIGH_CONFIDENCE_THRESHOLD) {
        const paddedDigits = bestPass1.cleanDigits.padStart(7, '0');
        this.logger.log(`⚡ Fast path! High-confidence result from Pass 1: "${paddedDigits}" (Score: ${bestPass1.score.toFixed(1)}) in ${Date.now() - startTime}ms total`);
        return {
          success: true,
          read_unit: paddedDigits,
          message: 'สกัดค่าตัวเลขสำเร็จ',
        };
      }

      // === Pass 2 & 3: รันคู่ขนานเฉพาะเมื่อ Pass 1 ไม่มั่นใจพอ ===
      this.logger.log(`Pass 1 best score: ${bestPass1?.score.toFixed(1) ?? 'N/A'} (< ${HIGH_CONFIDENCE_THRESHOLD}), running additional passes...`);

      const pass2Start = Date.now();
      const redChannelBuffer = await sharp(imageBuffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .removeAlpha()
        .extractChannel('red')
        .negate()
        .normalize()
        .sharpen({ sigma: 1.5 })
        .toBuffer();

      const [candidatesPass2, candidatesPass3] = await Promise.all([
        this.processOcrPass(imageBuffer, 'withThreshold'),
        this.processOcrPass(redChannelBuffer, 'preProcessed'),
      ]);
      this.logger.log(`Pass 2 & 3 completed in ${Date.now() - pass2Start}ms`);

      // รวมผลลัพธ์ตัวเลือกตัวเลขทั้งหมดจากทั้งสาม Pass เข้าด้วยกัน
      const allCandidates = [...candidatesPass1, ...candidatesPass2, ...candidatesPass3];

      if (allCandidates.length > 0) {
        allCandidates.sort((a, b) => b.score - a.score);
        
        this.logger.log(`Evaluating ${allCandidates.length} OCR candidates across all passes...`);
        allCandidates.slice(0, 5).forEach((c, idx) => {
          this.logger.debug(`[Candidate #${idx + 1}] Text: "${c.text}" -> Clean digits: "${c.cleanDigits}" | Score: ${c.score.toFixed(1)}`);
        });

        const cleanDigits = allCandidates[0].cleanDigits;
        const paddedDigits = cleanDigits.padStart(7, '0');
        this.logger.log(`OCR Successful! Selected reading: "${paddedDigits}" (Score: ${allCandidates[0].score.toFixed(1)}) | Total time: ${Date.now() - startTime}ms`);

        return {
          success: true,
          read_unit: paddedDigits,
          message: 'สกัดค่าตัวเลขสำเร็จ',
        };
      }

      this.logger.warn(`OCR finished with no valid candidates. Total time: ${Date.now() - startTime}ms`);
      return {
        success: false,
        read_unit: null,
        message: 'วิเคราะห์ภาพแล้ว แต่ได้ตัวเลขไม่ครบถ้วน กรุณาถ่ายให้ชัดเจนขึ้น',
      };
    } catch (error) {
      this.logger.error('An error occurred during water meter OCR analysis:', error.stack || error.message || error);
      throw new BadRequestException('ระบบวิเคราะห์รูปภาพมีปัญหา กรุณาลองใหม่อีกครั้ง');
    }
  }

  // ฟังก์ชันย่อยสำหรับรัน OCR ในแต่ละรอบ (Pass)
  // passMode: 'noThreshold' = grayscale ปกติ, 'withThreshold' = grayscale+threshold, 'preProcessed' = ส่ง buffer มาพร้อมใช้เลย
  private async processOcrPass(imageBuffer: Buffer, passMode: 'noThreshold' | 'withThreshold' | 'preProcessed') {
    let processedImageBuffer: Buffer;

    if (passMode === 'preProcessed') {
      // ใช้ buffer ที่เตรียมมาแล้ว (เช่น red channel inverted)
      processedImageBuffer = imageBuffer;
    } else {
      // จัดเตรียมรูปภาพด้วย Sharp
      let sharpPipeline = sharp(imageBuffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .grayscale()
        .normalize();

      if (passMode === 'withThreshold') {
        // เพิ่มความคมชัดขาว-ดำสูงสุดในรอบสอง
        sharpPipeline = sharpPipeline.threshold(120);
      }

      processedImageBuffer = await sharpPipeline
        .sharpen({ sigma: 1.5 })
        .toBuffer();
    }

    // เรียกใช้งาน Google Cloud Vision API
    const [visionResult] = await this.visionClient.documentTextDetection({
      image: { content: processedImageBuffer },
      imageContext: {
        languageHints: ['en'],
      },
    });

    const detections = visionResult.textAnnotations || [];
    if (detections.length === 0) {
      return [];
    }

    const passLabel = passMode === 'withThreshold' ? 'With Threshold' : passMode === 'noThreshold' ? 'No Threshold' : 'Red Channel';
    const rawText = detections[0].description || '';
    this.logger.debug(`[Pass ${passLabel}] Raw text detected: "${rawText.replace(/\n/g, ' | ')}"`);

    // เริ่มต้นค้นหาและวิเคราะห์ความน่าจะเป็นของตัวเลขมิเตอร์ (Candidate Scoring)
    const rawBlocks: { text: string; cleanDigits: string; minX: number; maxX: number; minY: number; maxY: number; cx: number; cy: number; det: any }[] = [];

    // ดึงพิกัดจุดกึ่งกลางและกรอบข้อความ
    const getCoords = (det: any) => {
      const vertices = det.boundingPoly?.vertices || [];
      if (vertices.length === 0) return null;
      const xs = vertices.map((v: any) => v.x ?? 0);
      const ys = vertices.map((v: any) => v.y ?? 0);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return {
        minX,
        maxX,
        minY,
        maxY,
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
      };
    };

    // คำนวณระยะห่างระหว่างสองจุด
    const getDistance = (c1: any, c2: any) => {
      if (!c1 || !c2) return 9999;
      return Math.sqrt(Math.pow(c1.x - c2.x, 2) + Math.pow(c1.y - c2.y, 2));
    };

    // [ปรับปรุง] หาค่าเฉลี่ยแกน X ของข้อความทั้งหมดเพื่อใช้ชี้ตำแหน่งกึ่งกลางแบบไดนามิก
    let sumX = 0;
    let countX = 0;
    for (let j = 1; j < detections.length; j++) {
      const coords = getCoords(detections[j]);
      if (coords) {
        sumX += coords.cx;
        countX++;
      }
    }
    const textCenterX = countX > 0 ? (sumX / countX) : 600;

    // รวบรวมข้อมูลบล็อกที่มีตัวเลขปนอยู่ก่อน (ข้ามตัวแรกที่เป็นข้อความรวม)
    for (let i = 1; i < detections.length; i++) {
      const det = detections[i];
      const originalText = det.description || '';
      const cleanDigits = originalText.replace(/\D/g, '');

      if (cleanDigits.length > 0) {
        const coords = getCoords(det);
        if (coords) {
          rawBlocks.push({
            text: originalText,
            cleanDigits,
            minX: coords.minX,
            maxX: coords.maxX,
            minY: coords.minY,
            maxY: coords.maxY,
            cx: coords.cx,
            cy: coords.cy,
            det
          });
        }
      }
    }

    this.logger.debug(`[Pass ${passLabel}] Extracted ${rawBlocks.length} raw numeric blocks.`);


    // [เพิ่มใหม่] ลอจิกการผสานคำตัวเลขที่อยู่ใกล้กันแนวนอน (เช่น "002" และ "5" ให้รวมเป็น "0025")
    const mergedBlocks: typeof rawBlocks = [];
    if (rawBlocks.length > 0) {
      // เรียงลำดับจากซ้ายไปขวา
      rawBlocks.sort((a, b) => a.minX - b.minX);
      let current = rawBlocks[0];

      for (let i = 1; i < rawBlocks.length; i++) {
        const next = rawBlocks[i];

        // คำนวณพื้นที่ทับซ้อนแนวตั้ง (Vertical Overlap)
        const overlapMinY = Math.max(current.minY, next.minY);
        const overlapMaxY = Math.min(current.maxY, next.maxY);
        const overlapHeight = overlapMaxY - overlapMinY;
        const currentHeight = current.maxY - current.minY;
        const nextHeight = next.maxY - next.minY;

        const hasVerticalOverlap = overlapHeight > 0 && 
          ((overlapHeight / Math.min(currentHeight, nextHeight)) > 0.2 || overlapHeight >= 5);

        // ตรวจสอบระยะห่างแนวนอน (Horizontal Gap)
        const horizontalGap = next.minX - current.maxX;
        const isCloseHorizontally = horizontalGap >= -10 && horizontalGap < 100; // ชิดกันหรือห่างไม่เกิน 100px (เพิ่มจาก 60px เพื่อข้ามเส้นแบ่งช่องแดง/ดำ)

        if (hasVerticalOverlap && isCloseHorizontally) {
          // ทำการผสานตัวเลข
          current = {
            text: current.text + next.text,
            cleanDigits: current.cleanDigits + next.cleanDigits,
            minX: current.minX,
            maxX: next.maxX,
            minY: Math.min(current.minY, next.minY),
            maxY: Math.max(current.maxY, next.maxY),
            cx: (current.minX + next.maxX) / 2,
            cy: (Math.min(current.minY, next.minY) + Math.max(current.maxY, next.maxY)) / 2,
            det: current.det
          };
        } else {
          mergedBlocks.push(current);
          current = next;
        }
      }
      mergedBlocks.push(current);
    }

    this.logger.debug(`[Pass ${passLabel}] Horizontally merged adjacent text segments into ${mergedBlocks.length} blocks.`);

    // ประเมินและให้คะแนนบล็อกตัวเลขแต่ละตัวที่ผสานแล้ว
    const candidates: { text: string; cleanDigits: string; score: number }[] = [];
    for (const block of mergedBlocks) {
      const cleanDigits = block.cleanDigits;
      if (cleanDigits.length >= 3 && cleanDigits.length <= 7) {
        let score = 100;

        //  ตรวจสอบเลข 0 นำหน้า (เน้นความสำคัญของเลข 0 นำหน้าสำหรับเลขมิเตอร์)
        if (cleanDigits.startsWith('000')) {
          score += 200;
        } else if (cleanDigits.startsWith('00')) {
          score += 150;
        } else if (cleanDigits.startsWith('0')) {
          score += 80;
        }

        //   ตรวจสอบความยาวตัวเลข (เลขมิเตอร์ส่วนใหญ่มี 7 หลักรวมทศนิยม หรือ 5-6 หลักในตัวเลขจำนวนเต็มหลัก)
        if (cleanDigits.length === 7) {
          score += 180; // เพิ่มความสำคัญของเลข 7 หลักเป็นลำดับแรก
        } else if (cleanDigits.length === 5 || cleanDigits.length === 6) {
          score += 150;
        } else if (cleanDigits.length === 4) {
          score += 50;
        } else if (cleanDigits.length === 3) {
          score -= 150; // หักคะแนนเลขสั้นที่ไม่ใช่มิเตอร์จริง
        }

        // ตรวจสอบว่าอยู่ใกล้คำว่า m³, m3, kl, m หรือไม่
        let nearUnit = false;
        for (let j = 1; j < detections.length; j++) {
          const otherText = (detections[j].description || '').toLowerCase();
          if (otherText.includes('m³') || otherText === 'm3' || otherText === 'm' || otherText === 'kl' || otherText === 'm3h') {
            const otherCoords = getCoords(detections[j]);
            if (otherCoords) {
              const dist = getDistance({ x: block.cx, y: block.cy }, { x: otherCoords.cx, y: otherCoords.cy });
              if (dist < 150) {
                nearUnit = true;
                break;
              }
            }
          }
        }
        if (nearUnit) {
          score += 120;
        }

        //  หักคะแนนอย่างรุนแรงหากอยู่ใกล้คำระบุรุ่น หรือหน่วยมิลลิเมตร (เช่น No., mm, PN, TIS) เพื่อคัดแยกเลขโมเดล/ซีเรียลออกจากเลขมิเตอร์จริง
        let nearSerialIndicator = false;
        for (let j = 1; j < detections.length; j++) {
          const otherText = (detections[j].description || '').toLowerCase();
          if (otherText.includes('no') || otherText.includes('tis') || otherText.includes('mm') || otherText.includes('pn')) {
            const otherCoords = getCoords(detections[j]);
            if (otherCoords) {
              const dist = getDistance({ x: block.cx, y: block.cy }, { x: otherCoords.cx, y: otherCoords.cy });
              if (dist < 100) {
                nearSerialIndicator = true;
                break;
              }
            }
          }
        }
        if (nearSerialIndicator) {
          score -= 250; // เพิ่มโทษลบล้างจากเดิม -80 เพื่อให้เลขโมเดล (เช่น 131021) ไม่ได้คะแนนชนะเลขมิเตอร์
        }

        // [เพิ่มใหม่] หักคะแนนอย่างรุนแรงหากคำดั้งเดิมหรือคำที่ผสานแล้วมีคำระบุรุ่นปนอยู่ด้วยในตัวเอง เช่น "PN1020mm"
        const lowerText = block.text.toLowerCase();
        if (lowerText.includes('mm') || lowerText.includes('pn') || lowerText.includes('tis') || lowerText.includes('no') || lowerText.includes('dn')) {
          score -= 300;
        }

        // หักคะแนนอย่างรุนแรงหากคำดั้งเดิมเป็นทศนิยม หรือตัวคูณ เช่น x0.001, +0.000, 2.5
        if (block.text.includes('.') || block.text.includes(',') || block.text.toLowerCase().includes('x') || block.text.includes('+')) {
          score -= 300;
        }

        // ให้คะแนนตามตำแหน่งในรูป (เทียบระยะห่างกับแกนกึ่งกลางข้อความแบบไดนามิก)
        const distFromCenterX = Math.abs(block.cx - textCenterX);
        score -= distFromCenterX * 0.15;

        candidates.push({ text: block.text, cleanDigits, score });
      }
    }

    // [เพิ่ม] ตรวจสอบแบบแยกบรรทัดกรณีที่ตัวเลขอ่านแยกกันแล้วมีเว้นวรรค (เช่น "002 | 5" ให้รวมเป็น "0025")
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      const cleanDigits = line.replace(/\D/g, '');
      if (cleanDigits.length >= 3 && cleanDigits.length <= 7) {
        // [เพิ่มใหม่] คัดออกจากการเลือกหากบรรทัดนั้นเป็นทศนิยม หรือตัวคูณ เช่น x0.001, +0.000, 2.5
        if (line.includes('.') || line.includes(',') || line.toLowerCase().includes('x') || line.includes('+')) {
          continue;
        }

        const exists = candidates.some(c => c.cleanDigits === cleanDigits);
        if (!exists) {
          let score = 80; // คะแนนตั้งต้นต่ำกว่าคำเดี่ยวเล็กน้อย
          if (cleanDigits.startsWith('00')) score += 80;
          if (cleanDigits.length === 7) {
            score += 90; // เพิ่มคะแนนสำหรับเลข 7 หลัก
          } else if (cleanDigits.length === 5 || cleanDigits.length === 6) {
            score += 60;
          }
          candidates.push({ text: line, cleanDigits, score });
        }
      }
    }

    return candidates;
  }
}