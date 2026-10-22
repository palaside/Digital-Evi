import type { SlipExtraction } from "../schemas/slip.schema.ts";
import { buildSlipFallbackMetadata } from "./slip-fallback-metadata.mjs";

export interface OcrTextLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface SlipOcrRegion {
  bounds: { x0: number; y0: number; x1: number; y1: number };
  focusBounds: { x0: number; y0: number; x1: number; y1: number };
  recipientFocusBounds: { x0: number; y0: number; x1: number; y1: number } | null;
  amount: number | null;
  amountConfidence: number;
  fee: number | null;
  feeConfidence: number;
  date: string | null;
  dateConfidence: number;
  dateTimeSource: "ocr" | "reference" | null;
  time: string | null;
  timeConfidence: number;
  referenceNo: string | null;
  referenceConfidence: number;
  bankName: string | null;
  bankConfidence: number;
  receiverName: string | null;
  receiverNameConfidence: number;
  receiverNameRetryConflict: boolean;
  senderName: string | null;
  senderNameConfidence: number;
  senderAccount: string | null;
  senderAccountConfidence: number;
  receiverAccount: string | null;
  receiverAccountConfidence: number;
  senderBankName: string | null;
  receiverBankName: string | null;
  rawText: string;
  ocrLineEvidence: Array<{
    text: string;
    confidence: number;
    bounds: { x: number; y: number; width: number; height: number };
    classification: "slip_evidence" | "chat_context" | "uncertain";
    reason: string;
    supportsFields: string[];
  }>;
}

const MISSING_FIELDS_WARNING_PREFIX = "ข้อมูลที่ยังอ่านไม่ได้และต้องตรวจทาน:";

function isMissingSlipField(value: string | number | null | undefined): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function applyMissingSlipReviewWarnings(data: SlipExtraction): SlipExtraction {
  const fallbackMeta = buildSlipFallbackMetadata(data);
  const missingFields = [
    ["วันที่", data.transaction.date],
    ["เวลา", data.transaction.time],
    ["ธนาคาร", data.bank.name],
    ["ธนาคารต้นทาง", data.sender.bank],
    ["ชื่อผู้โอน", data.sender.name],
    ["ยอดเงิน", data.transaction.amount],
    ["ชื่อผู้รับ", data.receiver.name],
    ["ธนาคารปลายทาง", data.receiver.bank],
    ["บันทึกช่วยจำ", data.transaction.note],
  ].filter(([, value]) => isMissingSlipField(value))
    .map(([label]) => label as string);
  const retainedWarnings = data.warnings.filter((warning) => !warning.startsWith(MISSING_FIELDS_WARNING_PREFIX));

  return {
    ...data,
    _fallback_meta: fallbackMeta,
    warnings: missingFields.length
      ? [...retainedWarnings, `${MISSING_FIELDS_WARNING_PREFIX} ${missingFields.join(", ")}`]
      : retainedWarnings,
  };
}

interface RecipientMatch {
  name: string | null;
  confidence: number;
  labelLine: OcrTextLine | null;
  nameLine: OcrTextLine | null;
  senderAccountLine?: OcrTextLine;
  receiverAccountLine?: OcrTextLine;
}

const BANK_NAMES = [
  [/กรุงไทย|krungthai/i, "ธนาคารกรุงไทย"],
  [/กสิกรไทย|kasikorn/i, "ธนาคารกสิกรไทย"],
  [/กรุงเทพ|bangkok\s*bank/i, "ธนาคารกรุงเทพ"],
  [/ไทยพาณิชย์|\bscb\b/i, "ธนาคารไทยพาณิชย์"],
  [/กรุงศรี|krungsri/i, "ธนาคารกรุงศรีอยุธยา"],
  [/ทหารไทยธนชาต|ทีเอ็มบีธนชาต|\bttb\b/i, "ธนาคารทหารไทยธนชาต"],
  [/ออมสิน|\bgsb\b/i, "ธนาคารออมสิน"],
] as const;

const normalizeText = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
const hasAmountLabel = (text: string) => /[จขอ][ํำ]านวน(?:เง[ิี]?น|เว[ิี]น)|ยอดเงิน|amount/.test(text);
const hasSuccessCue = (text: string) => /โอนเงิน.{0,4}(?:เร็จ|เรือ)|โอน.{0,4}สำเร็จ|transfersuccess|successfultransfer/.test(text);
const hasReferenceCue = (text: string) => /(?:รหัส|เลขที่)อ้างอ.{0,2}ง|reference|transactionid/.test(text);
const hasFeeCue = (text: string) => /ค[่ํ]?าธรรมเนียม|fee/.test(text);
const hasPartyCue = (text: string) => /ผู้โอน|ผู้รับ|ไปยัง|จาก|\bfrom\b|\bto\b/.test(text);

function parseAmount(text: string): number | null {
  const match = text.match(/(?:฿\s*)?(\d{1,3}(?:[,.]\d{3})+\.\d{2}|\d[\d,]*(?:\.\d{2})?)(?=\s*(?:บาท|THB|$))/i)
    ?? (hasAmountLabel(normalizeText(text)) ? text.match(/(\d{1,3}(?:[,.]\d{3})+\.\d{2}|\d[\d,]*\.\d{2})/) : null);
  if (!match || (!match[1].includes(".") && !/(?:บาท|THB)/i.test(text))) return null;
  const normalizedAmount = match[1].replace(/^(\d{1,3}(?:\.\d{3})+)\.(\d{2})$/, (_, groups: string, cents: string) =>
    `${groups.replace(/\./g, "")}.${cents}`,
  ).replace(/,/g, "");
  const amount = Number(normalizedAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseStandaloneAmount(text: string): number | null {
  const value = text.trim().replace(/^[\s|]+|[\s|]+$/g, "");
  const match = value.match(/^(?:฿\s*)?(\d[\d,]*\.\d{2})(?:\s*(?:บาท|THB))?$/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseFee(text: string): number | null {
  if (!hasFeeCue(normalizeText(text))) return null;
  const match = text.match(/(?:฿\s*)?(\d[\d,]*(?:\.\d{2})?)(?=\s*(?:บาท|THB|$))/i);
  if (!match) return null;
  const fee = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(fee) && fee >= 0 ? fee : null;
}

function parseThaiDateTime(lines: OcrTextLine[]): { date: string | null; time: string | null; confidence: number } {
  const months: Record<string, string> = {
    "ม.ค.": "01", "มกราคม": "01", "ก.พ.": "02", "กุมภาพันธ์": "02",
    "มี.ค.": "03", "มีนาคม": "03", "เม.ย.": "04", "เมษายน": "04",
    "พ.ค.": "05", "พฤษภาคม": "05", "มิ.ย.": "06", "บิ.ย.": "06", "มิถุนายน": "06",
    "ก.ค.": "07", "กรกฎาคม": "07", "ส.ค.": "08", "สิงหาคม": "08",
    "ก.ย.": "09", "กันยายน": "09", "ต.ค.": "10", "ตุลาคม": "10",
    "พ.ย.": "11", "พฤศจิกายน": "11", "ธ.ค.": "12", "ธันวาคม": "12",
  };
  for (const line of lines) {
    const text = line.text.replace(/[๐-๙]/g, (digit) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(digit)));
    const monthName = Object.keys(months).sort((a, b) => b.length - a.length).find((name) => text.includes(name));
    if (!monthName) continue;
    const monthIndex = text.indexOf(monthName);
    const dayMatch = text.slice(0, monthIndex).match(/(\d{1,2})\s*$/);
    const afterMonth = text.slice(monthIndex + monthName.length);
    const dateTail = afterMonth.match(/^\s*(\d{2,4})(?:\D{0,12}(\d{1,2}):(\d{2}))?/);
    if (!dayMatch || !dateTail) continue;
    const month = months[monthName];
    const [, dayText] = dayMatch;
    const [, yearText, hourText, minuteText] = dateTail;
    const yearNumber = Number(yearText);
    const year = yearNumber < 100
      ? yearNumber >= 50 ? 1957 + yearNumber : 2000 + yearNumber
      : yearNumber >= 2400 ? yearNumber - 543 : yearNumber;
    const day = Number(dayText);
    const maxDay = new Date(Date.UTC(year, Number(month), 0)).getUTCDate();
    if (day < 1 || day > maxDay || year < 2000 || year > 2100) continue;
    return {
      date: `${year}-${month}-${String(day).padStart(2, "0")}`,
      time: hourText && Number(hourText) < 24 && Number(minuteText) < 60 ? `${hourText.padStart(2, "0")}:${minuteText}` : null,
      confidence: Math.max(0, Math.min(1, line.confidence / 100)),
    };
  }
  return { date: null, time: null, confidence: 0 };
}

function parseTimestampFromReference(reference: string | null): { date: string; time: string } | null {
  if (!reference || !/^20\d{10,}$/.test(reference)) return null;
  const year = Number(reference.slice(0, 4));
  const month = Number(reference.slice(4, 6));
  const day = Number(reference.slice(6, 8));
  const hour = Number(reference.slice(8, 10));
  const minute = Number(reference.slice(10, 12));
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > maxDay
    || hour > 23 || minute > 59) return null;

  return {
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function parseReference(text: string): string | null {
  const match = text.match(/(?:(?:รหัส|เลขที่)อ้างอ.{0,2}ง|reference(?:no|id)?|transactionid)\s*[:#]?\s*([a-z0-9][a-z0-9_-]{3,})/i);
  return match?.[1] ?? null;
}

function parseBank(text: string): string | null {
  return BANK_NAMES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function isMaskedAccountLine(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (/x{2,}[-a-z\d]*\d/i.test(compact)) return true;
  const noisyMask = compact.match(/^[^a-z\d๐-๙]*[0-9๐-๙][0-9๐-๙@%()\-]{6,}-[0-9๐-๙]{1,2}$/i);
  const digitCount = noisyMask?.[0].match(/[0-9๐-๙]/g)?.length ?? 0;
  return !!noisyMask && digitCount >= 7 && (noisyMask[0].match(/-/g)?.length ?? 0) >= 3;
}

function extractMaskedAccount(text: string): string | null {
  return text.match(/[xX]{2,}(?:-[xX\d]+){2,}/)?.[0] ?? null;
}

function isAlignedWithAmountRow(line: OcrTextLine, amountLine: OcrTextLine): boolean {
  const leftEdgeTolerance = Math.max(96, (amountLine.bbox.x1 - amountLine.bbox.x0) * 0.22);
  return Math.abs(line.bbox.x0 - amountLine.bbox.x0) <= leftEdgeTolerance;
}

function isPlausibleRecipientName(text: string): boolean {
  const value = text.trim().replace(/^[\s:：|\-]+|[\s|]+$/g, "");
  if (value.length < 3 || value.length > 80 || /\d/.test(value)) return false;
  if (/จ[ํำ]านวนเงิน|ยอดเงิน|ค่าธรรมเนียม|รหัสอ้างอิง|เลขที่อ้างอิง|ธนาคาร|บัญชี|โอนเงิน|สำเร็จ/i.test(value)) return false;
  return /[\u0E00-\u0E7F]|[a-z]{2}/i.test(value);
}

function extractThaiNameFromNoisyOcrLine(text: string): string | null {
  const runs = text.match(/[\u0E01-\u0E3A\u0E40-\u0E4E]+(?:\s+[\u0E01-\u0E3A\u0E40-\u0E4E]+)+/g) || [];
  const candidates = runs.map((run) => run
    .replace(/^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]+/, "")
    .replace(/^(?:น\s*\.\s*ส\s*\.?|นาย|นางสาว|นาง|ดร\.?)+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim())
    .filter((name) => name.split(" ").filter(Boolean).length >= 2
      && isPlausibleRecipientName(name)
      && !/จะ|ว่า|แจ้ง|จ่าย|โอน|เงิน|ให้|วันนี้|พรุ่งนี้|ครับ|ค่ะ/.test(name)
      && !parseBank(name));
  return candidates.length === 1 ? candidates[0] : null;
}

const RECIPIENT_LABEL = /^[\s➜→›»•●✓|@]*(?:(?:\(\s*\d{1,2}\s*\)|[a-z]\)|[0-9๐-๙]{1,2})\s*[.)]?\s*)?[\s➜→›»•●✓|@]*(?:ไปย[ัา]?ง|ผู[้]?รับ(?:โอน|เงิน)?|ชื่อผู[้]?รับ)\s*[:：\-]?\s*(.*)/i;
const SENDER_LABEL = /^[\s➜→›»•●✓|@]*(?:(?:\(\s*\d{1,2}\s*\)|[0-9๐-๙]{1,2})\s*[.)]?\s*)?[\s➜→›»•●✓|@]*(?:จาก|อาก|ผู้โอน|ผู[้]?ส่ง|ต้นทาง|from|sender)\s*[:：\-]?\s*(.*)/i;
const isPlausiblePersonName = (text: string) => isPlausibleRecipientName(text)
  && !/จะ|ว่า|แจ้ง|จ่าย|โอน|เงิน|ให้|วันนี้|พรุ่งนี้|ครับ|ค่ะ/.test(text);

const isPlausibleMaskedSenderName = (text: string) => {
  const value = text.trim();
  return /^[^\u0E00-\u0E7F]*[\u0E01-\u0E3A\u0E40-\u0E4E]{4,}/u.test(value)
    && /[*＊•●xX]\s*$/u.test(value)
    && !/จะ|ว่า|แจ้ง|จ่าย|โอน|เงิน|ให้|วันนี้|พรุ่งนี้|ครับ|ค่ะ|อ้างอิง|จำนวน|ยอด|บัญชี/u.test(value);
};

export function findSenderName(lines: OcrTextLine[], coordinateScale = 1): { name: string | null; confidence: number } {
  for (let index = 0; index < lines.length; index += 1) {
    const label = lines[index];
    const match = label.text.replace(/^[\s\p{P}\p{S}]+/u, "").match(SENDER_LABEL);
    if (!match) continue;
    const inlineName = match[1].trim().replace(/^[|\-:：\s]+/, "");
    const nameLine = inlineName
      ? { ...label, text: inlineName }
      : lines.slice(index + 1).find((candidate) => {
          const delta = (candidate.bbox.y0 + candidate.bbox.y1 - label.bbox.y0 - label.bbox.y1) / 2;
          return delta > 0 && delta <= 90 * coordinateScale
            && isPlausiblePersonName(candidate.text) && !parseBank(candidate.text)
            && !isMaskedAccountLine(candidate.text);
        });
    if (!nameLine || !isPlausiblePersonName(nameLine.text) || parseBank(nameLine.text)) continue;
    return { name: nameLine.text.trim(), confidence: Math.max(0, Math.min(1, nameLine.confidence / 100)) };
  }
  return { name: null, confidence: 0 };
}

function findKrungthaiRecipientFromAccountBlocks(lines: OcrTextLine[], amountLine: OcrTextLine): RecipientMatch {
  const centerY = (line: OcrTextLine) => (line.bbox.y0 + line.bbox.y1) / 2;
  const rowHeight = Math.max(16, amountLine.bbox.y1 - amountLine.bbox.y0);
  const followsWithin = (above: OcrTextLine, below: OcrTextLine, rows: number) =>
    centerY(below) > centerY(above) && centerY(below) - centerY(above) <= rowHeight * rows;
  const beforeAmount = lines.filter((line) => centerY(line) < centerY(amountLine)).sort((a, b) => centerY(a) - centerY(b));
  const accountLines = beforeAmount.filter((line) => isMaskedAccountLine(line.text));
  if (accountLines.length !== 2) return { name: null, confidence: 0, labelLine: null, nameLine: null };

  const [senderAccount, recipientAccount] = accountLines;
  const senderBank = beforeAmount.filter((line) =>
    centerY(line) < centerY(senderAccount) && parseBank(line.text) === BANK_NAMES[0][1],
  ).at(-1);
  const recipientBanks = beforeAmount.filter((line) =>
    centerY(line) > centerY(senderAccount)
    && centerY(line) < centerY(recipientAccount)
    && !!parseBank(line.text)
    && parseBank(line.text) !== BANK_NAMES[0][1],
  );
  if (!senderBank || recipientBanks.length !== 1) return { name: null, confidence: 0, labelLine: null, nameLine: null };

  const recipientBank = recipientBanks[0];
  if (!followsWithin(senderBank, senderAccount, 5)
    || !followsWithin(recipientBank, recipientAccount, 5)
    || !followsWithin(recipientAccount, amountLine, 8)) {
    return { name: null, confidence: 0, labelLine: null, nameLine: null };
  }
  const recipientNames = beforeAmount.filter((line) =>
    centerY(line) > centerY(senderAccount)
    && centerY(line) < centerY(recipientBank)
    && (line.text.match(/[\u0E00-\u0E7F]+/g) ?? []).filter((word) => word.length >= 3).length >= 2
    && isPlausibleRecipientName(line.text)
    && !parseBank(line.text)
    && followsWithin(line, recipientBank, 5),
  );
  if (recipientNames.length !== 1) {
    return { name: null, confidence: 0, labelLine: null, nameLine: null };
  }

  const nameLine = recipientNames[0];
  return {
    name: nameLine.text.trim(),
    confidence: Math.max(0, Math.min(1, nameLine.confidence / 100)),
    labelLine: null,
    nameLine,
    senderAccountLine: senderAccount,
    receiverAccountLine: recipientAccount,
  };
}

function findQrSenderFromPartyBlocks(
  lines: OcrTextLine[],
  amountLine: OcrTextLine,
  receiverName: string | null,
) {
  const empty = { name: null, confidence: 0, nameLine: null as OcrTextLine | null, accountLine: null as OcrTextLine | null, bankLine: null as OcrTextLine | null };
  if (!receiverName) return empty;

  const centerY = (line: OcrTextLine) => (line.bbox.y0 + line.bbox.y1) / 2;
  const beforeAmount = lines.filter((line) => centerY(line) < centerY(amountLine))
    .sort((left, right) => centerY(left) - centerY(right));
  const transactionCue = beforeAmount.filter((line) =>
    hasSuccessCue(normalizeText(line.text)) || hasReferenceCue(normalizeText(line.text)),
  ).at(-1);
  const accounts = beforeAmount.filter((line) => isMaskedAccountLine(line.text));
  if (!transactionCue || accounts.length !== 2) return empty;

  const [senderAccount, receiverAccount] = accounts;
  const senderBanks = beforeAmount.filter((line) =>
    centerY(line) > centerY(transactionCue)
    && centerY(line) < centerY(senderAccount)
    && !!parseBank(line.text),
  );
  const receiverBanks = beforeAmount.filter((line) =>
    centerY(line) > centerY(senderAccount)
    && centerY(line) < centerY(receiverAccount)
    && !!parseBank(line.text),
  );
  if (senderBanks.length !== 1 || receiverBanks.length !== 1) return empty;

  const bankLine = senderBanks[0];
  const maxNameToBankGap = Math.max(90, (amountLine.bbox.y1 - amountLine.bbox.y0) * 2);
  const names = beforeAmount.filter((line) =>
    centerY(line) > centerY(transactionCue)
    && centerY(line) < centerY(bankLine)
    && centerY(bankLine) - centerY(line) <= maxNameToBankGap
    && ((line.text.trim().split(/\s+/).length >= 2 && isPlausiblePersonName(line.text))
      || isPlausibleMaskedSenderName(line.text))
    && !parseBank(line.text)
    && !isMaskedAccountLine(line.text),
  );
  if (names.length !== 1) return empty;

  const nameLine = names[0];
  return {
    name: nameLine.text.trim(),
    confidence: Math.max(0, Math.min(1, nameLine.confidence / 100)),
    nameLine,
    accountLine: senderAccount,
    bankLine,
  };
}

function findPromptPayRecipientAfterNoisyLabel(lines: OcrTextLine[], amountLine: OcrTextLine): RecipientMatch {
  const empty = { name: null, confidence: 0, labelLine: null, nameLine: null };
  const beforeAmount = lines.filter((line) => line.bbox.y1 <= amountLine.bbox.y1)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const labelIndex = beforeAmount.findIndex((line) => /ไปย[ัา]?ง/.test(normalizeText(line.text)));
  if (labelIndex < 0) return empty;
  const senderBlock = beforeAmount.slice(0, labelIndex);
  if (!senderBlock.some((line) => hasSuccessCue(normalizeText(line.text)))
    || !senderBlock.some((line) => parseBank(line.text) === BANK_NAMES[0][1])
    || !senderBlock.some((line) => isMaskedAccountLine(line.text))) return empty;

  const destination = beforeAmount.slice(labelIndex + 1);
  const promptPayIndex = destination.findIndex((line) => /พร้อมเพย์/.test(normalizeText(line.text)));
  if (promptPayIndex < 0 || promptPayIndex > 3) return empty;
  const names = destination.slice(0, promptPayIndex).filter((line) =>
    isPlausibleRecipientName(line.text)
    && (line.text.match(/[\u0E00-\u0E7F]+/g) ?? []).filter((word) => word.length >= 3).length >= 2,
  );
  if (names.length !== 1 || destination.slice(0, promptPayIndex).length !== 1) return empty;
  const account = destination[promptPayIndex + 1];
  if (!account || !/^(?:[Xx]{3}|[0-9๐-๙]{3})[\s-]+(?:[Xx]{3}|[0-9๐-๙]{3})[\s-]+[0-9๐-๙]{4}$/.test(account.text.trim())) return empty;
  const nameLine = names[0];
  if (amountLine.bbox.y0 - account.bbox.y1 > 120
    || nameLine.bbox.y0 - beforeAmount[labelIndex].bbox.y1 > 90) return empty;
  return {
    name: nameLine.text.trim(),
    confidence: Math.max(0, Math.min(1, nameLine.confidence / 100)),
    labelLine: beforeAmount[labelIndex],
    nameLine,
  };
}

function findRecipientFromTwoPartyBlocks(lines: OcrTextLine[], amountLine: OcrTextLine): RecipientMatch {
  const centerY = (line: OcrTextLine) => (line.bbox.y0 + line.bbox.y1) / 2;
  const rowHeight = Math.max(16, amountLine.bbox.y1 - amountLine.bbox.y0);
  const empty = { name: null, confidence: 0, labelLine: null, nameLine: null };
  const beforeAmount = lines.filter((line) => centerY(line) < centerY(amountLine))
    .sort((left, right) => centerY(left) - centerY(right));
  const successLine = beforeAmount.filter((line) => hasSuccessCue(normalizeText(line.text))).at(-1);
  if (!successLine || centerY(amountLine) - centerY(successLine) > Math.max(300, rowHeight * 24)) return empty;

  const personName = (line: OcrTextLine): string | null => {
    if (parseBank(line.text) || hasPartyCue(normalizeText(line.text)) || hasSuccessCue(normalizeText(line.text))) return null;
    const thai = line.text.match(/[\u0E01-\u0E3A\u0E40-\u0E4E]{3,}(?:\s+[\u0E01-\u0E3A\u0E40-\u0E4E]{3,})+/)?.[0];
    const latin = line.text.match(/[a-z]{2,}(?:\s+[a-z]{2,})+/i)?.[0];
    const name = thai || latin;
    return name && isPlausibleRecipientName(name) ? name : null;
  };
  const parties = beforeAmount.filter((line) => centerY(line) > centerY(successLine) && personName(line));
  if (parties.length !== 2) return empty;
  const [sender, receiver] = parties;
  if (centerY(sender) - centerY(successLine) > Math.max(120, rowHeight * 4)
    || (Math.abs(sender.bbox.x0 - receiver.bbox.x0) > Math.max(40, rowHeight * 3)
      && Math.abs(sender.bbox.x1 - receiver.bbox.x1) > Math.max(40, rowHeight * 3))
    || Math.abs(sender.bbox.x0 - successLine.bbox.x0) > Math.max(60, rowHeight * 4)
    || centerY(receiver) - centerY(sender) > rowHeight * 9) return empty;

  const hasAccountBelow = (nameLine: OcrTextLine, until: OcrTextLine) => beforeAmount.some((line) => {
    if (centerY(line) <= centerY(nameLine) || centerY(line) >= centerY(until)
      || centerY(line) - centerY(nameLine) > rowHeight * 5) return false;
    if (hasReferenceCue(normalizeText(line.text)) || hasAmountLabel(normalizeText(line.text))) return false;
    const accountText = line.text.trim().replace(/\.$/, "");
    const digits = accountText.match(/[0-9๐-๙]/g)?.length ?? 0;
    return isMaskedAccountLine(accountText) || digits >= 7 && !accountText.includes(".");
  });
  if (!hasAccountBelow(sender, receiver) || !hasAccountBelow(receiver, amountLine)) return empty;

  const name = personName(receiver);
  return { name, confidence: Math.max(0, Math.min(1, receiver.confidence / 100)), labelLine: null, nameLine: receiver };
}

function findRecipientMatch(lines: OcrTextLine[], coordinateScale = 1, requireThaiName = false): RecipientMatch {
  for (let index = 0; index < lines.length; index += 1) {
    const labelLine = lines[index];
    const labelText = labelLine.text.replace(/^[\s\p{P}\p{S}]+/u, "");
    const match = labelText.match(RECIPIENT_LABEL);
    if (!match) continue;

    let name = match[1].trim().replace(/^[|\-:：\s]+/, "");
    if (requireThaiName && (name.match(/[\u0E01-\u0E3A\u0E40-\u0E4E]{2,}/g) ?? []).length < 2) name = "";
    let nameLine = labelLine;
    if (!name) {
      const labelCenterY = (labelLine.bbox.y0 + labelLine.bbox.y1) / 2;
      const followingLine = lines.slice(index + 1)
        .filter((line) =>
          (line.bbox.y0 + line.bbox.y1) / 2 > labelCenterY
          && (line.bbox.y0 + line.bbox.y1) / 2 - labelCenterY <= 90 * coordinateScale
          && isPlausibleRecipientName(line.text)
          && (!requireThaiName || (line.text.match(/[\u0E01-\u0E3A\u0E40-\u0E4E]{2,}/g) ?? []).length >= 2)
          && !parseBank(line.text),
        )
        .sort((left, right) => {
          const thaiNameParts = (text: string) =>
            (text.match(/[\u0E01-\u0E3A\u0E40-\u0E4E]{3,}/g) ?? []).length;
          return thaiNameParts(right.text) - thaiNameParts(left.text)
            || right.confidence - left.confidence;
        })[0];
      if (!followingLine) continue;
      name = followingLine.text.trim();
      nameLine = followingLine;
    }
    if (!isPlausibleRecipientName(name)) continue;
    return {
      name,
      confidence: Math.max(0, Math.min(1, nameLine.confidence / 100)),
      labelLine,
      nameLine,
    };
  }
  return { name: null, confidence: 0, labelLine: null, nameLine: null };
}

export function findRecipientName(lines: OcrTextLine[], coordinateScale = 1): { name: string | null; confidence: number } {
  const { name, confidence } = findRecipientMatch(lines, coordinateScale);
  return { name, confidence };
}

export function findSlipOcrRegions(
  lines: OcrTextLine[],
  image: { width: number; height: number },
  options: { includeRecipientSearchBand?: boolean; qrAnchor?: { x: number; y: number }; contourBoundary?: boolean } = {},
): SlipOcrRegion[] {
  const prepared = lines.map((line) => ({ ...line, normalized: normalizeText(line.text) }));
  const amountAnchors = prepared.filter((line) => hasAmountLabel(line.normalized));
  const anchors = options.qrAnchor
    ? [prepared.filter((line) => hasSuccessCue(line.normalized) && line.bbox.y0 < options.qrAnchor!.y)
      .sort((a, b) => Math.abs((a.bbox.y0 + a.bbox.y1) / 2 - options.qrAnchor!.y)
        - Math.abs((b.bbox.y0 + b.bbox.y1) / 2 - options.qrAnchor!.y))[0]
      ?? prepared.filter((line) => hasAmountLabel(line.normalized) || hasReferenceCue(line.normalized))
        .sort((a, b) => Math.abs((a.bbox.y0 + a.bbox.y1) / 2 - options.qrAnchor!.y)
          - Math.abs((b.bbox.y0 + b.bbox.y1) / 2 - options.qrAnchor!.y))[0]].filter(Boolean)
    : amountAnchors.length > 0
    ? amountAnchors
    : prepared.filter((line) => hasSuccessCue(line.normalized));
  const regions: SlipOcrRegion[] = [];

  for (const anchor of anchors) {
    const anchorHorizontalTolerance = Math.max(120, (anchor.bbox.x1 - anchor.bbox.x0) * 1.1);
    const hasNearbyUnanchoredReference = !options.qrAnchor && hasSuccessCue(anchor.normalized)
      && prepared.some((line) => hasReferenceCue(line.normalized)
        && Math.abs(line.bbox.x0 - anchor.bbox.x0) <= anchorHorizontalTolerance
        && Math.abs(line.bbox.y0 - anchor.bbox.y0) <= 700);
    const nearby = prepared.filter((line) => options.qrAnchor
      ? line.bbox.y0 <= image.height
      : hasNearbyUnanchoredReference
        ? Math.abs(line.bbox.x0 - anchor.bbox.x0) <= anchorHorizontalTolerance
          && line.bbox.y1 >= anchor.bbox.y0 - 500
          && line.bbox.y0 <= anchor.bbox.y1 + 700
        : line.bbox.y1 >= anchor.bbox.y0 - 450 && line.bbox.y0 <= anchor.bbox.y1 + 220);
    const joined = nearby.map((line) => line.normalized).join(" ");
    let bankName = parseBank(joined);
    let bankLine = nearby.find((line) => parseBank(line.text));
    const amountLine = options.qrAnchor
      ? nearby.filter((line) => !hasFeeCue(line.normalized)
        && (parseAmount(line.text) !== null || parseStandaloneAmount(line.text) !== null))
        .sort((left, right) => Math.abs((left.bbox.y0 + left.bbox.y1) / 2 - options.qrAnchor!.y)
          - Math.abs((right.bbox.y0 + right.bbox.y1) / 2 - options.qrAnchor!.y))[0]
      : nearby.find((line) => hasAmountLabel(line.normalized) && parseAmount(line.text) !== null)
        ?? (hasSuccessCue(anchor.normalized) && nearby.some((line) => hasReferenceCue(line.normalized))
          ? nearby.filter((line) => !hasFeeCue(line.normalized) && parseStandaloneAmount(line.text) !== null)
            .sort((left, right) => Math.abs((left.bbox.y0 + left.bbox.y1) / 2 - (anchor.bbox.y0 + anchor.bbox.y1) / 2)
              - Math.abs((right.bbox.y0 + right.bbox.y1) / 2 - (anchor.bbox.y0 + anchor.bbox.y1) / 2))[0]
          : undefined);
    let detectedRecipient = findRecipientMatch(nearby, 1, !!options.qrAnchor);
    let fallbackRecipientFocusBounds: SlipOcrRegion["recipientFocusBounds"] = null;
    let fallbackReceiverAccountLine: OcrTextLine | null = null;
    const hasStructuredTransferEvidence = hasSuccessCue(anchor.normalized) && !!amountLine
      && nearby.some((line) => hasReferenceCue(line.normalized));
    if ((options.qrAnchor || hasStructuredTransferEvidence) && !detectedRecipient.name) {
      const accountLines = nearby.filter((line) => isMaskedAccountLine(line.text));
      if (accountLines.length === 2) {
        const senderAccount = accountLines[0];
        const receiverAccount = accountLines[1];
        const senderCenterY = (senderAccount.bbox.y0 + senderAccount.bbox.y1) / 2;
        const receiverCenterY = (receiverAccount.bbox.y0 + receiverAccount.bbox.y1) / 2;
        const possibleNames = nearby.flatMap((line) => {
          const lineCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
          if (lineCenterY <= senderCenterY || lineCenterY >= receiverCenterY
            || receiverCenterY - lineCenterY > 180 || parseBank(line.text)) return [];
          const hasThaiNameTokens = (line.text.match(/[\u0E01-\u0E3A\u0E40-\u0E4E]{2,}/g) ?? []).length >= 2;
          const name = hasThaiNameTokens && isPlausibleRecipientName(line.text)
            ? line.text.trim()
            : extractThaiNameFromNoisyOcrLine(line.text);
          return name ? [{ line, name }] : [];
        });
        if (possibleNames.length === 1) {
          const { line: nameLine, name } = possibleNames[0];
          fallbackReceiverAccountLine = receiverAccount;
          fallbackRecipientFocusBounds = {
            x0: Math.max(0, Math.floor(Math.min(nameLine.bbox.x0, receiverAccount.bbox.x0) - 24)),
            y0: Math.max(0, Math.floor(nameLine.bbox.y0 - 24)),
            x1: Math.min(image.width, Math.ceil(Math.max(nameLine.bbox.x1, receiverAccount.bbox.x1) + 24)),
            y1: Math.min(image.height, Math.ceil(receiverAccount.bbox.y1 + 24)),
          };
          detectedRecipient = {
            name,
            confidence: Math.max(0, Math.min(1, nameLine.confidence / 100)),
            labelLine: null,
            nameLine,
          };
        }
      } else if ((options.qrAnchor || hasStructuredTransferEvidence) && accountLines.length === 1) {
        const account = accountLines[0];
        const accountCenterY = (account.bbox.y0 + account.bbox.y1) / 2;
        const possibleNames = nearby.flatMap((line) => {
          const lineCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
          if (lineCenterY >= accountCenterY || accountCenterY - lineCenterY > 90 || parseBank(line.text)
            || isMaskedAccountLine(line.text) || RECIPIENT_LABEL.test(line.text) || SENDER_LABEL.test(line.text)) return [];
          const name = extractThaiNameFromNoisyOcrLine(line.text);
          return name ? [{ line, name }] : [];
        });
        if (possibleNames.length === 1) {
          const { line: nameLine, name } = possibleNames[0];
          fallbackReceiverAccountLine = account;
          fallbackRecipientFocusBounds = {
            x0: Math.max(0, Math.floor(Math.min(nameLine.bbox.x0, account.bbox.x0) - 24)),
            y0: Math.max(0, Math.floor(nameLine.bbox.y0 - 24)),
            x1: Math.min(image.width, Math.ceil(Math.max(nameLine.bbox.x1, account.bbox.x1) + 24)),
            y1: Math.min(image.height, Math.ceil(account.bbox.y1 + 24)),
          };
          detectedRecipient = {
            name,
            confidence: Math.max(0, Math.min(1, nameLine.confidence / 100)),
            labelLine: null,
            nameLine,
          };
        }
      }
    }
    const labeledRecipient = hasAmountLabel(anchor.normalized)
      && detectedRecipient.nameLine
      && !isAlignedWithAmountRow(detectedRecipient.nameLine, anchor)
      ? { name: null, confidence: 0, labelLine: null, nameLine: null }
      : detectedRecipient;
    let recipient = labeledRecipient;
    let accountBlockMatch: RecipientMatch | null = null;
    if (amountLine && (options.qrAnchor || hasAmountLabel(anchor.normalized))) {
      const krungthai = findKrungthaiRecipientFromAccountBlocks(nearby, amountLine);
      if (krungthai.name) {
        accountBlockMatch = krungthai;
        if (!recipient.name) recipient = krungthai;
      } else if (!recipient.name) {
        const promptPay = findPromptPayRecipientAfterNoisyLabel(nearby, amountLine);
        recipient = promptPay.name ? promptPay : findRecipientFromTwoPartyBlocks(nearby, amountLine);
      }
    }
    let recipientFocusBounds: SlipOcrRegion["recipientFocusBounds"] = fallbackRecipientFocusBounds;
    const focusLines = nearby.filter((line) =>
      hasAmountLabel(line.normalized)
      || hasSuccessCue(line.normalized)
      || hasReferenceCue(line.normalized)
      || hasFeeCue(line.normalized)
      || !!parseBank(line.text),
    );
    if (hasAmountLabel(anchor.normalized)) {
      const possibleRecipientLines = nearby.filter((line) => {
        const centerY = (line.bbox.y0 + line.bbox.y1) / 2;
        return centerY >= anchor.bbox.y0 - 180
          && centerY < anchor.bbox.y0
          && isPlausibleRecipientName(line.text)
          && !parseBank(line.text)
          && isAlignedWithAmountRow(line, anchor);
      }).sort((left, right) =>
        (right.bbox.y0 + right.bbox.y1) / 2 - (left.bbox.y0 + left.bbox.y1) / 2,
      );
      const nameLine = possibleRecipientLines[0];
      if (nameLine) {
        const nameCenterY = (nameLine.bbox.y0 + nameLine.bbox.y1) / 2;
        const precedingLabel = nearby
          .filter((line) => {
            const labelCenterY = (line.bbox.y0 + line.bbox.y1) / 2;
            return line !== nameLine && labelCenterY < nameCenterY && nameCenterY - labelCenterY <= 90;
          })
          .sort((left, right) =>
            (right.bbox.y0 + right.bbox.y1) / 2 - (left.bbox.y0 + left.bbox.y1) / 2,
          )[0];
        if (precedingLabel) {
          recipientFocusBounds = {
            x0: Math.max(0, Math.floor(nameLine.bbox.x0 - 24)),
            y0: Math.max(0, Math.floor(precedingLabel.bbox.y0 - 20)),
            x1: Math.min(image.width, Math.ceil(nameLine.bbox.x1 + 24)),
            y1: Math.min(image.height, Math.ceil(nameLine.bbox.y1 + 20)),
          };
          if (!focusLines.includes(precedingLabel)) focusLines.push(precedingLabel);
        }
        if (!focusLines.includes(nameLine)) focusLines.push(nameLine);
      }

      if (!recipientFocusBounds && options.includeRecipientSearchBand) {
        const horizontalPadding = Math.max(40, (anchor.bbox.x1 - anchor.bbox.x0) * 0.12);
        recipientFocusBounds = {
          x0: Math.max(0, Math.floor(anchor.bbox.x0 - horizontalPadding)),
          y0: Math.max(0, Math.floor(anchor.bbox.y0 - 430)),
          x1: Math.min(image.width, Math.ceil(anchor.bbox.x1 + horizontalPadding)),
          y1: Math.min(image.height, Math.floor(anchor.bbox.y0 - 8)),
        };
      }
    }
    for (const line of [recipient.labelLine, recipient.nameLine]) {
      const preparedLine = line && nearby.find((candidate) => candidate === line);
      if (preparedLine && !focusLines.includes(preparedLine)) focusLines.push(preparedLine);
    }
    const success = nearby.some((line) => hasSuccessCue(line.normalized));
    const referenceCue = nearby.some((line) => hasReferenceCue(line.normalized));
    const feeCue = nearby.some((line) => hasFeeCue(line.normalized));
    const partyCue = nearby.some((line) => hasPartyCue(line.normalized));
    const transactionLines = options.qrAnchor && amountLine
      ? nearby.filter((line) => Math.abs(
          (line.bbox.y0 + line.bbox.y1 - amountLine.bbox.y0 - amountLine.bbox.y1) / 2,
        ) <= 800).sort((left, right) => Math.abs(
          (left.bbox.y0 + left.bbox.y1 - amountLine.bbox.y0 - amountLine.bbox.y1) / 2,
        ) - Math.abs((right.bbox.y0 + right.bbox.y1 - amountLine.bbox.y0 - amountLine.bbox.y1) / 2))
      : nearby;
    const feeLine = amountLine
      ? transactionLines
        .filter((line) => parseFee(line.text) !== null)
        .filter((line) => Math.abs(
          (line.bbox.y0 + line.bbox.y1 - amountLine.bbox.y0 - amountLine.bbox.y1) / 2,
        ) <= Math.max(180, (amountLine.bbox.y1 - amountLine.bbox.y0) * 6))
        .sort((left, right) => Math.abs(
          (left.bbox.y0 + left.bbox.y1 - amountLine.bbox.y0 - amountLine.bbox.y1) / 2,
        ) - Math.abs((right.bbox.y0 + right.bbox.y1 - amountLine.bbox.y0 - amountLine.bbox.y1) / 2))[0]
      : undefined;
    if (options.qrAnchor && amountLine) {
      bankLine = transactionLines.find((line) => parseBank(line.text));
      bankName = bankLine ? parseBank(bankLine.text) : null;
    }
    const standaloneAmountLine = amountLine && !hasAmountLabel(amountLine.normalized)
      ? amountLine
      : undefined;
    const supportedAmount = hasAmountLabel(anchor.normalized) && (success || bankName || referenceCue || feeCue || partyCue)
      || !!standaloneAmountLine && success && (bankName || referenceCue);
    const supportedWithoutAmount = !hasAmountLabel(anchor.normalized)
      && success
      && referenceCue
      && (bankName || (feeCue && amountLine));
    const transactionReferenceCue = transactionLines.some((line) => hasReferenceCue(line.normalized));
    const supportedByQrEvidence = !!options.qrAnchor && !!amountLine && bankName && transactionReferenceCue;
    if (!supportedAmount && !supportedWithoutAmount && !supportedByQrEvidence) continue;

    const parsedDateTime = parseThaiDateTime(transactionLines);
    const referenceLine = transactionLines.find((line) => hasReferenceCue(line.normalized) && parseReference(line.text));
    const referenceNo = referenceLine ? parseReference(referenceLine.text) : null;
    const referenceTimestamp = !parsedDateTime.date
      && (options.qrAnchor || (success && !!amountLine && referenceCue))
      ? parseTimestampFromReference(referenceNo)
      : null;
    const date = parsedDateTime.date ?? referenceTimestamp?.date ?? null;
    const time = parsedDateTime.date
      ? parsedDateTime.time
      : options.qrAnchor ? referenceTimestamp?.time ?? null : null;
    const dateTimeConfidence = parsedDateTime.date
      ? parsedDateTime.confidence
      : referenceTimestamp ? Math.min(0.65, referenceLine ? Math.max(0, referenceLine.confidence / 100) : 0) : 0;
    const timeConfidence = parsedDateTime.date || (options.qrAnchor && referenceTimestamp)
      ? dateTimeConfidence
      : 0;
    const labeledSender = findSenderName(nearby);
    const senderBlockMatch = !labeledSender.name && options.qrAnchor && amountLine
      ? findQrSenderFromPartyBlocks(nearby, amountLine, recipient.name)
      : null;
    const sender = labeledSender.name || !senderBlockMatch?.name ? labeledSender : senderBlockMatch;
    const senderLabelIndex = nearby.findIndex((line) => SENDER_LABEL.test(line.text.replace(/^[\s\p{P}\p{S}]+/u, "")));
    const recipientLabelIndex = nearby.findIndex((line) => RECIPIENT_LABEL.test(line.text.replace(/^[\s\p{P}\p{S}]+/u, "")));
    const partyBoundary = recipientLabelIndex > senderLabelIndex && senderLabelIndex >= 0 ? recipientLabelIndex : nearby.length;
    const senderLines = senderLabelIndex >= 0 ? nearby.slice(senderLabelIndex, partyBoundary) : [];
    const recipientLines = recipientLabelIndex >= 0 ? nearby.slice(recipientLabelIndex + 1) : [];
    const senderNameLineIndex = senderLines.findIndex((line) => {
      const value = line.text.replace(SENDER_LABEL, "$1").trim();
      return isPlausiblePersonName(value) && !parseBank(value);
    });
    const senderNameLine = senderBlockMatch?.nameLine
      ?? (senderNameLineIndex >= 0 ? senderLines[senderNameLineIndex] : null);
    const senderAccountLine = senderLines.find((line) => isMaskedAccountLine(line.text))
      ?? accountBlockMatch?.senderAccountLine
      ?? senderBlockMatch?.accountLine;
    const receiverAccountLine = recipientLines.find((line) => isMaskedAccountLine(line.text))
      ?? accountBlockMatch?.receiverAccountLine
      ?? fallbackReceiverAccountLine;
    const senderBankLine = senderBlockMatch?.bankLine
      ?? (senderNameLine ? senderLines.slice(senderNameLineIndex + 1).find((line) => parseBank(line.text)) : null);
    const receiverBankLine = recipientLines.find((line) => parseBank(line.text));
    if (bankLine && receiverBankLine === bankLine && senderBankLine
      && parseBank(senderBankLine.text) !== bankName) {
      bankName = null;
      bankLine = undefined;
    }
    const regionLines = hasNearbyUnanchoredReference && referenceLine
      ? nearby.filter((line) => Math.abs(line.bbox.x0 - anchor.bbox.x0) <= anchorHorizontalTolerance
        && line.bbox.y1 >= anchor.bbox.y0 - 24
        && line.bbox.y0 <= referenceLine.bbox.y1 + 20)
      : nearby;
    const selectedEvidence = new Map<OcrTextLine, Set<string>>();
    const addEvidence = (line: OcrTextLine | null | undefined, field: string) => {
      if (!line) return;
      const fields = selectedEvidence.get(line) ?? new Set<string>();
      fields.add(field);
      selectedEvidence.set(line, fields);
    };
    addEvidence(anchor, hasSuccessCue(anchor.normalized) ? "status" : "amount");
    addEvidence(amountLine, "amount");
    addEvidence(feeLine, "fee");
    addEvidence(bankLine, "bank");
    addEvidence(referenceLine, "reference");
    addEvidence(recipient.labelLine, "receiver_name");
    addEvidence(recipient.nameLine, "receiver_name");
    addEvidence(senderLabelIndex >= 0 ? nearby[senderLabelIndex] : null, "sender_name");
    addEvidence(recipientLabelIndex >= 0 ? nearby[recipientLabelIndex] : null, "receiver_name");
    addEvidence(senderNameLine, "sender_name");
    addEvidence(senderAccountLine, "sender_account");
    addEvidence(receiverAccountLine, "receiver_account");
    addEvidence(senderBankLine, "sender_bank");
    addEvidence(receiverBankLine, "receiver_bank");
    for (const line of transactionLines) {
      const parsed = parseThaiDateTime([line]);
      if (parsed.date || parsed.time) addEvidence(line, "date_time");
    }
    const evidenceLines = regionLines.filter((line) => selectedEvidence.has(line));
    const recipientContextLine = recipient.nameLine
      ? regionLines.filter((line) => {
          const delta = (recipient.nameLine!.bbox.y0 + recipient.nameLine!.bbox.y1 - line.bbox.y0 - line.bbox.y1) / 2;
          return delta > 0 && delta <= 90;
        }).sort((left, right) =>
          (right.bbox.y0 + right.bbox.y1 - recipient.nameLine!.bbox.y0 - recipient.nameLine!.bbox.y1)
          - (left.bbox.y0 + left.bbox.y1 - recipient.nameLine!.bbox.y0 - recipient.nameLine!.bbox.y1),
        )[0]
      : undefined;
    const rawTextLines = recipientContextLine && !evidenceLines.includes(recipientContextLine)
      ? [...evidenceLines, recipientContextLine].sort((left, right) => left.bbox.y0 - right.bbox.y0)
      : evidenceLines;
    const boundaryLines = options.qrAnchor
      ? evidenceLines.length ? evidenceLines : [anchor]
      : regionLines;
    const x0 = Math.max(0, Math.floor(Math.min(...boundaryLines.map((line) => line.bbox.x0)) - 16));
    const y0 = Math.max(0, Math.floor(Math.min(...boundaryLines.map((line) => line.bbox.y0)) - 16));
    const x1 = Math.min(image.width, Math.ceil(Math.max(...boundaryLines.map((line) => line.bbox.x1)) + 16));
    const y1 = Math.min(image.height, Math.ceil(Math.max(...boundaryLines.map((line) => line.bbox.y1)) + 16));
    const region = { x0, y0, x1, y1 };
    const ocrLineEvidence = prepared.map((line) => {
      const fields = [...(selectedEvidence.get(line) ?? [])];
      const insideBoundary = line.bbox.x0 >= x0 && line.bbox.x1 <= x1
        && line.bbox.y0 >= y0 && line.bbox.y1 <= y1;
      const classification = fields.length ? "slip_evidence" as const
        : insideBoundary || options.contourBoundary ? "uncertain" as const : "chat_context" as const;
      const reason = fields.length
        ? `เชื่อมกับฟิลด์: ${fields.join(", ")}`
        : insideBoundary
          ? "อยู่ในขอบเขต OCR รอบหลักฐาน แต่ยังผูกกับฟิลด์สลิปไม่ได้"
          : options.contourBoundary
            ? "อยู่ใน contour ของวัตถุที่ครอบ QR แต่ยังผูกกับฟิลด์สลิปไม่ได้"
            : options.qrAnchor
              ? "อยู่นอกขอบเขตเชิงความหมายที่อนุมานจาก QR และบรรทัดฟิลด์สลิป"
              : "อยู่นอกขอบเขต OCR ของ candidate นี้";
      return {
        text: line.text,
        confidence: Math.max(0, Math.min(1, line.confidence / 100)),
        bounds: {
          x: line.bbox.x0,
          y: line.bbox.y0,
          width: line.bbox.x1 - line.bbox.x0,
          height: line.bbox.y1 - line.bbox.y0,
        },
        classification,
        reason,
        supportsFields: fields,
      };
    });
    const cropLines = focusLines.length > 0 ? focusLines : [anchor];
    const focusBounds = {
      x0: Math.max(0, Math.floor(Math.min(...cropLines.map((line) => line.bbox.x0)) - 16)),
      y0: Math.max(0, Math.floor(Math.min(...cropLines.map((line) => line.bbox.y0)) - 12)),
      x1: Math.min(image.width, Math.ceil(Math.max(...cropLines.map((line) => line.bbox.x1)) + 16)),
      y1: Math.min(image.height, Math.ceil(Math.max(...cropLines.map((line) => line.bbox.y1)) + 12)),
    };

    if (regions.some((prior) => prior.bounds.y0 <= region.y1 && region.y0 <= prior.bounds.y1)) continue;
    regions.push({
      bounds: region,
      focusBounds,
      recipientFocusBounds,
      amount: amountLine ? parseAmount(amountLine.text) ?? parseStandaloneAmount(amountLine.text) : null,
      amountConfidence: amountLine ? Math.max(0, Math.min(1, amountLine.confidence / 100)) : 0,
      fee: feeLine ? parseFee(feeLine.text) : null,
      feeConfidence: feeLine ? Math.max(0, Math.min(1, feeLine.confidence / 100)) : 0,
      date,
      dateConfidence: dateTimeConfidence,
      dateTimeSource: parsedDateTime.date ? "ocr" : referenceTimestamp ? "reference" : null,
      time,
      timeConfidence: time ? timeConfidence : 0,
      referenceNo,
      referenceConfidence: referenceLine ? Math.max(0, Math.min(1, referenceLine.confidence / 100)) : 0,
      bankName,
      bankConfidence: bankLine && bankName ? Math.max(0, Math.min(1, bankLine.confidence / 100)) : 0,
      receiverName: recipient.name,
      receiverNameConfidence: recipient.confidence,
      receiverNameRetryConflict: false,
      senderName: sender.name,
      senderNameConfidence: sender.confidence,
      senderAccount: senderAccountLine ? extractMaskedAccount(senderAccountLine.text) : null,
      senderAccountConfidence: senderAccountLine && extractMaskedAccount(senderAccountLine.text)
        ? Math.max(0, Math.min(1, senderAccountLine.confidence / 100)) : 0,
      receiverAccount: receiverAccountLine ? extractMaskedAccount(receiverAccountLine.text) : null,
      receiverAccountConfidence: receiverAccountLine && extractMaskedAccount(receiverAccountLine.text)
        ? Math.max(0, Math.min(1, receiverAccountLine.confidence / 100)) : 0,
      senderBankName: senderBankLine ? parseBank(senderBankLine.text) : null,
      receiverBankName: receiverBankLine ? parseBank(receiverBankLine.text) : null,
      rawText: rawTextLines.map((line) => line.text).join("\n"),
      ocrLineEvidence,
    });
  }

  return regions;
}

export function toSlipExtraction(region: SlipOcrRegion): SlipExtraction {
  return applyMissingSlipReviewWarnings({
    document_type: "bank_transfer_slip",
    bank: { name: region.bankName, confidence: region.bankConfidence },
    transaction: {
      date: region.date,
      time: region.time,
      amount: region.amount,
      currency: "THB",
      fee: region.fee,
      reference_no: region.referenceNo,
      transaction_id: region.referenceNo,
      note: null,
    },
    sender: { name: region.senderName, account_no: region.senderAccount, bank: region.senderBankName },
    receiver: { name: region.receiverName, account_no: region.receiverAccount, bank: region.receiverBankName },
    confidence: {
      date: region.dateConfidence,
      time: region.timeConfidence,
      amount: region.amountConfidence,
      reference_no: region.referenceConfidence,
      sender_name: region.senderNameConfidence,
      receiver_name: region.receiverNameConfidence,
      sender_account: region.senderAccountConfidence,
      receiver_account: region.receiverAccountConfidence,
    },
    raw_text: region.rawText.split("\n").filter(Boolean),
    warnings: [
      "ผล OCR ประมวลผลในเครื่องและยังเป็นข้อมูลเสนอ รอตรวจยืนยัน",
      ...(region.receiverNameRetryConflict ? ["OCR ตรวจชื่อผู้รับซ้ำแล้วได้ผลต่างกัน ต้องตรวจจากภาพต้นฉบับ"] : []),
      ...(region.dateTimeSource === "reference" ? ["วันที่ถอดจากรูปแบบ Ref ไม่ใช่ข้อความ OCR โดยตรง ต้องตรวจทาน; เวลาใช้เฉพาะเมื่อมี OCR หรือ QR anchor"] : []),
    ],
  });
}
