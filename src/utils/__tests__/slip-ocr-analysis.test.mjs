import assert from "node:assert/strict";
import test from "node:test";
import { findRecipientName, findSenderName, findSlipOcrRegions, toSlipExtraction } from "../slip-ocr-analysis.ts";
import { SlipExtractionSchema } from "../../schemas/slip.schema.ts";
import { summarizeDetectedSlipRecipients } from "../slip-recipient-summary.ts";

const line = (text, y, confidence = 90) => ({
  text,
  confidence,
  bbox: { x0: 100, y0: y, x1: 500, y1: y + 24 },
});

test("reads sender name only from an explicit sender label, including common Thai OCR error", () => {
  const sender = findSenderName([
    line("๑๐   อาก", 100, 82),
    line("สืบตรีณัฐชัย s * * *", 126, 91),
    line("กรุงไทย", 156, 94),
    line("XXX-X-XX526-6", 184, 90),
    line("ไปยัง", 230, 92),
    line("น.ส. วิณห์นิภา ประสาทเขตรการ", 256, 91),
  ]);

  assert.deepEqual(sender, { name: "สืบตรีณัฐชัย s * * *", confidence: 0.91 });
});

test("does not infer sender name from recipient labels or ordinary conversation text", () => {
  assert.equal(findSenderName([
    line("ไปยัง", 100),
    line("นายสมชาย ใจดี", 126),
    line("ผู้โอนแจ้งว่าจะจ่ายพรุ่งนี้", 160),
  ]).name, null);
});

test("creates a pending slip candidate from grouped transfer-slip OCR lines", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 100),
    line("จาก นายสมชาย", 160),
    line("ไปยัง จิณห์นิภา ประสาทเขตการ", 230),
    line("กรุงไทย", 300),
    line("จำนวนเงิน 2,000.00 บาท", 500),
    line("ค่าธรรมเนียม 0.00 บาท", 560),
    line("รหัสอ้างอิง A8bf6e4dda8fb4300", 620),
  ], { width: 807, height: 1115 });

  assert.equal(candidate.amount, 2000);
  assert.equal(candidate.referenceNo, "A8bf6e4dda8fb4300");
  assert.equal(candidate.bankName, "ธนาคารกรุงไทย");
  assert.equal(candidate.receiverName, "จิณห์นิภา ประสาทเขตการ");
  assert.equal(candidate.receiverNameConfidence, 0.9);
  assert.match(candidate.rawText, /จำนวนเงิน/);
  assert.ok(candidate.bounds.y0 <= 84);
  assert.ok(candidate.bounds.y1 >= 660);
});

test("carries a conflicting focused recipient retry into review warnings", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 100),
    line("จาก นายสมชาย", 160),
    line("ไปยัง จิณห์นิภา ประสาทเขตการ", 230),
    line("กรุงไทย", 300),
    line("จำนวนเงิน 2,000.00 บาท", 500),
    line("ค่าธรรมเนียม 0.00 บาท", 560),
    line("รหัสอ้างอิง A8bf6e4dda8fb4300", 620),
  ], { width: 807, height: 1115 });
  candidate.receiverNameRetryConflict = true;

  assert.ok(toSlipExtraction(candidate).warnings.some((warning) => warning.includes("ชื่อผู้รับซ้ำแล้วได้ผลต่างกัน")));
});

test("extracts sender and receiver name, bank, and masked account from ordered slip blocks", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 20),
    line("๑๐ อาก", 60),
    line("สืบตรีณัฐชัย S * * *", 88, 91),
    line("กรุงไทย", 116),
    line("XXX-X-XX526-6", 144),
    line("ไปยัง", 180),
    line("น.ส. วิณห์นิภา ประสาทเขตรการ", 208, 90),
    line("ทีเอ็มบีธนชาต", 236),
    line("XXX-X-XX996-5", 264),
    line("จำนวนเงิน 5,000.00 บาท", 320),
  ], { width: 807, height: 1115 });

  assert.equal(candidate.senderName, "สืบตรีณัฐชัย S * * *");
  assert.equal(candidate.senderNameConfidence, 0.91);
  assert.equal(candidate.senderBankName, "ธนาคารกรุงไทย");
  assert.equal(candidate.senderAccount, "XXX-X-XX526-6");
  assert.equal(candidate.receiverName, "น.ส. วิณห์นิภา ประสาทเขตรการ");
  assert.equal(candidate.receiverBankName, "ธนาคารทหารไทยธนชาต");
  assert.equal(candidate.receiverAccount, "XXX-X-XX996-5");
});

test("keeps a masked sender OCR line from a uniquely structured two-party slip", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 20),
    line("รหัสอ้างอิง Afe1cd222498c42a5", 52),
    line("สิบตรีณัฐชัยร1”*", 84, 86),
    line("กรุงไทย", 116),
    line("XXX-X-XX526-6", 148),
    line("ไปยัง", 180),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 212),
    line("ทีเอ็มบีธนชาต", 244),
    line("XXX-X-XX996-5", 276),
    line("จำนวนเงิน 5,000.00 บาท", 320),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 190 } });

  assert.equal(candidate.senderName, "สิบตรีณัฐชัยร1”*");
  assert.equal(candidate.senderNameConfidence, 0.86);
  assert.equal(candidate.senderBankName, "ธนาคารกรุงไทย");
  assert.equal(candidate.senderAccount, "XXX-X-XX526-6");
  assert.equal(candidate.bankName, null);
  assert.equal(candidate.receiverBankName, "ธนาคารทหารไทยธนชาต");
  assert.equal(toSlipExtraction(candidate).warnings.some((warning) => warning.includes("ชื่อผู้โอน")), false);
});

test("keeps the masked sender from the real QR-crop OCR layout without a readable success label", () => {
  const [candidate] = findSlipOcrRegions([
    line("รหัสอ้างอิง Afelcd222498c42a5", 823, 70),
    line("รบ ณะ ชะ", 885, 25),
    line("เซไดน", 897, 34),
    line("” สิบตรีณัฐชัยร”*\"**", 1027, 79),
    line("กรุงไทย", 1103, 95),
    line("XXX-X-XX526-6", 1174, 90),
    line("tio EMSS", 1324, 46),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 1364, 91),
    line("ทีเอ็มบีธนชาต", 1437, 94),
    line("XXX-X-XX996-5", 1508, 91),
    line("จำนวนเงิน 5,000.00 บาท", 1618, 92),
  ], { width: 1280, height: 2274 }, { qrAnchor: { x: 1100, y: 859 } });

  assert.equal(candidate.senderName, "” สิบตรีณัฐชัยร”*\"**");
  assert.equal(candidate.senderBankName, "ธนาคารกรุงไทย");
});

test("extracts zero fee and uses account-box confidence instead of party-name confidence", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 20),
    line("จาก", 60, 80),
    line("สืบตรีณัฐชัย ใจดี", 88, 96),
    line("กรุงไทย", 116, 92),
    line("XXX-X-XX526-6", 144, 74),
    line("ไปยัง", 180, 80),
    line("น.ส. วิณห์นิภา ใจดี", 208, 95),
    line("ทีเอ็มบีธนชาต", 236, 91),
    line("XXX-X-XX996-5", 264, 83),
    line("จำนวนเงิน 5,000.00 บาท", 320, 94),
    line("ค่าธรรมเนียม 0.00 บาท", 352, 89),
  ], { width: 807, height: 1115 });

  assert.equal(candidate.amount, 5000);
  assert.equal(candidate.fee, 0);
  assert.equal(candidate.feeConfidence, 0.89);
  assert.equal(candidate.senderAccountConfidence, 0.74);
  assert.equal(candidate.receiverAccountConfidence, 0.83);

  const extraction = toSlipExtraction(candidate);
  assert.equal(extraction.transaction.fee, 0);
  assert.equal(extraction.confidence.sender_account, 0.74);
  assert.equal(extraction.confidence.receiver_account, 0.83);
  assert.equal(SlipExtractionSchema.safeParse(extraction).success, true);
});

test("lists only unread required slip fields for manual review without inventing values", () => {
  const extraction = toSlipExtraction({
    bankName: null,
    bankConfidence: 0,
    amount: 2500,
    amountConfidence: 0.96,
    fee: null,
    feeConfidence: 0,
    date: null,
    dateConfidence: 0,
    time: "14:45",
    timeConfidence: 0.88,
    referenceNo: null,
    referenceConfidence: 0,
    senderName: null,
    senderNameConfidence: 0,
    receiverName: "น.ส. ตัวอย่าง ใจดี",
    receiverNameConfidence: 0.9,
    senderAccount: null,
    senderAccountConfidence: 0,
    receiverAccount: null,
    receiverAccountConfidence: 0,
    senderBankName: null,
    receiverBankName: "ธนาคารตัวอย่าง",
    rawText: "จำนวนเงิน 2,500.00 บาท",
  });

  assert.equal(extraction.transaction.amount, 2500);
  assert.equal(extraction.transaction.date, null);
  assert.equal(extraction.sender.name, null);
  assert.equal(extraction.receiver.name, "น.ส. ตัวอย่าง ใจดี");
  assert.ok(extraction.warnings.some((warning) => /วันที่/u.test(warning)));
  assert.ok(extraction.warnings.some((warning) => /ชื่อผู้โอน/u.test(warning)));
  assert.ok(extraction.warnings.some((warning) => /ธนาคารต้นทาง/u.test(warning)));
  assert.ok(!extraction.warnings.some((warning) => /ยอดเงิน/u.test(warning)));
  assert.ok(!extraction.warnings.some((warning) => /ชื่อผู้รับ/u.test(warning)));
  assert.ok(!extraction.warnings.some((warning) => /ธนาคารปลายทาง/u.test(warning)));
  assert.equal(SlipExtractionSchema.safeParse(extraction).success, true);
});

test("reads a recipient name on the line immediately after an explicit recipient label", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 100),
    line("ไปยัง", 210),
    line("น.ส. จิณห์นิภา ประสาทเขตการ", 242, 86),
    line("ธนาคารกรุงไทย", 300),
    line("จำนวนเงิน 2,000.00 บาท", 500),
  ], { width: 807, height: 1115 });

  assert.equal(candidate.receiverName, "น.ส. จิณห์นิภา ประสาทเขตการ");
  assert.equal(candidate.receiverNameConfidence, 0.86);
});

test("reads a recipient name when OCR omits a Thai tone mark in the recipient label", () => {
  const recipient = findRecipientName([
    line("ไปยง", 100, 72),
    line("น.ส. จินหินิกา ประสาทเขตรการ", 126, 91),
  ]);

  assert.equal(recipient.name, "น.ส. จินหินิกา ประสาทเขตรการ");
});

test("reads a recipient on the next line when OCR adds a copyright-like symbol before the label", () => {
  const recipient = findRecipientName([
    line("© ๑  ไปยัง", 100, 72),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 126, 91),
  ]);

  assert.equal(recipient.name, "น.ส. จิณห์นิภา ประสาทเขตรการ");
  assert.equal(recipient.confidence, 0.91);
});

test("accepts Thai numeric list markers before the recipient label", () => {
  const recipient = findRecipientName([
    line("๑  ไปยัง", 100, 91),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 126, 93),
  ]);

  assert.deepEqual(recipient, { name: "น.ส. จิณห์นิภา ประสาทเขตรการ", confidence: 0.93 });
});

test("keeps the recipient label distance consistent for upscaled OCR crops", () => {
  const recipient = findRecipientName([
    { ...line("ไปยัง", 25, 94), bbox: { x0: 25, y0: 25, x1: 145, y1: 77 } },
    { ...line("น.ส. จิณห์นิภา ประสาทเขตรการ", 117, 93), bbox: { x0: 30, y0: 117, x1: 957, y1: 178 } },
  ], 3);

  assert.equal(recipient.name, "น.ส. จิณห์นิภา ประสาทเขตรการ");
});

test("includes recipient label and name lines in the focused OCR bounds", () => {
  const [candidate] = findSlipOcrRegions([
    line("ไปยัง", 150, 80),
    line("น.ส. จินหินิกา ประสาทเขตรการ", 176, 90),
    line("ธนาคารกรุงไทย", 300),
    line("จำนวนเงิน 2,000.00 บาท", 500),
  ], { width: 807, height: 1115 });

  assert.ok(candidate.focusBounds.y0 <= 138);
  assert.ok(candidate.focusBounds.y1 >= 200);
});

test("keeps a likely recipient row in the retry crop when the first-pass label is unreadable", () => {
  const [candidate] = findSlipOcrRegions([
    line("© ๑ Tudo", 984, 72),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 1018, 93),
    line("กรุงศรี", 1050, 94),
    line("จํานวนเงิน 2,000.00 บาท", 1117, 93),
  ], { width: 807, height: 1400 });

  assert.equal(candidate.receiverName, null);
  assert.ok(candidate.recipientFocusBounds);
  assert.ok(candidate.recipientFocusBounds.y0 <= 964);
  assert.ok(candidate.recipientFocusBounds.y1 >= 1057);
  assert.ok(candidate.recipientFocusBounds.x0 >= 70);
});

test("reads recipient names when OCR prefixes the label with a numbered icon and boxes overlap", () => {
  const lines = [
    line("(8) ไปยัง", 2660, 79),
    { ...line("น.ส. จิณห์นิภา ประสาทเขตรการ", 2688, 93), bbox: { x0: 304, y0: 2688, x1: 533, y1: 2704 } },
    line("กรุงศรี", 2714, 93),
    { ...line("จํานวนเงิน 100.00 บาท", 2769, 91), bbox: { x0: 241, y0: 2769, x1: 641, y1: 2793 } },
  ];
  lines[0].bbox = { x0: 241, y0: 2660, x1: 332, y1: 2708 };

  const [candidate] = findSlipOcrRegions(lines, { width: 642, height: 6218 });

  assert.equal(candidate.receiverName, "น.ส. จิณห์นิภา ประสาทเขตรการ");
  assert.equal(candidate.receiverNameConfidence, 0.93);
});

test("reads recipient names from an enlarged crop when OCR adds decorative symbols before the label", () => {
  const recipient = findRecipientName([
    line("a)     @  ไปยัง", 100, 86),
    { ...line("น.ส. จิณห์นิภา ประสาทเขตรการ", 112, 93), bbox: { x0: 304, y0: 112, x1: 533, y1: 128 } },
    line("กรุงศรี", 140, 93),
  ]);

  assert.deepEqual(recipient, { name: "น.ส. จิณห์นิภา ประสาทเขตรการ", confidence: 0.93 });
});

test("builds the enlarged OCR crop from slip cues instead of nearby chat lines", () => {
  const lines = [
    { text: "ข้อความสนทนาทั่วไป", confidence: 80, bbox: { x0: 4, y0: 120, x1: 180, y1: 144 } },
    { text: "โอนเงินสําเร็จ", confidence: 90, bbox: { x0: 253, y0: 310, x1: 595, y1: 334 } },
    { text: "กรุงศรี", confidence: 94, bbox: { x0: 301, y0: 529, x1: 338, y1: 544 } },
    { text: "จํานวนเงิน 2,000.00 บาท", confidence: 93, bbox: { x0: 243, y0: 583, x1: 598, y1: 617 } },
  ];
  const [candidate] = findSlipOcrRegions(lines, { width: 807, height: 1115 });

  assert.ok(candidate.focusBounds.x0 > 4);
  assert.ok(candidate.focusBounds.y0 <= 310);
  assert.ok(candidate.focusBounds.y1 >= 617);
});

test("does not infer a recipient name from chat text or a sender label", () => {
  const [candidate] = findSlipOcrRegions([
    line("จาก นายสมชาย ใจดี", 100),
    line("แชทบอกว่าโอนให้คุณจิณห์นิภา", 150),
    line("ธนาคารกรุงไทย", 220),
    line("จำนวนเงิน 2,000.00 บาท", 300),
  ], { width: 807, height: 1115 });

  assert.equal(candidate.receiverName, null);
});

test("ignores recipient-like wording embedded in a chat sentence", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 100),
    line("แชทบอกว่าไปยัง จิณห์นิภา ประสาทเขตการ", 180),
    line("ธนาคารกรุงไทย", 260),
    line("จำนวนเงิน 2,000.00 บาท", 420),
  ], { width: 807, height: 1115 });

  assert.equal(candidate.receiverName, null);
});

test("does not treat a separate chat row misaligned with the slip amount as the recipient", () => {
  const [candidate] = findSlipOcrRegions([
    { ...line("ไปยัง", 180), bbox: { x0: 0, y0: 180, x1: 190, y1: 204 } },
    { ...line("นายสมชาย ใจดี", 210), bbox: { x0: 0, y0: 210, x1: 190, y1: 234 } },
    line("ธนาคารกรุงไทย", 260),
    line("จำนวนเงิน 2,000.00 บาท", 420),
  ], { width: 807, height: 1115 });

  assert.equal(candidate.receiverName, null);
  assert.equal(candidate.recipientFocusBounds, null);
});

test("keeps a label-linked recipient name when its text box is not aligned with the amount row", () => {
  const [candidate] = findSlipOcrRegions([
    { text: "โอนเงินสำเร็จ", confidence: 94, bbox: { x0: 210, y0: 100, x1: 390, y1: 124 } },
    { text: "ไปยัง", confidence: 92, bbox: { x0: 215, y0: 210, x1: 270, y1: 234 } },
    { text: "น.ส. จิณห์นิภา ประสาทเขตการ", confidence: 93, bbox: { x0: 215, y0: 240, x1: 455, y1: 264 } },
    { text: "กรุงไทย", confidence: 90, bbox: { x0: 215, y0: 295, x1: 310, y1: 319 } },
    { text: "จำนวนเงิน 2,000.00 บาท", confidence: 92, bbox: { x0: 230, y0: 500, x1: 630, y1: 524 } },
  ], { width: 807, height: 1115 });

  assert.equal(candidate.receiverName, "น.ส. จิณห์นิภา ประสาทเขตการ");
});

test("does not promote ordinary chat text mentioning a transfer to a slip candidate", () => {
  assert.deepEqual(findSlipOcrRegions([
    line("โอนเงินไปให้ 2,000 บาทนะ", 300),
    line("กรุงศรีถูกไหม", 350),
  ], { width: 807, height: 1115 }), []);
});

test("can retain a transfer proof candidate when OCR misses its amount", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 120),
    line("ธนาคารกรุงไทย", 200),
    line("รหัสอ้างอิง A8bf6e4dda8fb4300", 260),
  ], { width: 807, height: 1115 });

  assert.equal(candidate.amount, null);
  assert.equal(candidate.referenceNo, "A8bf6e4dda8fb4300");
});

test("creates a review candidate from embedded-slip OCR with border noise and no QR or bank name", () => {
  const ocr = [
    { text: "| โอนเงินสําเร็จ |", confidence: 92, bbox: { x0: 417, y0: 186, x1: 767, y1: 215 } },
    { text: "| 170.8. 68, 15:51u. |", confidence: 62, bbox: { x0: 417, y0: 207, x1: 767, y1: 235 } },
    { text: "| 7200.00 |", confidence: 73, bbox: { x0: 417, y0: 233, x1: 767, y1: 265 } },
    { text: "| ค่าธรรมเนียม 0.00 |", confidence: 92, bbox: { x0: 417, y0: 278, x1: 767, y1: 304 } },
    { text: "tp จิณห์นิภา ประสาทเขตรการ |", confidence: 82, bbox: { x0: 417, y0: 404, x1: 767, y1: 430 } },
    { text: "| รหัสอ้างอิง: 202506171502627774 |", confidence: 83, bbox: { x0: 428, y0: 506, x1: 767, y1: 545 } },
  ];

  const [candidate] = findSlipOcrRegions(ocr, { width: 807, height: 848 });
  assert.ok(candidate);
  assert.equal(candidate.amount, 7200);
  assert.equal(candidate.referenceNo, "202506171502627774");
  assert.equal(candidate.bankName, null);
  assert.equal(candidate.date, "2025-06-17");
  assert.equal(candidate.time, null);
  assert.equal(candidate.dateConfidence, 0.65);
  assert.equal(candidate.dateTimeSource, "reference");
  const extraction = toSlipExtraction(candidate);
  assert.ok(extraction.warnings.some((warning) => warning.includes("Ref")));
  assert.equal(extraction.confidence.time, 0);
});

test("extracts a QR-anchored slip with standalone amount and Thai date/time", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเร็จ", 599, 94),
    line("16 ส.ค. 68, 19:18 น.", 656, 93),
    line("10,000.00", 721, 91),
    line("ค่าธรรมเนียม 0.00", 799, 94),
    line("นาย ณัฐชัย รักษาวงษ์", 877, 94),
    line("XXX-X-XX558-9", 928, 89),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 1076, 93),
    line("XXX-X-XX996-5", 1130, 89),
    line("ttb", 1175, 88),
    line("รหัสอ้างอิง: 202508161903564508", 1264, 93),
  ], { width: 1687, height: 2666 }, { qrAnchor: { x: 1500, y: 2100 } });

  assert.ok(candidate);
  assert.equal(candidate.amount, 10000);
  assert.equal(candidate.referenceNo, "202508161903564508");
  assert.equal(candidate.bankName, "ธนาคารทหารไทยธนชาต");
  assert.equal(candidate.date, "2025-08-16");
  assert.equal(candidate.time, "19:18");
  assert.equal(candidate.receiverName, "น.ส. จิณห์นิภา ประสาทเขตรการ");
});

test("separates slip evidence lines from surrounding chat OCR and retains line provenance", () => {
  const [candidate] = findSlipOcrRegions([
    line("คุยกันเรื่องเงิน 7,200 บาท", 80, 96),
    line("โอนเงินสำเร็จ", 180, 94),
    line("รหัสอ้างอิง A82bde77a7ade414c", 220, 93),
    line("จาก สินธรณัฐชัย S***", 280, 92),
    line("กรุงไทย", 315, 92),
    line("XXX-X-XX526-6", 350, 90),
    line("ไปยัง น.ส. จิณห์นิภา ประสาทเขตรการ", 390, 94),
    line("ทีเอ็มบีธนชาต", 425, 92),
    line("XXX-X-XX996-5", 460, 90),
    line("จำนวนเงิน 3,000.00 บาท", 520, 96),
    line("ถามมาแล้ว 14:09", 1050, 91),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 700, y: 500 } });

  assert.equal(candidate.amount, 3000);
  assert.ok(candidate.rawText.includes("จำนวนเงิน 3,000.00 บาท"));
  assert.ok(!candidate.rawText.includes("7,200"));
  assert.ok(candidate.ocrLineEvidence.some((entry) => entry.text.includes("7,200")
    && entry.classification === "chat_context" && entry.reason));
  assert.ok(candidate.ocrLineEvidence.some((entry) => entry.text.includes("3,000")
    && entry.classification === "slip_evidence" && entry.supportsFields.includes("amount")));
  assert.ok(candidate.ocrLineEvidence.every((entry) => entry.bounds && entry.confidence >= 0));
});

test("rejects impossible calendar dates but accepts a valid Buddhist leap day", () => {
  const makeCandidate = (dateLine) => findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 100),
    line(dateLine, 140),
    line("5,000.00 บาท", 180),
    line("รหัสอ้างอิง A8bf6e4dda8fb4300", 220),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 200 } })[0];

  assert.equal(makeCandidate("31 มิ.ย. 2568, 14:15 น.").date, null);
  assert.equal(makeCandidate("29 ก.พ. 2567, 14:15 น.").date, "2024-02-29");
});

test("uses a validated timestamp-shaped reference only as a low-confidence date fallback", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 100),
    line("ธนาคารกรุงไทย", 140),
    line("รหัสอ้างอิง: 202506091445", 180),
    line("จำนวนเงิน 5,000.00 บาท", 220),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 200 } });

  assert.equal(candidate.date, "2025-06-09");
  assert.equal(candidate.time, "14:45");
  assert.equal(candidate.dateConfidence, 0.65);
  assert.equal(candidate.dateTimeSource, "reference");
  const extraction = toSlipExtraction(candidate);
  assert.ok(extraction.warnings.some((warning) => warning.includes("วันที่ถอดจากรูปแบบ Ref")));
  assert.equal(extraction.confidence.date, 0.65);
});

test("does not derive a date from an invalid timestamp-shaped reference", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 100),
    line("ธนาคารกรุงไทย", 140),
    line("รหัสอ้างอิง: 202506311445123456", 180),
    line("จำนวนเงิน 5,000.00 บาท", 220),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 200 } });

  assert.equal(candidate.date, null);
  assert.equal(candidate.time, null);
  assert.equal(candidate.dateTimeSource, null);
});

test("does not derive an embedded-slip date from a Ref without an independent success cue", () => {
  const [candidate] = findSlipOcrRegions([
    line("จำนวนเงิน 5,000.00 บาท", 100),
    line("รหัสอ้างอิง: 202506171502627774", 140),
  ], { width: 807, height: 1115 });

  assert.ok(candidate);
  assert.equal(candidate.date, null);
  assert.equal(candidate.time, null);
  assert.equal(candidate.dateTimeSource, null);
});

test("uses recipient account blocks when OCR misses the recipient label and sender name", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเร็จ", 100),
    line("รหัสอ้างอิง Afeted222498c42a5", 160),
    line("สินธนกิจบัญชี S***", 220),
    line("กรุงไทย", 270),
    line("XXX-X-X526-6", 320),
    line("ขะ๒ NSS", 370),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 420),
    line("ทีเอ็มบีธนชาต", 480),
    line("XXX-X-XX996-5", 550),
    line("จํานวนเงิน 5,000.00 บาท", 720),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 120 } });

  assert.equal(candidate.receiverName, "น.ส. จิณห์นิภา ประสาทเขตรการ");
  assert.equal(candidate.senderAccount, "XXX-X-X526-6");
  assert.equal(candidate.receiverAccount, "XXX-X-XX996-5");
});

test("recovers a Thai recipient name when unanchored OCR recognizes only one party account", () => {
  const rawRecipientLine = "tp !4ีจัณห์นิภา ประสาทเขตรการ";
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเร็จ", 186),
    line("202506171502627774", 506),
    line("จาก ณัฐชัย จักษาวงษ์", 305),
    line(rawRecipientLine, 404),
    line("|    XXX-X-XX996-5              t", 423),
    line("7,200.00", 233),
    line("รหัสอ้างอิง: 202506171502627774", 506),
    line("คุยเรื่องอื่น ไม่ใช่รายการโอน 7,200 บาท", 700),
  ], { width: 807, height: 1115 });

  assert.ok(candidate);
  assert.equal(candidate.receiverName, "จัณห์นิภา ประสาทเขตรการ");
  assert.ok(candidate.rawText.includes(rawRecipientLine));
  assert.ok(!candidate.rawText.includes("คุยเรื่องอื่น"));
  assert.ok(candidate.ocrLineEvidence.some((entry) => entry.text.includes("คุยเรื่องอื่น")
    && entry.classification === "chat_context"));
  assert.ok(candidate.receiverNameConfidence > 0);
  assert.ok(toSlipExtraction(candidate).warnings.some((warning) => warning.includes("รอตรวจ")));
  assert.equal(candidate.receiverAccount, "XXX-X-XX996-5");
  assert.ok(candidate.recipientFocusBounds.y0 <= 404);
  assert.ok(candidate.recipientFocusBounds.y1 >= 447);
});

test("returns both masked accounts when a QR-anchored slip has party names but no recipient label", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 100),
    line("รหัสอ้างอิง A82bde77a7ade414c", 145),
    line("จาก", 195),
    line("สินธรณัฐชัย s***", 225),
    line("กรุงไทย", 260),
    line("XXX-X-XX526-6", 295),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 330),
    line("ทีเอ็มบีธนชาต", 365),
    line("XXX-X-XX996-5", 400),
    line("จำนวนเงิน 3,000.00 บาท", 470),
    line("วันที่ทำรายการ 09 มิ.ย. 2568 - 14:15", 515),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 700, y: 350 } });

  assert.ok(candidate);
  assert.equal(candidate.senderName, "สินธรณัฐชัย s***");
  assert.equal(candidate.senderAccount, "XXX-X-XX526-6");
  assert.equal(candidate.receiverName, "น.ส. จิณห์นิภา ประสาทเขตรการ");
  assert.equal(candidate.receiverAccount, "XXX-X-XX996-5");
  assert.equal(candidate.date, "2025-06-09");
  assert.equal(candidate.time, "14:15");
});

test("recovers the sender from ordered party blocks when the QR slip sender label is unreadable", () => {
  const [candidate] = findSlipOcrRegions([
    line("รหัสอ้างอิง A82bde77a7ade414c", 160),
    line("อ๑อ:", 220),
    line("สิบตรีณัฐชัย s***", 250),
    line("กรุงไทย", 280),
    line("XXX-X-XX526-6", 310),
    line("ไปยัง", 345),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 375),
    line("ทีเอ็มบีธนชาต", 405),
    line("XXX-X-XX996-5", 435),
    line("จํานวนเงิน 3,000.00 บาท", 500),
    line("วันที่ทํารายการ 20 มิ.ย. 2568 - 14:15", 540),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 700, y: 350 } });

  assert.ok(candidate);
  assert.equal(candidate.senderName, "สิบตรีณัฐชัย s***");
  assert.equal(candidate.senderAccount, "XXX-X-XX526-6");
  assert.equal(candidate.receiverName, "น.ส. จิณห์นิภา ประสาทเขตรการ");
  assert.equal(candidate.receiverAccount, "XXX-X-XX996-5");
});

test("does not infer a QR-slip sender when party blocks contain competing name lines", () => {
  const [candidate] = findSlipOcrRegions([
    line("รหัสอ้างอิง A82bde77a7ade414c", 160),
    line("อ๑อ:", 220),
    line("สมชาย ใจดี", 240),
    line("สิบตรีณัฐชัย s***", 260),
    line("กรุงไทย", 280),
    line("XXX-X-XX526-6", 310),
    line("ไปยัง", 345),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 375),
    line("ทีเอ็มบีธนชาต", 405),
    line("XXX-X-XX996-5", 435),
    line("จํานวนเงิน 3,000.00 บาท", 500),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 700, y: 350 } });

  assert.ok(candidate);
  assert.equal(candidate.senderName, null);
});

test("does not treat a fee row as the transfer amount in QR-anchored OCR", () => {
  assert.deepEqual(findSlipOcrRegions([
    line("โอนเงินสําเร็จ", 100),
    line("ค่าธรรมเนียม 25.00", 180),
    line("รหัสอ้างอิง: 12345678", 250),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 800 } }), []);
});

test("pairs a QR slip only with its nearest fee row when other transaction text is nearby", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 100),
    line("รหัสอ้างอิง: 12345678", 160),
    line("ttb", 220),
    line("จำนวนเงิน 5,000.00 บาท", 320),
    line("ค่าธรรมเนียม 25.00 บาท", 500),
    line("ค่าธรรมเนียม 0.00 บาท", 352),
  ], { width: 807, height: 1600 }, { qrAnchor: { x: 400, y: 300 } });

  assert.ok(candidate);
  assert.equal(candidate.amount, 5000);
  assert.equal(candidate.fee, 0);
});

test("keeps slip fields below a QR code near the top of the slip crop", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสำเร็จ", 300),
    line("รหัสอ้างอิง Ad376c9bab2034e41", 360),
    line("จาก นายตัวอย่าง", 430),
    line("XXX-X-XX526-6", 500),
    line("ไปยัง", 600),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 630),
    line("XXX-X-XX996-5", 680),
    line("ttb", 720),
    line("จำนวนเงิน 26,400.00 บาท", 900),
    line("วันที่ทำรายการ 31 พ.ค. 2568 - 20:04", 980),
  ], { width: 1687, height: 2666 }, { qrAnchor: { x: 1450, y: 350 } });

  assert.ok(candidate);
  assert.equal(candidate.amount, 26400);
  assert.equal(candidate.referenceNo, "Ad376c9bab2034e41");
  assert.equal(candidate.date, "2025-05-31");
  assert.equal(candidate.time, "20:04");
  assert.equal(candidate.receiverName, "น.ส. จิณห์นิภา ประสาทเขตรการ");
});

test("does not classify Latin OCR noise as the recipient in a QR-anchored slip", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเร็จ", 100),
    line("XXX-X-XX100-1", 160),
    line("tio        NSS", 210),
    line("XXX-X-XX200-2", 250),
    line("ttb", 300),
    line("รหัสอ้างอิง: 12345678", 350),
    line("10,000.00", 420),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 500 } });

  assert.ok(candidate);
  assert.equal(candidate.receiverName, null);
});

test("extracts a QR-anchored slip when OCR misspells the amount and success cues", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเร็ง", 100),
    line("กรุงไทย", 180),
    line("รหัสอ้างอิง Ad376c9bab2034e41", 260),
    line("ขํานวนเงิน 26,400.00 บาท", 420),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 500 } });

  assert.ok(candidate);
  assert.equal(candidate.amount, 26400);
  assert.equal(candidate.referenceNo, "Ad376c9bab2034e41");
  assert.equal(candidate.bankName, "ธนาคารกรุงไทย");
});

test("extracts a labeled amount when OCR drops Thai vowels and misreads the currency unit", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเรจ", 100),
    line("กรุงไทย", 180),
    line("รหัสอ้างอิง Afelcd222498c42a5", 260),
    line("ขํานวนเงน 5,000.00 un", 420),
    line("ค่าธรรมเนียม 0.00 บาท", 500),
    line("วันที่ทํารายการ 09 มิ.ย. 2568 - 14:45", 580),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 500 } });

  assert.ok(candidate);
  assert.equal(candidate.amount, 5000);
  assert.equal(candidate.referenceNo, "Afelcd222498c42a5");
  assert.equal(candidate.bankName, "ธนาคารกรุงไทย");
  assert.equal(candidate.date, "2025-06-09");
  assert.equal(candidate.time, "14:45");
});

test("normalizes OCR period grouping in a labeled slip amount without changing its value", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเร็จ", 100),
    line("กรุงไทย", 180),
    line("รหัสอ้างอิง N006727673034053896171486", 260),
    line("จํานวนเงิน 1.000.00 บาท", 420),
    line("ค่าธรรมเนียม 0.00 บาท", 500),
    line("วันที่ทํารายการ 12 มี.ค. 2568 - 20:17", 580),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 500 } });

  assert.ok(candidate);
  assert.equal(candidate.amount, 1000);
});

test("reads a long reference when OCR confuses one Thai glyph in its label", () => {
  const [candidate] = findSlipOcrRegions([
    line("©อนเงินสําเร็จเต2 รหัสอ้างอฮิง Afelcd222498c42a5 กรุงไทย จํานวนเงิน 5,000.00 บาท", 100, 91),
  ], { width: 807, height: 1115 });

  assert.ok(candidate);
  assert.equal(candidate.amount, 5000);
  assert.equal(candidate.referenceNo, "Afelcd222498c42a5");
  assert.equal(candidate.bankName, "ธนาคารกรุงไทย");
});

test("does not accept a garbled sender account as an account number", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเร็จ", 100),
    line("รหัสอ้างอฮิง Afelcd222498c42a5", 130),
    line("๑๐๑ สิบตรีณัฐชัยรา**", 180),
    line("อาก", 210),
    line("กรุงไทย", 240),
    line("ม(0(- ( -%(%526-6", 270),
    line("ไปยัง", 310),
    line("น.ส. จิณห์นิภา ประสาทเขตรการ", 340),
    line("ttb", 365),
    line("XXX-X-XX996-5", 390),
    line("จํานวนเงิน 5,000.00 บาท", 500),
    line("วันที่ทํารายการ 09 บิ.ย. 2568 - 14:45", 550),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 210 } });

  assert.ok(candidate);
  assert.equal(candidate.receiverAccount, "XXX-X-XX996-5");
  assert.equal(candidate.senderAccount, null);
});

test("reads the June date when OCR mistakes มิ.ย. for บิ.ย.", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเร็จ", 100),
    line("รหัสอ้างอฮิง Afelcd222498c42a5", 130),
    line("กรุงไทย", 240),
    line("จํานวนเงิน 5,000.00 บาท", 500),
    line("วันที่ทํารายการ 09 บิ.ย. 2568 - 14:45", 550),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 210 } });

  assert.ok(candidate);
  assert.equal(candidate.date, "2025-06-09");
  assert.equal(candidate.time, "14:45");
});

test("does not pair date, bank, or reference from a distant transaction with the QR slip amount", () => {
  const [candidate] = findSlipOcrRegions([
    line("โอนเงินสําเร็จ", 100),
    line("กรุงไทย", 180),
    line("รหัสอ้างอิง: 12345678", 240),
    line("10,000.00", 320),
    line("ไทยพาณิชย์", 1800),
    line("รหัสอ้างอิง: 87654321", 1880),
    line("วันที่ทำรายการ 31 พ.ค. 2568 - 20:04", 1940),
  ], { width: 807, height: 2200 }, { qrAnchor: { x: 400, y: 500 } });

  assert.ok(candidate);
  assert.equal(candidate.amount, 10000);
  assert.equal(candidate.bankName, "ธนาคารกรุงไทย");
  assert.equal(candidate.referenceNo, "12345678");
  assert.equal(candidate.date, null);
});

test("selects the amount nearest the QR anchor when a crop contains multiple transfers", () => {
  const [candidate] = findSlipOcrRegions([
    line("กรุงไทย", 100),
    line("รหัสอ้างอิง: 11112222", 160),
    line("2,000.00", 220),
    line("SCB", 700),
    line("รหัสอ้างอิง: 33334444", 760),
    line("5,000.00", 820),
  ], { width: 807, height: 1115 }, { qrAnchor: { x: 400, y: 800 } });

  assert.ok(candidate);
  assert.equal(candidate.amount, 5000);
  assert.equal(candidate.referenceNo, "33334444");
  assert.equal(candidate.bankName, "ธนาคารไทยพาณิชย์");
});

test("OCR crop names with repeated prefixes group together while every source page remains", () => {
  const recipientNames = [
    "น.ส. คุณ จินหินิกา ประสาทเขตรการ",
    "คุณ  จินหินิกา ประสาทเขตรการ",
    "จินหินิกา   ประสาทเขตรการ",
  ];
  const lines = recipientNames.flatMap((name, index) => {
    const top = index * 900 + 100;
    const amount = ["จำนวนเงิน 2,000.00 บาท", "จำนวนเงิน 4,000.00 บาท", "จำนวนเงิน 2,000.00 บาท"][index];
    return [["ไปยัง", top], [name, top + 26], ["ธนาคารกรุงไทย", top + 80], [amount, top + 200]];
  }).map(([text, y]) => line(text, y));
  const candidates = findSlipOcrRegions(lines, { width: 807, height: 2500 });
  const pageReferences = [
    { chatPage: "1 / 116", dossierPage: 4 },
    { chatPage: "37 / 116", dossierPage: 40 },
    { chatPage: "112 / 116", dossierPage: 115 },
  ];
  const summary = summarizeDetectedSlipRecipients(candidates.map((candidate, index) => ({
    id: `slip-${index + 1}`,
    isConfirmed: false,
    chatPage: pageReferences[index].chatPage,
    dossierPage: pageReferences[index].dossierPage,
    source: "reference-chat.jpg",
    crop: `crop-${index + 1}`,
    data: { receiver: { name: candidate.receiverName }, transaction: { amount: candidate.amount } },
  })));

  assert.deepEqual(candidates.map((candidate) => candidate.amount), [2000, 4000, 2000]);
  assert.deepEqual(candidates.map((candidate) => candidate.receiverName), recipientNames);
  assert.equal(summary.detectedSlipCount, 3);
  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].totalAmount, 8000);
  assert.deepEqual(summary.groups[0].records.map(({ chatPage, dossierPage }) => ({ chatPage, dossierPage })), pageReferences);
});
