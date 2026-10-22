import assert from "node:assert/strict";
import test from "node:test";
import { filterTextOnlySlipRegionsForJob } from "../ocr-analysis-policy.mjs";

const ttbRegion = {
  bounds: { x0: 401, y0: 150, x1: 783, y1: 583 },
  amount: 7200,
  amountConfidence: 0.73,
  referenceNo: "202506171502627774",
  referenceConfidence: 0.83,
  receiverAccount: "XXX-X-XX996-5",
  rawText: "โอนเงินสําเร็จ\n7200.00\nXXX-X-XX996-5\nรหัสอ้างอิง: 202506171502627774",
};

test("retains a review-only TTB slip when its document contour was labeled as a chat bubble", () => {
  const regions = filterTextOnlySlipRegionsForJob([ttbRegion], {
    jobKind: "CHAT",
    visualCandidates: [{
      objectTypeCandidate: "text_bubble_candidate",
      bounds: { x: 416, y: 126, width: 352, height: 462 },
    }],
  });
  assert.deepEqual(regions, [ttbRegion]);
});

test("does not promote ordinary chat or a wide text bubble using only transfer words", () => {
  const region = { ...ttbRegion, referenceNo: null, rawText: "โอนเงินสําเร็จ 7200 บาท" };
  const wideBubble = { objectTypeCandidate: "text_bubble_candidate", bounds: { x: 401, y: 150, width: 382, height: 120 } };
  assert.deepEqual(filterTextOnlySlipRegionsForJob([region], { jobKind: "CHAT", visualCandidates: [wideBubble] }), []);
  assert.deepEqual(filterTextOnlySlipRegionsForJob([ttbRegion], { jobKind: "CHAT", visualCandidates: [wideBubble] }), []);
  assert.deepEqual(filterTextOnlySlipRegionsForJob([ttbRegion], { jobKind: "CHAT", visualCandidates: [] }), []);
});
