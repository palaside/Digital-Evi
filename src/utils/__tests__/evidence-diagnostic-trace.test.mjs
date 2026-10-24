import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceDiagnosticTrace } from "../evidence-diagnostic-trace.mjs";

test("exports per-image OCR and QR diagnostics with provenance but without source file bytes", () => {
  const trace = {
    sourceDimensions: { width: 400, height: 800 },
    qrBounds: [{ x: 300, y: 600, width: 40, height: 40 }],
    objectBounds: [],
    attempts: [{ id: "qr-1", scope: "qr_crop", trigger: "initial", sourceBounds: { x: 1, y: 2, width: 3, height: 4 }, inputDimensions: { width: 3, height: 4 }, scale: 1, meanConfidence: 91, lines: [{ id: "l1", text: "3,000.00", confidence: 91, bounds: { x: 0, y: 0, width: 3, height: 1 } }] }],
    regions: [{ bounds: { x: 0, y: 0, width: 4, height: 5 }, amount: 3000, senderName: null, receiverName: "ผู้รับ", reference: "R1", acceptedByCandidatePolicy: true, reason: "supported" }],
    parserRejectionReasons: [],
  };
  const item = {
    id: "slip-1",
    file: { name: "slip.png", size: 123, type: "image/png", arrayBuffer: () => new ArrayBuffer(123) },
    previewUrl: "blob:must-not-export",
    category: "SLIP",
    detectType: "TYPE_SLIP",
    status: "done",
    meta: { sha256: "source-sha", size_bytes: 123 },
    data: { sender: { name: null }, receiver: { name: "ผู้รับ" }, transaction: { amount: 3000, reference_no: "R1" } },
    sourceBounds: { x: 10, y: 20, width: 30, height: 40 },
    ocrTextBoxes: [{ text: "3,000.00", confidence: 0.91, bounds: { x: 1, y: 2, width: 3, height: 4 }, classification: "slip_evidence", supportsFields: ["amount"] }],
    ocrDiagnosticTrace: trace,
    qrScanDiagnostic: { inputWidth: 400, inputHeight: 800, pixelFingerprint: "abcd1234", productionUpscale: 1, scans: [{ scale: 1, decoder: "jsQR", decoded: true }] },
    processingWarnings: [],
    isConfirmed: false,
  };

  const result = buildEvidenceDiagnosticTrace([item], [{ no: 1, file_name: "slip.png", sha256: "source-sha" }], "2026-10-17T00:00:00.000Z");

  assert.equal(result.schema, "digital-evidence.extraction-diagnostic-trace.v1");
  assert.equal(result.statistics.inputImages, 1);
  assert.equal(result.statistics.candidates, 1);
  assert.equal(result.statistics.qrScanAttempts, 1);
  assert.equal(result.items[0].source.sha256, "source-sha");
  assert.equal(result.items[0].ocrDiagnosticTrace.attempts[0].lines[0].text, "3,000.00");
  assert.equal(result.items[0].candidates[0].data.transaction.amount, 3000);
  assert.equal("file" in result.items[0], false);
  assert.equal("previewUrl" in result.items[0], false);
  assert.equal(JSON.stringify(result).includes("must-not-export"), false);
});

test("counts successful production scans separately from 44 failed diagnostic probes", () => {
  const result = buildEvidenceDiagnosticTrace([{
    id: "batch", category: "CHAT", chatEvidenceLayers: [
      { qrScanDiagnostic: { candidateCount: 1, productionScans: [{ outcome: "decoded" }], scans: [] } },
      { qrScanDiagnostic: { candidateCount: 0, productionScans: [{ outcome: "not_found" }, { outcome: "error" }], scans: Array.from({ length: 44 }, () => ({ decoded: false })) } },
    ],
  }], []);
  assert.equal(result.statistics.qrScanAttempts, 47);
  assert.equal(result.statistics.qrDecodedScans, 1);
  assert.equal(result.statistics.qrProductionScanAttempts, 3);
  assert.equal(result.statistics.qrDiagnosticProbeAttempts, 44);
  assert.equal(result.statistics.qrInputsObserved, 2);
  assert.equal(result.statistics.qrInputsDecoded, 1);
  assert.equal(result.statistics.qrDecoderErrors, 1);
});

test("legacy diagnostic-only traces do not claim production scan coverage", () => {
  const result = buildEvidenceDiagnosticTrace([{
    category: "SLIP", qrScanDiagnostic: { scans: [{ decoded: false }] },
  }], []);
  assert.equal(result.statistics.qrInputsObserved, 0);
  assert.equal(result.statistics.qrInputsDecoded, 0);
  assert.equal(result.statistics.qrLegacyDiagnosticInputs, 1);
});
