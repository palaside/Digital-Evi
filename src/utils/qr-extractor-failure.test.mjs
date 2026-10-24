import test from "node:test";
import assert from "node:assert/strict";
import { reportQrExtractorFailure, traceQrDecodeAttempt } from "./qr-extractor-failure.mjs";

test("reports the original local QR extraction error to the caller", () => {
  const error = new Error("canvas read failed");
  let reported;

  reportQrExtractorFailure(error, (received) => { reported = received; });

  assert.equal(reported, error);
});

test("does not mask the extraction outcome when no reporter or a failing reporter is supplied", () => {
  const error = new Error("decoder failed");

  assert.doesNotThrow(() => reportQrExtractorFailure(error));
  assert.doesNotThrow(() => reportQrExtractorFailure(error, () => { throw new Error("reporter failed"); }));
});

test("records successful decoder calls without copying their private payload", async () => {
  const attempts = [];
  const hit = { data: "private-payload", location: {} };
  const result = await traceQrDecodeAttempt(() => hit, { decoder: "jsQR", width: 100, height: 120, scale: 1, stage: "original", candidateIndex: 0 }, (attempt) => attempts.push(attempt));
  assert.equal(result, hit);
  assert.equal(attempts[0].outcome, "decoded");
  assert.equal(attempts[0].width, 100);
  assert.equal(JSON.stringify(attempts).includes("private-payload"), false);
});

test("distinguishes a decoder load failure from an ordinary QR miss", async () => {
  const attempts = [];
  const context = { decoder: "ZXing", width: 100, height: 120, scale: 1, stage: "original", candidateIndex: 0 };
  await traceQrDecodeAttempt(() => null, context, (attempt) => attempts.push(attempt));
  const missing = new Error("Cannot find module @zxing/browser");
  await assert.rejects(traceQrDecodeAttempt(() => { throw missing; }, context, (attempt) => attempts.push(attempt)), (error) => error === missing);
  assert.deepEqual(attempts.map((attempt) => attempt.outcome), ["not_found", "error"]);
  assert.match(attempts[1].errorMessage, /Cannot find module/);
});

test("expected ZXing symbol failures remain misses and keep their exception name", async () => {
  for (const [name, outcome] of [["NotFoundException", "not_found"], ["ChecksumException", "invalid_symbol"], ["FormatException", "invalid_symbol"]]) {
    const error = Object.assign(new Error("decode failed"), { name });
    let recorded;
    await assert.rejects(traceQrDecodeAttempt(() => { throw error; }, {}, (attempt) => { recorded = attempt; }));
    assert.equal(recorded.outcome, outcome);
    assert.equal(recorded.errorName, name);
  }
});

test("a diagnostic callback failure does not replace a successful decode", async () => {
  const hit = { data: "valid", location: {} };
  assert.equal(await traceQrDecodeAttempt(() => hit, {}, () => { throw new Error("report failed"); }), hit);
});
