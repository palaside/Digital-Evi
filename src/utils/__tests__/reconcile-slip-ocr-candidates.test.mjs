import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePageOcrNamesIntoQrCandidates } from "../reconcile-slip-ocr-candidates.mjs";

const candidate = ({ name, amount = 1000, account = "XXX-X-XX764-0", reference = "REF-100", bounds = { x: 0, y: 0, width: 100, height: 100 } }) => ({
  bounds,
  cropDataUrl: "data:image/png;base64,unchanged",
  data: {
    receiver: { name, account_no: account },
    transaction: { amount, date: "2025-03-12", reference_no: reference },
    confidence: { receiver_name: name === "น.ส. จิณห์นิภา บุญประเสริฐ" ? 0.88 : 0.87 },
    raw_text: [name],
    warnings: [],
  },
  ocrTextBoxes: [{ text: name, supportsFields: ["receiver_name"], confidence: 0.87 }],
});

test("uses full-page recipient OCR for the same slip only when spatial and transaction anchors agree", () => {
  const qrCrop = candidate({ name: "น.ส. จิณห์นิภา บุญประเสรีชฐ" });
  const pageOcr = candidate({ name: "น.ส. จิณห์นิภา บุญประเสริฐ", bounds: { x: 10, y: 10, width: 90, height: 90 } });
  pageOcr.data.confidence.receiver_name = 0.94;

  const [result] = reconcilePageOcrNamesIntoQrCandidates([qrCrop], [pageOcr]);

  assert.equal(result.data.receiver.name, "น.ส. จิณห์นิภา บุญประเสริฐ");
  assert.equal(result.data.transaction.amount, 1000);
  assert.deepEqual(result.data.raw_text, ["น.ส. จิณห์นิภา บุญประเสรีชฐ", "น.ส. จิณห์นิภา บุญประเสริฐ"]);
  assert.ok(result.data.warnings.some((warning) => warning.includes("ตรวจชื่อผู้รับซ้ำ")));
  assert.equal(result.ocrTextBoxes[0].text, "น.ส. จิณห์นิภา บุญประเสริฐ");
  assert.equal(result.cropDataUrl, qrCrop.cropDataUrl);
});

test("keeps the clearer QR-crop recipient when lower-confidence page OCR disagrees", () => {
  const qrCrop = candidate({ name: "น.ส. จิณห์นิภา ประสาทเขตรการ" });
  const pageOcr = candidate({ name: "น.ส. วิณห์นิภา ประสาทเขตรการ", bounds: { x: 10, y: 10, width: 90, height: 90 } });
  qrCrop.data.confidence.receiver_name = 0.94;
  pageOcr.data.confidence.receiver_name = 0.92;

  const [result] = reconcilePageOcrNamesIntoQrCandidates([qrCrop], [pageOcr]);

  assert.equal(result.data.receiver.name, qrCrop.data.receiver.name);
  assert.equal(result.data.confidence.receiver_name, 0.94);
  assert.deepEqual(result.data.raw_text, [qrCrop.data.receiver.name, pageOcr.data.receiver.name]);
  assert.ok(result.data.warnings.some((warning) => warning.includes("ตรวจชื่อผู้รับซ้ำ")));
  assert.equal(result.ocrTextBoxes[0].text, qrCrop.data.receiver.name);
});

test("does not join page OCR when the amount, date, account, reference, or overlap disagrees", () => {
  const qrCrop = candidate({ name: "OCR crop name" });
  const unrelated = [
    candidate({ name: "wrong amount", amount: 3000 }),
    candidate({ name: "wrong date", amount: 1000, bounds: { x: 0, y: 0, width: 100, height: 100 } }),
    candidate({ name: "wrong identifiers", amount: 1000, account: "XXX-X-XX999-9", reference: "REF-OTHER" }),
    candidate({ name: "far away", amount: 1000, bounds: { x: 500, y: 500, width: 100, height: 100 } }),
  ];
  unrelated[1].data.transaction.date = "2025-03-13";

  for (const pageOcr of unrelated) {
    const [result] = reconcilePageOcrNamesIntoQrCandidates([qrCrop], [pageOcr]);
    assert.equal(result.data.receiver.name, "OCR crop name");
  }
});

test("keeps crop OCR when more than one page region could match the slip", () => {
  const qrCrop = candidate({ name: "OCR crop name" });
  const pageOcr = candidate({ name: "page name" });

  const [result] = reconcilePageOcrNamesIntoQrCandidates([qrCrop], [pageOcr, pageOcr]);

  assert.equal(result.data.receiver.name, "OCR crop name");
});
