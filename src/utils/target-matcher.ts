/**
 * Zero-Prefix Stripping Engine & Identity Matching Suite (SSOT)
 * Master Rule: "ไม่สนว่าจะมีคำนำหน้าว่าอะไร ชื่อตรง นามสกุลตรง นั้นคือถูก (Zero-Prefix Matching)"
 * Standards: ISO/IEC 27037 & Thai Electronic Transactions Act B.E. 2544
 */

export interface TargetPersonItem {
  id: string;
  rawName: string;
  cleanName: string;
  role?: string;
  accountNo?: string;
  bank?: string;
  selected: boolean;
  totalAmount?: number;
  txCount?: number;
}

/**
 * ฟังก์ชันลอกคำนำหน้าชื่อทุกมิติ (Zero-Prefix Stripping Engine)
 * ครอบคลุม: ยศตำรวจ, ยศทหาร, วิชาการ, แพทย์, ฐานันดรศักดิ์, คำนำหน้าทั่วไป, นิติบุคคล, ภาษาอังกฤษ และวงเล็บเลขบัญชี
 */
export function stripThaiTitlePrefix(rawName: string | null | undefined): string {
  if (!rawName || typeof rawName !== "string") return "";

  let clean = rawName.trim();

  // 1. ตัดข้อความในวงเล็บและเลขบัญชีท้ายชื่อ เช่น (XXX-X-XX452-9)
  clean = clean.replace(/\s*\([^)]*\)/g, "");
  clean = clean.replace(/\s*\[[^\]]*\]/g, "");

  // 2. ตัดคำกำกับบทบาท เช่น 'ผู้โอน:', 'ผู้รับโอน:', 'จาก:', 'ไปยัง:', 'ถึง:'
  clean = clean.replace(/^(ผู้โอน|ผู้รับโอน|ผู้รับเงิน|บัญชีผู้รับ|ไปยัง|ถึง|จาก|To|From)\s*[:：\-]?\s*/i, "");

  // 3. พจนานุกรมคำนำหน้าชื่อภาษาไทยและยศทุกประเภท
  const prefixes = [
    // ยศตำรวจ
    "พล.ต.อ.หญิง", "พล.ต.อ.", "พล.ต.ท.หญิง", "พล.ต.ท.", "พล.ต.ต.หญิง", "พล.ต.ต.",
    "พ.ต.อ.หญิง", "พ.ต.อ.", "พ.ต.ท.หญิง", "พ.ต.ท.", "พ.ต.ต.หญิง", "พ.ต.ต.",
    "ร.ต.อ.หญิง", "ร.ต.อ.", "ร.ต.ท.หญิง", "ร.ต.ท.", "ร.ต.ต.หญิง", "ร.ต.ต.",
    "ด.ต.หญิง", "ด.ต.", "จ.ส.ต.หญิง", "จ.ส.ต.", "ส.ต.อ.หญิง", "ส.ต.อ.", "ส.ต.ท.", "ส.ต.ต.",
    // ยศทหารบก / เรือ / อากาศ
    "พล.อ.", "พล.ท.", "พล.ต.", "พ.อ.", "พ.ท.", "พ.ต.", "ร.อ.", "ร.ท.", "ร.ต.",
    "จ.ส.อ.", "จ.ส.ท.", "จ.ส.ต.", "ส.อ.", "ส.ท.", "ส.ต.", "ว่าที่ ร.ต.", "ว่าที่ร.ต.",
    // ตำแหน่งวิชาการ / การแพทย์
    "ศ.ดร.", "รศ.ดร.", "ผศ.ดร.", "ศ.", "รศ.", "ผศ.", "ดร.", "นพ.", "พญ.", "ทพ.", "ทพญ.", "ภก.", "ภญ.", "อ.",
    // ฐานันดรศักดิ์
    "ม.ร.ว.", "ม.ล.", "ม.จ.", "หม่อมราชวงศ์", "หม่อมหลวง",
    // คำนำหน้าสามัญชน
    "เด็กชาย", "เด็กหญิง", "ด.ช.", "ด.ญ.", "นางสาว", "น.ส.", "นาย", "นาง", "คุณ", "ท่าน",
    // นิติบุคคล / ห้างร้าน
    "บริษัท", "บจก.", "บมจ.", "ห้างหุ้นส่วนจำกัด", "หจก.", "ร้าน",
    // ภาษาอังกฤษ
    "Mr\\.", "Mrs\\.", "Miss", "Ms\\.", "Dr\\.", "Prof\\.", "Pol\\.", "Gen\\.", "Col\\.", "Capt\\."
  ];

  // เรียงลำดับจากยาวไปสั้นเพื่อป้องกันการตัดคำผิดพลาด (เช่น 'นางสาว' ต้องตัดก่อน 'นาง')
  prefixes.sort((a, b) => b.length - a.length);

  // ทำการตัดคำนำหน้าออก
  for (const prefix of prefixes) {
    const regex = new RegExp("^" + prefix + "\\s*", "i");
    if (regex.test(clean)) {
      clean = clean.replace(regex, "").trim();
      break;
    }
  }

  return clean.trim();
}

/**
 * ฟังก์ชันเปรียบเทียบอัตลักษณ์บุคคล ("ชื่อตรง นามสกุลตรง นั้นคือถูก")
 */
export function isTargetMatch(extractedName: string | null | undefined, targetName: string | null | undefined): boolean {
  if (!extractedName || !targetName) return false;

  const cleanExtracted = stripThaiTitlePrefix(extractedName).toLowerCase();
  const cleanTarget = stripThaiTitlePrefix(targetName).toLowerCase();

  if (!cleanExtracted || !cleanTarget) return false;
  if (cleanExtracted === cleanTarget) return true;

  // Partial substring match if longer than 3 chars
  if (cleanTarget.length >= 3 && cleanExtracted.includes(cleanTarget)) return true;
  if (cleanExtracted.length >= 3 && cleanTarget.includes(cleanExtracted)) return true;

  // แยกชื่อต้นและนามสกุล
  const partsExtracted = cleanExtracted.split(/\s+/);
  const partsTarget = cleanTarget.split(/\s+/);

  // ตรวจชื่อต้นตรงกัน
  if (partsExtracted[0] && partsTarget[0] && partsExtracted[0] === partsTarget[0]) {
    // ถ้าระบุเป้าหมายแค่ชื่อต้นอย่างเดียว หรือนามสกุลในสลิปถูก Mask (เช่น ร***)
    if (partsTarget.length === 1) return true;
    if (partsExtracted.length > 1 && partsTarget.length > 1) {
      const p1 = partsExtracted[1].replace(/\*/g, "");
      const p2 = partsTarget[1].replace(/\*/g, "");
      if (p1 && p2 && (partsExtracted[1].startsWith(p2) || partsTarget[1].startsWith(p1))) {
        return true;
      }
    }
  }

  return false;
}
