/**
 * ==========================================================================
 * FORENSIC DUAL-HEADER SYSTEM & CONDITIONAL LOGIC STATE MACHINE (SSOT)
 * Standardized across Web App Top Header Bar (108px) and A4/PDF Evidence Ribbon
 * Compliant with ISO/IEC 27037 & Criminal Procedure Code Section 226/1
 * ==========================================================================
 */

import type { ForensicEvidenceState } from "@/constants/forensic-ssot";

export type EvidencePageType = 
  | "COVER" 
  | "SUMMARY_TABLE" 
  | "EXECUTIVE_SUMMARY" 
  | "HASH_MANIFEST" 
  | "SLIP" 
  | "CHAT" 
  | "STANDBY";

export interface HeaderPageContext {
  type: EvidencePageType;
  pageIndex?: number;
  totalPages?: number;
  itemIndex?: number;
  targetName?: string | null;
  amount?: number | null;
  isDuplicate?: boolean;
  duplicateOfNo?: number | null;
  chatHasSlip?: boolean;
  slipPageRef?: number | null;
  timestamp?: string;
}

export interface HeaderStatusCapsuleState {
  color: string;
  glowColor: string;
  isPulsing: boolean;
  text: string;
}

/**
 * 1. ตรรกะของฟิลด์ MODE
 */
export function resolveHeaderMode(pageType: EvidencePageType): string {
  switch (pageType) {
    case "COVER":
      return "COVER";
    case "SUMMARY_TABLE":
      return "10-COLUMN LEDGER";
    case "EXECUTIVE_SUMMARY":
      return "EXECUTIVE SUMMARY";
    case "HASH_MANIFEST":
      return "SHA-256 MANIFEST";
    case "SLIP":
      return "SLIP";
    case "CHAT":
      return "CHAT";
    case "STANDBY":
      return "STANDBY";
    default:
      return "EVIDENCE";
  }
}

/**
 * 2. ตรรกะเงื่อนไขของฟิลด์ CORROBORATED (หัวใจสำคัญในการสืบพยาน)
 */
export function resolveHeaderCorroborated(ctx: HeaderPageContext): string {
  switch (ctx.type) {
    case "COVER":
      return "หน้าปกสรุปสำนวนพยานหลักฐานดิจิทัล";

    case "EXECUTIVE_SUMMARY":
      return "สรุปยอดความเสียหายสุทธิและเส้นทางเงินคดีอาญา";

    case "SUMMARY_TABLE":
      return "สารบัญสรุปเส้นทางธุรกรรมการเงิน 10 คอลัมน์";

    case "HASH_MANIFEST":
      return "บัญชีคุมความคงสภาพพยานหลักฐานดิจิทัล (SHA-256)";

    case "SLIP":
      if (ctx.isDuplicate) {
        return `สลิปซ้ำซ้อนกับรายการที่ ${ctx.duplicateOfNo || "-"} (ตัดออกจากการคำนวณ NET)`;
      }
      if (ctx.targetName && ctx.amount !== undefined && ctx.amount !== null && ctx.amount > 0) {
        return `พบความสัมพันธ์ตรงกับ ${ctx.targetName} (ยอดโอน ฿ ${ctx.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })})`;
      }
      if (ctx.amount !== undefined && ctx.amount !== null && ctx.amount > 0) {
        return `พยานหลักฐานสลิปการเงินในสำนวนคดี (รายการที่ ${ctx.itemIndex || 1}) ยอดโอน ฿ ${ctx.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
      }
      return `พยานหลักฐานสลิปการเงินในสำนวนคดี (รายการที่ ${ctx.itemIndex || 1})`;

    case "CHAT":
      if (ctx.chatHasSlip) {
        return `พบบทสนทนาสั่งโอนเงิน (ตรงกับสลิปในหน้า ${ctx.slipPageRef || "-"})`;
      }
      return "บทสนทนาทั่วไปในคดี (บริบทความสัมพันธ์แห่งคดี)";

    case "STANDBY":
    default:
      return "[ รอนำเข้าไฟล์พยานหลักฐาน ]";
  }
}

/**
 * 3. ตรรกะของฟิลด์ PAGE (ระบบรันเลขหน้าต่อเนื่องระดับสากล)
 * กฎเหล็ก: หน้าปกห้ามนับเป็นหน้า 1 ป้องกันเลขหน้ากระดาษหลักฐานเลื่อน
 */
export function resolveHeaderPageNumber(
  pageIndex: number,
  totalPages: number,
  pageType: EvidencePageType
): string {
  if (pageType === "COVER") {
    return "COVER";
  }
  return `${pageIndex} / ${totalPages}`;
}

/**
 * 4. ตรรกะของแคปซูลสถานะบน Web Header (Status Capsule)
 */
export function resolveWebHeaderStatus(params: {
  loading: boolean;
  batchProgress?: { current: number; total: number } | null;
  evidence: ForensicEvidenceState;
  targetName?: string | null;
}): HeaderStatusCapsuleState {
  const { loading, batchProgress, evidence, targetName } = params;

  // 1. กำลังประมวลผล (Processing)
  if (loading) {
    const percent = batchProgress
      ? Math.round((batchProgress.current / batchProgress.total) * 100)
      : 50;
    return {
      color: "#FBBF24", // สีเหลือง
      glowColor: "rgba(251, 191, 36, 0.4)",
      isPulsing: true,
      text: `กำลังสกัดพยานหลักฐานระดับพิกเซล... (${percent}%)`,
    };
  }

  // 2. พบเป้าหมายตรงกัน (Target Matched)
  if (targetName && targetName.trim().length > 0 && evidence.poiLossSum > 0) {
    return {
      color: "#10B981", // เขียวมรกต
      glowColor: "rgba(16, 185, 129, 0.4)",
      isPulsing: false,
      text: `พบเป้าหมาย: ${targetName} (ยอด ฿${evidence.poiLossSum.toLocaleString("th-TH", { minimumFractionDigits: 2 })})`,
    };
  }

  // 3. ประมวลผลเสร็จสมบูรณ์ มีสลิปหรือแชทในสำนวน (Complete)
  if (evidence.slipCount > 0 || evidence.chatPageCount > 0) {
    return {
      color: "#4DDFBA", // ฟ้าอมเขียว
      glowColor: "rgba(77, 223, 186, 0.4)",
      isPulsing: false,
      text: `ตรวจพบสลิป ${evidence.slipCount} รายการ • แชท ${evidence.chatPageCount} หน้า (สำนวนพร้อมพิมพ์)`,
    };
  }

  // 4. Idle / Zero State
  return {
    color: "#34D399", // เขียวพร้อมใช้งาน
    glowColor: "rgba(52, 211, 153, 0.4)",
    isPulsing: false,
    text: "ระบบพร้อมใช้งาน (ISO/IEC 27037 Standard)",
  };
}

/**
 * 5. Dynamic Shrink-to-Fit บน Canvas 2D
 * ย่อขนาดฟอนต์จาก initialSize ลงทีละ 1pt จนกว่าความกว้างจะไม่เกิน maxWidth หรือถึง minSize
 */
export function fitCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialSize: number = 17,
  minSize: number = 10,
  fontFamily: string = "'Sarabun', sans-serif",
  fontWeight: string = "300"
): { fontSize: number; width: number } {
  let currentSize = initialSize;
  ctx.font = `${fontWeight} ${currentSize}pt ${fontFamily}`;
  let textWidth = ctx.measureText(text).width;

  while (textWidth > maxWidth && currentSize > minSize) {
    currentSize -= 1;
    ctx.font = `${fontWeight} ${currentSize}pt ${fontFamily}`;
    textWidth = ctx.measureText(text).width;
  }

  return { fontSize: currentSize, width: textWidth };
}
