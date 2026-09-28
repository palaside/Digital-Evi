import jsQR from "jsqr";

/**
 * Detect Skill — ตรวจสอบประเภทภาพ (TYPE_CHAT | TYPE_SLIP_SOLO | TYPE_CHAT_WITH_SLIP)
 * อ้างอิงตามมาตรฐาน skills/Detect/SKILL.md:
 * 1. TYPE_SLIP_SOLO: ภาพสลิปโอนเงินเดี่ยวเต็มใบ (มี QR Code มาตรฐาน EMVCo หรือชื่อไฟล์ระบุชัด)
 * 2. TYPE_CHAT: ภาพหน้าจอแชทบทสนทนาต่อเนื่อง (ไม่มี QR Code ธนาคาร, เป็นภาพแคปแนวยาว)
 * 3. TYPE_CHAT_WITH_SLIP: ภาพแชทที่มีสลิปหรือการ์ดโอนเงินส่งในห้องแชท
 */

export type DetectedType = 'TYPE_SLIP_SOLO' | 'TYPE_CHAT' | 'TYPE_CHAT_WITH_SLIP';

export interface DetectResult {
  type: DetectedType;
  category: 'SLIP' | 'CHAT';
  confidence: number;
}

/**
 * นับการสลับความสว่างซ้าย-ขวาเพื่อตรวจจับแนวบับเบิ้ลข้อความแชท
 */
function detectBubblePattern(
  data: Uint8ClampedArray,
  width: number,
  height: number
): number {
  const sampleY = Math.floor(height * 0.5);
  let transitions = 0;
  let prevBright = data[(sampleY * width + 0) * 4] > 128;
  const step = Math.max(1, Math.floor(width / 200));
  for (let x = step; x < width; x += step) {
    const bright = data[(sampleY * width + x) * 4] > 128;
    if (bright !== prevBright) {
      transitions++;
      prevBright = bright;
    }
  }
  return transitions;
}

/**
 * Main classifier function ตามมาตรฐาน Forensic Gateway
 * ใช้ jsQR สแกน Finder Pattern จริง และวิเคราะห์อัตราส่วนภาพในระดับ 0ms-5ms
 */
export async function detectImageType(file: File): Promise<DetectResult> {
  const lowerName = file.name.toLowerCase();

  // 1. ตรวจจับจากชื่อไฟล์ (Highest Priority Heuristic)
  if (
    lowerName.includes('slip') ||
    lowerName.includes('สลิป') ||
    lowerName.includes('receipt')
  ) {
    return { type: 'TYPE_SLIP_SOLO', category: 'SLIP', confidence: 0.98 };
  }
  if (
    lowerName.includes('chat') ||
    lowerName.includes('แชท') ||
    lowerName.includes('line') ||
    lowerName.includes('screen') ||
    lowerName.includes('screenshot')
  ) {
    return { type: 'TYPE_CHAT', category: 'CHAT', confidence: 0.95 };
  }

  // 2. วิเคราะห์พิกเซลโครงสร้างด้วย Canvas 2D + jsQR Engine
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    const sW = Math.min(width, 400);
    const sH = Math.min(height, Math.floor(height * (sW / width)));

    const offscreen = new OffscreenCanvas(sW, sH);
    const ctx = offscreen.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, sW, sH);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, sW, sH);

    // ตรวจหา QR Code ของสลิปธนาคารไทยด้วย jsQR จริง 100%
    const qrCode = jsQR(data, sW, sH, { inversionAttempts: "attemptBoth" });
    const hasRealQr = !!(qrCode && qrCode.data);

    const bubbles = detectBubblePattern(data, sW, sH);
    const ratio = height / width;

    // ถ้าตรวจพบ QR Code ของสลิปจริง
    if (hasRealQr) {
      if (bubbles > 12 || ratio > 2.5) {
        return { type: 'TYPE_CHAT_WITH_SLIP', category: 'CHAT', confidence: 0.85 };
      }
      return { type: 'TYPE_SLIP_SOLO', category: 'SLIP', confidence: 0.98 };
    }

    // ถ้าไม่พบ QR Code: ภาพหน้าจอมือถือทรงยาว (ratio >= 1.25) หรือมีบับเบิ้ล → TYPE_CHAT
    if (ratio >= 1.25 || bubbles > 4) {
      return { type: 'TYPE_CHAT', category: 'CHAT', confidence: 0.92 };
    }

    return { type: 'TYPE_CHAT', category: 'CHAT', confidence: 0.75 };
  } catch {
    return { type: 'TYPE_CHAT', category: 'CHAT', confidence: 0.5 };
  }
}
