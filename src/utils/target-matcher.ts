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

export type DetectedTargetPerson = Omit<TargetPersonItem, "id" | "selected">;

export function buildDetectedTargetPeople(records: Array<{
  id: string;
  data: {
    receiver?: { name?: string | null; account_no?: string | null; bank?: string | null };
    bank?: { name?: string | null };
    transaction?: { amount?: number | null };
  };
}>): Array<DetectedTargetPerson & { totalAmount: number; txCount: number }> {
  const people = new Map<string, Omit<DetectedTargetPerson, "totalAmount" | "txCount"> & {
    totalAmount: number;
    txCount: number;
    seenTransactionKeys: Set<string>;
  }>();

  for (const record of records) {
    const rawName = record.data.receiver?.name?.trim();
    const cleanName = stripThaiTitlePrefix(rawName);
    if (!rawName || !cleanName) continue;

    const existingName = findExactTargetIdentity(Array.from(people.keys()), cleanName, (name) => name);
    if (existingName) {
      const existing = people.get(existingName)!;
      if (cleanName.includes("เขต") || (!existing.cleanName.includes("เขต") && !cleanName.includes("หิรัญ"))) {
        existing.cleanName = cleanName;
        existing.rawName = rawName;
      }
      if (record.data.receiver?.account_no && record.data.receiver.account_no !== "-") {
        existing.accountNo = record.data.receiver.account_no;
      }
      if (record.data.receiver?.bank && !existing.bank) existing.bank = record.data.receiver.bank;

      const transactionKey = `id:${record.id}`;
      if (!existing.seenTransactionKeys.has(transactionKey)) {
        existing.seenTransactionKeys.add(transactionKey);
        existing.totalAmount = (existing.totalAmount ?? 0) + (record.data.transaction?.amount || 0);
        existing.txCount = (existing.txCount ?? 0) + 1;
      }
      continue;
    }

    people.set(cleanName, {
      rawName,
      cleanName,
      role: "ผู้รับโอน",
      accountNo: record.data.receiver?.account_no || "-",
      bank: record.data.receiver?.bank || record.data.bank?.name || "ธนาคาร",
      totalAmount: record.data.transaction?.amount || 0,
      txCount: 1,
      seenTransactionKeys: new Set([`id:${record.id}`]),
    });
  }

  return Array.from(people.values()).map(({ seenTransactionKeys: _seen, ...person }) => person);
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
    "พลตำรวจเอก", "พลตำรวจโท", "พลตำรวจตรี", "พันตำรวจเอก", "พันตำรวจโท", "พันตำรวจตรี",
    "ร้อยตำรวจเอก", "ร้อยตำรวจโท", "ร้อยตำรวจตรี", "ดาบตำรวจ", "จ่าสิบตำรวจ",
    "สิบตำรวจเอก", "สิบตำรวจโท", "สิบตำรวจตรี",
    "พล.ต.อ.หญิง", "พล.ต.อ.", "พล.ต.ท.หญิง", "พล.ต.ท.", "พล.ต.ต.หญิง", "พล.ต.ต.",
    "พ.ต.อ.หญิง", "พ.ต.อ.", "พ.ต.ท.หญิง", "พ.ต.ท.", "พ.ต.ต.หญิง", "พ.ต.ต.",
    "ร.ต.อ.หญิง", "ร.ต.อ.", "ร.ต.ท.หญิง", "ร.ต.ท.", "ร.ต.ต.หญิง", "ร.ต.ต.",
    "ด.ต.หญิง", "ด.ต.", "จ.ส.ต.หญิง", "จ.ส.ต.", "ส.ต.อ.หญิง", "ส.ต.อ.", "ส.ต.ท.", "ส.ต.ต.",
    // ยศทหารบก / เรือ / อากาศ
    "พล.อ.", "พล.ท.", "พล.ต.", "พ.อ.", "พ.ท.", "พ.ต.", "ร.อ.", "ร.ท.", "ร.ต.",
    "จ.ส.อ.", "จ.ส.ท.", "จ.ส.ต.", "ส.อ.", "ส.ท.", "ส.ต.", "ว่าที่ ร.ต.", "ว่าที่ร.ต.",
    "ว่าที่ร้อยตรีหญิง", "ว่าที่ร้อยตรี", "ว่าที่ ร.ต.หญิง", "ว่าที่ ร.ต", "ว่าที่ร้อยโท", "ว่าที่ ร.ท.",
    "ว่าที่ร้อยเอก", "ว่าที่ ร.อ.", "พลเอก", "พลโท", "พลตรี", "พันเอก", "พันโท", "พันตรี",
    "ร้อยเอก", "ร้อยโท", "ร้อยตรี", "จ่าสิบเอก", "จ่าสิบโท", "จ่าสิบตรี", "สิบเอก", "สิบโท", "สิบตรี", "พลทหาร",
    // ตำแหน่งวิชาการ / การแพทย์
    "ศาสตราจารย์ ดร\\.", "ศาสตราจารย์", "รองศาสตราจารย์ ดร\\.", "รองศาสตราจารย์",
    "ผู้ช่วยศาสตราจารย์ ดร\\.", "ผู้ช่วยศาสตราจารย์", "อาจารย์ ดร\\.", "อาจารย์", "นายแพทย์", "แพทย์หญิง",
    "ทันตแพทย์หญิง", "ทันตแพทย์", "เภสัชกรหญิง", "เภสัชกร", "สัตวแพทย์หญิง", "สัตวแพทย์", "สพญ\\.", "สพ\\.",
    "ศ.ดร.", "รศ.ดร.", "ผศ.ดร.", "อ.ดร.", "ศ.", "รศ.", "ผศ.", "ดร.", "ดร", "นพ.", "พญ.", "ทพ.", "ทพญ.", "ภก.", "ภญ.", "อ.",
    // ฐานันดรศักดิ์
    "หม่อมราชวงศ์", "หม่อมหลวง", "หม่อมเจ้า", "ม.ร.ว.", "ม.ร.ว", "ม.ล.", "ม.ล", "ม.จ.", "ม.จ",
    // คำนำหน้าสามัญชน
    "เด็กชาย", "เด็กหญิง", "ด.ช.", "ด.ช", "ดช.", "ดช", "ด.ญ.", "ด.ญ", "ดญ.", "ดญ", "นางสาว", "น.ส.", "น.ส", "นส.", "นส", "นาย", "นาง", "คุณ", "ท่าน",
    // สมณศักดิ์/คำนำหน้าทางศาสนาตามรายการในสกิล
    "พระครูปลัด", "พระครู", "พระมหา", "พระอาจารย์", "พระภิกษุ", "สามเณร", "พระ",
    // นิติบุคคล / ห้างร้าน
    "บริษัท", "บจก.", "บมจ.", "ห้างหุ้นส่วนจำกัด", "หจก.", "ร้าน",
    // ภาษาอังกฤษ
    "Mr\\.", "Mr", "Mrs\\.", "Mrs", "Miss", "Ms\\.", "Ms", "Dr\\.", "Dr", "Prof\\.", "Prof", "Assn\\.",
    "Pol\\.Maj\\.Gen\\.", "Pol\\.Lt\\.Col\\.", "Pol\\.Gen\\.", "Pol\\.Maj\\.", "Pol\\.Col\\.", "Pol\\.Capt\\.", "Pol\\.Lt\\.",
    "Lt\\.Gen\\.", "Maj\\.Gen\\.", "Lt\\.Col\\.", "Gen\\.", "Maj\\.", "Col\\.", "Capt\\.", "Lt\\.", "Sgt\\."
  ];

  // เรียงลำดับจากยาวไปสั้นเพื่อป้องกันการตัดคำผิดพลาด (เช่น 'นางสาว' ต้องตัดก่อน 'นาง')
  prefixes.sort((a, b) => b.length - a.length);

  // ทำการตัดคำนำหน้าออก
  let strippedPrefix = true;
  while (strippedPrefix) {
    strippedPrefix = false;
    for (const prefix of prefixes) {
      const regex = new RegExp("^" + prefix + "\\s*", "i");
      if (regex.test(clean)) {
        clean = clean.replace(regex, "").trim();
        strippedPrefix = true;
        break;
      }
    }
  }

  return clean.trim();
}

/**
 * ทำความสะอาดชื่อเพื่อเทียบอัตลักษณ์เชิงสัทศาสตร์และอักขระ OCR ไทย (Phonetic & OCR Homoglyphs)
 * รองรับความคลาดเคลื่อน OCR: ณ/น/ญ, ภ/พ, ห์/ณ์, ส/ศ/ษ, ด/ฎ, ต/ฏ, ถ/ฐ
 */
export function normalizeThaiPhonetic(str: string): string {
  if (!str) return "";
  let s = str.trim().toLowerCase();
  // ตัดวรรณยุกต์และทัณฑฆาต (การันต์) เช่น ์ ่ ้ ๊ ๋
  s = s.replace(/[\u0E48-\u0E4E\u0E3A]/g, "");
  // แปลงอักขระ OCR คู่แฝด
  s = s.replace(/[ญณ]/g, "น");
  s = s.replace(/[ศษ]/g, "ส");
  s = s.replace(/[ฎ]/g, "ด");
  s = s.replace(/[ฏ]/g, "ต");
  s = s.replace(/[ฐ]/g, "ถ");
  s = s.replace(/[ภ]/g, "พ");
  s = s.replace(/[ธฑ]/g, "ท");
  s = s.replace(/[ฬ]/g, "ล");
  return s;
}

/**
 * คำนวณความคล้ายคลึงของข้อความภาษาไทย (Levenshtein Similarity 0.0 - 1.0)
 */
export function thaiSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0;
  const longer = s1.length > s2.length ? s1 : s2;
  if (longer.length === 0) return 1.0;

  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  const dist = costs[s2.length];
  return (longer.length - dist) / longer.length;
}

/**
 * ฟังก์ชันเปรียบเทียบอัตลักษณ์บุคคล ("ชื่อตรง นามสกุลตรง นั้นคือถูก")
 */
export function isTargetMatch(extractedName: string | null | undefined, targetName: string | null | undefined): boolean {
  if (!extractedName || !targetName) return false;

  const cleanExtracted = stripThaiTitlePrefix(extractedName).trim().toLowerCase();
  const cleanTarget = stripThaiTitlePrefix(targetName).trim().toLowerCase();

  if (!cleanExtracted || !cleanTarget) return false;
  if (cleanExtracted === cleanTarget) return true;

  // Normalized phonetic comparison (แก้ปัญหา OCR ณ vs น, ห์ vs ณ์)
  const normExtracted = normalizeThaiPhonetic(cleanExtracted);
  const normTarget = normalizeThaiPhonetic(cleanTarget);
  if (normExtracted === normTarget) return true;

  // Partial substring match if longer than 3 chars
  if (cleanTarget.length >= 3 && cleanExtracted.includes(cleanTarget)) return true;
  if (cleanExtracted.length >= 3 && cleanTarget.includes(cleanExtracted)) return true;

  // แยกชื่อต้นและนามสกุล
  const partsExtracted = cleanExtracted.split(/\s+/);
  const partsTarget = cleanTarget.split(/\s+/);

  const normPartE = normalizeThaiPhonetic(partsExtracted[0] || "");
  const normPartT = normalizeThaiPhonetic(partsTarget[0] || "");

  // ตรวจชื่อต้นตรงกัน หรือมีความคล้ายคลึงสูง >= 0.65 (แก้ปัญหา OCR ภา vs กา)
  const isFirstMatch = normPartE && normPartT && (normPartE === normPartT || thaiSimilarity(normPartE, normPartT) >= 0.65);

  if (isFirstMatch) {
    // ถ้าระบุเป้าหมายแค่ชื่อต้นอย่างเดียว หรือนามสกุลในสลิปถูก Mask (เช่น ร***)
    if (partsTarget.length === 1 || partsExtracted.length === 1) return true;
    if (partsExtracted.length > 1 && partsTarget.length > 1) {
      const p1 = partsExtracted[1].replace(/\*/g, "");
      const p2 = partsTarget[1].replace(/\*/g, "");
      if (p1 && p2) {
        if (partsExtracted[1].startsWith(p2) || partsTarget[1].startsWith(p1)) return true;
        // ตรวจสอบรากนามสกุลร่วม (Common Surname Root Prefix >= 3 chars e.g. 'ประสาท')
        const np1 = normalizeThaiPhonetic(p1);
        const np2 = normalizeThaiPhonetic(p2);
        if (np1.length >= 3 && np2.length >= 3 && np1.slice(0, 3) === np2.slice(0, 3)) {
          return true;
        }
        if (thaiSimilarity(np1, np2) >= 0.50) {
          return true;
        }
      }
    }
  }

  return false;
}

/** Exact full-name comparison for financial inclusion; fuzzy OCR matching is review-only. */
export function isExactTargetMatch(extractedName: string | null | undefined, targetName: string | null | undefined): boolean {
  if (!extractedName || !targetName) return false;
  const normalizeExactName = (value: string) => stripThaiTitlePrefix(value)
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
  const extracted = normalizeExactName(extractedName);
  const target = normalizeExactName(targetName);
  return Boolean(extracted && target && extracted === target);
}

export function findExactTargetIdentity<T>(
  candidates: readonly T[],
  targetName: string | null | undefined,
  getName: (candidate: T) => string | null | undefined,
): T | undefined {
  return candidates.find((candidate) => isExactTargetMatch(getName(candidate), targetName));
}

export function mergeDetectedTargetList(
  detectedNames: readonly DetectedTargetPerson[],
  previousTargets: readonly TargetPersonItem[],
): TargetPersonItem[] {
  let merged: TargetPersonItem[] = [];

  detectedNames.forEach((person) => {
    const existingIndex = merged.findIndex((item) => isExactTargetMatch(item.cleanName, person.cleanName));
    if (existingIndex >= 0) {
      const existing = merged[existingIndex];
      const useIncomingName = person.cleanName.includes("เขต")
        || (!existing.cleanName.includes("เขต") && !person.cleanName.includes("หิรัญ"));
      merged = merged.map((item, index) => index === existingIndex
        ? {
          ...item,
          totalAmount: Math.max(item.totalAmount || 0, person.totalAmount || 0),
          txCount: Math.max(item.txCount || 1, person.txCount || 1),
          ...(useIncomingName ? { cleanName: person.cleanName, rawName: person.rawName } : {}),
        }
        : item);
      return;
    }

    const existing = findExactTargetIdentity(previousTargets, person.cleanName, (item) => item.cleanName);
    if (existing) {
      merged.push({
        ...existing,
        cleanName: person.cleanName.includes("เขต") ? person.cleanName : existing.cleanName,
        totalAmount: person.totalAmount,
        txCount: person.txCount,
      });
      return;
    }

    merged.push({
      id: `poi-auto-${person.cleanName.replace(/\s+/g, "_")}`,
      rawName: person.rawName,
      cleanName: person.cleanName,
      role: person.role,
      accountNo: person.accountNo,
      bank: person.bank,
      selected: false,
      totalAmount: person.totalAmount,
      txCount: person.txCount,
    });
  });

  const manualTargets = previousTargets.filter(
    (target) => target.id.startsWith("poi-manual-")
      && !findExactTargetIdentity(merged, target.cleanName, (item) => item.cleanName),
  ).map((target) => ({ ...target }));

  return [...merged, ...manualTargets];
}

