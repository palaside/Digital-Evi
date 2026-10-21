import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDetectedSlipRecipients } from "../slip-recipient-summary.ts";

const record = (id, name, amount, overrides = {}) => ({
  id,
  sourceItemId: `source-${id}`,
  sha256: "hash",
  isDuplicate: false,
  isConfirmed: false,
  chatPage: "2 / 4",
  dossierPage: 6,
  source: `${id}.jpg`,
  bounds: { x: 10, y: 20, width: 30, height: 40 },
  crop: `data:${id}`,
  needsReview: false,
  data: {
    receiver: { name },
    transaction: { amount, reference_no: null },
  },
  ...overrides,
});

test("groups only exact names after title and whitespace normalization", () => {
  const summary = summarizeDetectedSlipRecipients([
    record("a", "นาย สมชาย  ใจดี", 100),
    record("b", "สมชาย ใจดี", 200, { isConfirmed: true }),
    record("c", "สมชาย ใจดีมาก", 300),
  ]);

  assert.equal(summary.groups.length, 2);
  assert.equal(summary.groups[0].totalAmount, 300);
  assert.equal(summary.groups[0].records.length, 2);
  assert.equal(summary.groups[1].records[0].id, "c");
  assert.equal(summary.detectedSlipCount, 3);
});

test("strips repeated title prefixes before grouping OCR names and summing amounts", () => {
  const summary = summarizeDetectedSlipRecipients([
    record("nested-prefix", "น.ส. คุณ  จิณห์นิภา ประสาทเขตรการ", 2000, {
      chatPage: "1 / 3",
      dossierPage: 4,
    }),
    record("plain-name", "จิณห์นิภา   ประสาทเขตรการ", 50, {
      chatPage: "2 / 3",
      dossierPage: 5,
    }),
  ]);

  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].name, "จิณห์นิภา ประสาทเขตรการ");
  assert.equal(summary.groups[0].totalAmount, 2050);
  assert.deepEqual(summary.groups[0].records.map(({ chatPage, dossierPage }) => ({ chatPage, dossierPage })), [
    { chatPage: "1 / 3", dossierPage: 4 },
    { chatPage: "2 / 3", dossierPage: 5 },
  ]);
});

test("does not erase parenthetical name content or correct OCR spelling when grouping", () => {
  const summary = summarizeDetectedSlipRecipients([
    record("a", "สมชาย ใจดี (พิเศษ)", 10),
    record("b", "สมชาย ใจดี", 20),
    record("c", "ประสาทหิรัญการ", 30),
    record("d", "ประสาทเขตการ", 40),
  ]);

  assert.equal(summary.groups.length, 4);
});

test("keeps incomplete recipient or amount records visible without inventing totals", () => {
  const summary = summarizeDetectedSlipRecipients([
    record("known-name", "น.ส. มาลี แสงทอง", 100),
    record("missing-amount", "มาลี แสงทอง", null),
    record("missing-name", null, 500, {
      bounds: { x: 400, y: 500, width: 60, height: 80 },
    }),
  ]);

  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].totalAmount, 100);
  assert.equal(summary.groups[0].records.length, 2);
  assert.deepEqual(summary.groups[0].records[1].missingFields, ["จำนวนเงิน"]);
  assert.equal(summary.unassignedRecords.length, 1);
  assert.deepEqual(summary.unassignedRecords[0].missingFields, ["ชื่อผู้รับ"]);
  assert.equal(summary.detectedSlipCount, 3);
});

test("withholds a recipient name from person totals when focused OCR retries conflict", () => {
  const summary = summarizeDetectedSlipRecipients([
    record("conflicted-name", "จิณห์นิภา บุญประเสรีชฐ", 1000, {
      data: {
        receiver: { name: "จิณห์นิภา บุญประเสรีชฐ", account_no: "XXX-X-XX764-0" },
        transaction: { amount: 1000 },
        confidence: { receiver_name: 0.87 },
        warnings: ["OCR ตรวจชื่อผู้รับซ้ำแล้วได้ผลต่างกัน ต้องตรวจจากภาพต้นฉบับ"],
      },
    }),
  ]);

  assert.equal(summary.groups.length, 0);
  assert.equal(summary.unassignedRecords.length, 1);
  assert.equal(summary.unassignedRecords[0].receiverNameNeedsReview, true);
  assert.deepEqual(summary.unassignedRecords[0].missingFields, ["ชื่อผู้รับ"]);
  assert.equal(summary.unassignedRecords[0].amount, 1000);
});

test("keeps a slip-supported recipient candidate visible when crop and page OCR agree despite a weaker retry", () => {
  const name = "น.ส. จิณห์นิภา ประสาทเขตรการ";
  const line = { id: "recipient", text: name, confidence: 94, bounds: { x: 382, y: 558, width: 288, height: 18 } };
  const candidate = record("chatv3-77", name, 3000, {
      bounds: { x: 300, y: 300, width: 450, height: 470 },
      ocrTextBoxes: [{
        text: name, confidence: 0.94, bounds: line.bounds,
        classification: "slip_evidence", supportsFields: ["receiver_name"],
      }],
      ocrDiagnosticTrace: {
        attempts: [
          { scope: "qr_crop", trigger: "initial", lines: [line] },
          { scope: "full_page", trigger: "initial", lines: [line] },
          { scope: "recipient_retry", trigger: "recipient_missing", lines: [{ ...line, text: "น.ส. จิณห์นพิภา ประสาทเขตรการ", confidence: 92 }] },
        ],
      },
      data: {
        receiver: { name, account_no: "XXX-X-XX996-5" },
        transaction: { amount: 3000 },
        confidence: { receiver_name: 0.94 },
        warnings: ["OCR ตรวจชื่อผู้รับซ้ำแล้วได้ผลต่างกัน ต้องตรวจจากภาพต้นฉบับ"],
      },
    });
  const summary = summarizeDetectedSlipRecipients([candidate]);

  assert.equal(summary.unassignedRecords.length, 0);
  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].name, "จิณห์นิภา ประสาทเขตรการ");
  assert.equal(summary.groups[0].totalAmount, 3000);
  assert.equal(summary.groups[0].records[0].receiverNameNeedsReview, true);
  assert.equal(summary.groups[0].records[0].receiverNameOcrConflict, true);
  assert.equal(summary.groups[0].records[0].isConfirmed, false);
  assert.deepEqual(summary.groups[0].records[0].missingFields, []);

  const strongerRetry = structuredClone(candidate);
  strongerRetry.ocrDiagnosticTrace.attempts[2].lines[0].confidence = 96;
  const unresolved = summarizeDetectedSlipRecipients([strongerRetry]);
  assert.equal(unresolved.groups.length, 0);
  assert.equal(unresolved.unassignedRecords.length, 1);
});

test("suggests a corroborated name for a retry-conflicted occurrence without confirming it", () => {
  const summary = summarizeDetectedSlipRecipients([
    record("retry-conflict", "จัณห์นิภา ประสาทเขตรการ", 1000, {
      data: {
        receiver: { name: "จัณห์นิภา ประสาทเขตรการ", account_no: "XXX-X-XX385-0" },
        transaction: { amount: 1000 },
        confidence: { receiver_name: 0.90 },
        warnings: ["OCR ตรวจชื่อผู้รับซ้ำแล้วได้ผลต่างกัน ต้องตรวจจากภาพต้นฉบับ"],
      },
    }),
    record("clear-occurrence", "จิณห์นิภา ประสาทเขตรการ", 2000, {
      sha256: "independent-occurrence-hash",
      bounds: { x: 200, y: 300, width: 40, height: 50 },
      data: {
        receiver: { name: "จิณห์นิภา ประสาทเขตรการ", account_no: "XXX-X-XX385-0" },
        transaction: { amount: 2000 },
        confidence: { receiver_name: 0.96 },
      },
    }),
  ]);

  const conflicted = summary.unassignedRecords.find(({ id }) => id === "retry-conflict");
  assert.ok(conflicted);
  assert.equal(conflicted.receiverNameNeedsReview, true);
  assert.equal(conflicted.suggestedRecipientName, "จิณห์นิภา ประสาทเขตรการ");
  assert.equal(conflicted.suggestedFromOccurrenceId, "clear-occurrence");
  assert.equal(conflicted.isConfirmed, false);
  assert.equal(summary.groups.some(({ records }) => records.some(({ id }) => id === "retry-conflict")), false);
});

test("moves a manually reviewed conflict into its named group but keeps OCR conflict and confirmation separate", () => {
  const summary = summarizeDetectedSlipRecipients([
    record("manual-review", "จิณห์นิภา ประสาทเขตรการ", 1000, {
      isConfirmed: false,
      data: {
        receiver: { name: "จิณห์นิภา ประสาทเขตรการ", account_no: "XXX-X-XX385-0" },
        transaction: { amount: 1000 },
        confidence: { receiver_name: 0 },
        reviewed_fields: ["receiver_name"],
        warnings: ["OCR ตรวจชื่อผู้รับซ้ำแล้วได้ผลต่างกัน ต้องตรวจจากภาพต้นฉบับ"],
      },
    }),
  ]);

  assert.equal(summary.unassignedRecords.length, 0);
  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].records[0].receiverNameOcrConflict, true);
  assert.equal(summary.groups[0].records[0].receiverNameManuallyReviewed, true);
  assert.equal(summary.groups[0].records[0].receiverNameNeedsReview, true);
  assert.equal(summary.groups[0].records[0].isConfirmed, false);
});

test("retains source references and does not filter unconfirmed slips", () => {
  const source = record("pending", "กมล ทองดี", 50, {
    isConfirmed: false,
    chatPage: "7 / 8",
    dossierPage: 12,
    source: "chat.jpg",
    crop: "data:crop",
  });
  const summary = summarizeDetectedSlipRecipients([source]);
  const child = summary.groups[0].records[0];

  assert.equal(child.isConfirmed, false);
  assert.equal(child.chatPage, "7 / 8");
  assert.equal(child.dossierPage, 12);
  assert.equal(child.source, "chat.jpg");
  assert.equal(child.crop, "data:crop");
});

test("keeps an unreadable-name occurrence pending and offers a name only for an exact evidence match", () => {
  const sharedEvidence = {
    sha256: "same-file-hash",
    chatPage: "3 / 7",
    bounds: { x: 120, y: 240, width: 320, height: 480 },
  };
  const summary = summarizeDetectedSlipRecipients([
    record("named-copy", "จิณห์นภา ประสาทเขตรการ", 100, sharedEvidence),
    record("unreadable-copy", null, 100, sharedEvidence),
    record("other-slip-same-file", null, 100, {
      ...sharedEvidence,
      bounds: { ...sharedEvidence.bounds, y: 800 },
    }),
  ]);

  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0].records.length, 1);
  assert.equal(summary.groups[0].totalAmount, 100);
  assert.equal(summary.unassignedRecords.length, 2);
  assert.equal(summary.unassignedRecords[0].suggestedRecipientName, "จิณห์นภา ประสาทเขตรการ");
  assert.equal(summary.unassignedRecords[0].suggestedFromOccurrenceId, "named-copy");
  assert.equal(summary.unassignedRecords[0].isConfirmed, false);
  assert.equal(summary.unassignedRecords[0].amount, 100);
  assert.equal(summary.unassignedRecords[1].suggestedRecipientName, undefined);
});

test("does not suggest a name when exact evidence occurrences contain conflicting names", () => {
  const sharedEvidence = {
    sha256: "same-file-hash",
    chatPage: "3 / 7",
    bounds: { x: 120, y: 240, width: 320, height: 480 },
  };
  const summary = summarizeDetectedSlipRecipients([
    record("first-name", "สมชาย ใจดี", 100, sharedEvidence),
    record("conflicting-name", "สมหมาย ใจดี", 100, sharedEvidence),
    record("unreadable", null, 100, sharedEvidence),
  ]);

  assert.equal(summary.unassignedRecords.length, 1);
  assert.equal(summary.unassignedRecords[0].suggestedRecipientName, undefined);
  assert.equal(summary.groups.length, 2);
});

test("offers a higher-confidence name for review when the masked destination account matches", () => {
  const summary = summarizeDetectedSlipRecipients([
    record("noisy-name", "จัณห์นิภา ประสาทเขตรการ", 7200, {
      data: {
        receiver: { name: "จัณห์นิภา ประสาทเขตรการ", account_no: "|    XXX-X-XX996-5              t", bank: "ธนาคารทหารไทยธนชาต" },
        transaction: { amount: 7200 },
        confidence: { receiver_name: 0.82 },
      },
    }),
    record("clear-name", "จิณห์นิภา ประสาทเขตรการ", 3000, {
      data: {
        receiver: { name: "จิณห์นิภา ประสาทเขตรการ", account_no: "XXX-X-XX996-5", bank: "ธนาคารทหารไทยธนชาต" },
        transaction: { amount: 3000 },
        confidence: { receiver_name: 0.94 },
      },
    }),
  ]);

  const noisyRecord = summary.groups.find((group) => group.name.startsWith("จัณห์"))?.records[0];
  assert.equal(noisyRecord.corroboratedRecipientName, "จิณห์นิภา ประสาทเขตรการ");
  assert.equal(noisyRecord.corroboratedFromOccurrenceId, "clear-name");
  assert.equal(noisyRecord.isConfirmed, false);
});

test("withholds account-based name suggestions when higher-confidence occurrences conflict", () => {
  const withAccount = (id, name, confidence) => record(id, name, 100, {
    data: {
      receiver: { name, account_no: "XXX-X-XX996-5" },
      transaction: { amount: 100 },
      confidence: { receiver_name: confidence },
    },
  });
  const summary = summarizeDetectedSlipRecipients([
    withAccount("noisy", "จัณห์นิภา ประสาทเขตรการ", 0.82),
    withAccount("variant-a", "จิณห์นิภา ประสาทเขตรการ", 0.90),
    withAccount("variant-b", "จิณห์นภา ประสาทเขตรการ", 0.94),
  ]);

  for (const group of summary.groups) {
    assert.equal(group.records[0].corroboratedRecipientName, undefined);
  }
});
