/**
 * ==========================================================================
 * FORENSIC SSOT CONSTANTS & SPECIFICATION (SINGLE SOURCE OF TRUTH)
 * Synchronized across UI Components, 2D HTML Canvas, and PDF Court Dossier
 * ==========================================================================
 */

export const LEGAL_DISCLAIMER_LINES = [
  "DIGITAL EVIDENCE เป็นเพียงเครื่องมืออำนวยความสะดวกให้กับผู้ว่าจ้าง โดยไม่ได้ดัดแปลง แก้ไข เพิ่ม-ลบ เนื้อหา",
  "จากต้นฉบับใดๆ และไม่มีส่วนเกี่ยวข้องใดๆ กับเนื้อหาในเอกสาร เป็นเพียงเครื่องมือที่ทำงานเกี่ยวกับระบบไฟล์",
  "เอกสารแบบอิเล็กทรอนิกส์ เท่านั้น",
] as const;

export const LEGAL_DISCLAIMER_TEXT = LEGAL_DISCLAIMER_LINES.join("\n");

export const FORENSIC_CANVAS_SPEC = {
  // A4 Geometry (Standard 150 DPI)
  a4WidthPx: 993,
  a4HeightPx: 1406,
  aspectRatio: 1 / 1.4159,

  // Blocks
  slipBlockW: 645,
  slipBlockH: 890,
  slipCenterX: 174,
  slipCenterY: 247,

  chatBlockW: 807,
  chatBlockH: 1115,
  chatTopX: 93,
  chatTopY: 133,

  // Anti-Collision & No-Sink Thai Typography Rules
  footer: {
    lineSpacing: 27, // Strictly 26px - 28px
    fontSize: 13.5, // Sarabun Regular (400)
    fontFamily: "'Sarabun', sans-serif",
    textBaseline: "alphabetic" as CanvasTextBaseline,
    footerY: 1406 - 92, // 1314 px
    textColor: "#475569",
  },
} as const;

export const WORKFLOW_STEPS = [
  { id: 1, label: "อัพโหลดข้อมูล", sub: "Upload & Intake" },
  { id: 2, label: "ตรวจสอบและประมวลผล", sub: "Process & Match" },
  { id: 3, label: "สร้างเอกสารหลักฐาน", sub: "Document & Audit" },
  { id: 4, label: "เสร็จสิ้น", sub: "Export & Packaging" },
] as const;

export interface ForensicEvidenceState {
  totalNetLoss: number;
  slipCount: number;
  chatPageCount: number;
  poiName: string | null;
  poiLossSum: number;
  corroboratedPairsCount: number;
  duplicateCount: number;
  processedAt: string | null;
}

/**
 * PURE ZERO STATE INITIALIZER (ห้าม Hardcode ข้อมูลสมมุติเด็ดขาด)
 */
export const PURE_ZERO_STATE: ForensicEvidenceState = {
  totalNetLoss: 0,
  slipCount: 0,
  chatPageCount: 0,
  poiName: null,
  poiLossSum: 0,
  corroboratedPairsCount: 0,
  duplicateCount: 0,
  processedAt: null,
};
