import assert from "node:assert/strict";
import test from "node:test";
import { findExactTargetIdentity, isExactTargetMatch, mergeDetectedTargetList, stripThaiTitlePrefix, buildDetectedTargetPeople } from "../target-matcher.ts";
import { summarizeDetectedSlipRecipients } from "../slip-recipient-summary.ts";

test("strips long-form prefixes defined by the Only skill before exact identity comparison", () => {
  for (const prefix of ["สิบตำรวจตรี", "พันตำรวจเอก", "พลตำรวจตรี", "นายแพทย์", "ศาสตราจารย์ ดร.", "พระมหา"]) {
    assert.equal(stripThaiTitlePrefix(`${prefix} สมชาย ใจดี`), "สมชาย ใจดี", prefix);
    assert.equal(isExactTargetMatch(`${prefix} สมชาย ใจดี`, "สมชาย ใจดี"), true, prefix);
  }
});

test("prefix normalization only strips a title at the start, not matching text inside a name", () => {
  assert.equal(stripThaiTitlePrefix("สมชาย นายดี"), "สมชาย นายดี");
  assert.equal(isExactTargetMatch("สมชาย นายดี", "สมชาย ดี"), false);
  assert.equal(stripThaiTitlePrefix("พลตำรวจตรี ดร. สมชาย ใจดี"), "สมชาย ใจดี");
});

test("title stripping preserves the exact recipient spelling shown on the slip", () => {
  assert.equal(stripThaiTitlePrefix("น.ส. จิณห์นิภา ประสาทเขตรการ"), "จิณห์นิภา ประสาทเขตรการ");
  assert.equal(isExactTargetMatch("น.ส. จิณห์นิภา ประสาทเขตรการ", "จิณห์นิภา ประสาทเขตการ"), false);
});

test("exact target matching strips titles but requires the complete normalized name", () => {
  assert.equal(isExactTargetMatch("น.ส. สมใจ ใจดี", "สมใจ ใจดี"), true);
  assert.equal(isExactTargetMatch("สมใจ ใจดี เพิ่มเติม", "สมใจ ใจดี"), false);
  assert.equal(isExactTargetMatch("สมใจ ใจดี", "สมใจ"), false);
  assert.equal(isExactTargetMatch("สมใจ ใจด***", "สมใจ ใจดี"), false);
});

test("exact target matching does not match by first name, phonetic similarity, or surname fragment", () => {
  assert.equal(isExactTargetMatch("สมใจ ใจดี", "สมใจ ใจดำ"), false);
  assert.equal(isExactTargetMatch("สมใจ ประสาทเขตการ", "สมใจ ประสาทเขตกร"), false);
  assert.equal(isExactTargetMatch("สมใจ ใจดี", "ใจดี"), false);
});

test("exact target matching ignores repeated whitespace after title normalization", () => {
  assert.equal(isExactTargetMatch("นาย  สมใจ   ใจดี", "สมใจ ใจดี"), true);
});

test("identity aggregation keeps fuzzy-similar full names separate", () => {
  const candidates = [
    { cleanName: "สมใจ ใจดี", totalAmount: 100 },
    { cleanName: "สมใจ ใจดำ", totalAmount: 200 },
  ];

  const getName = (candidate) => candidate.cleanName;
  assert.equal(findExactTargetIdentity(candidates, "สมใจ ใจด***", getName), undefined);
  assert.equal(findExactTargetIdentity(candidates, "น.ส. สมใจ ใจดี", getName)?.totalAmount, 100);
});

test("detected target list refreshes totals while preserving selection and manual targets", () => {
  const detected = [{
    rawName: "น.ส. สมใจ ใจดี",
    cleanName: "สมใจ ใจดี",
    role: "ผู้รับโอน",
    accountNo: "XXX-1",
    bank: "ธนาคาร A",
    totalAmount: 500,
    txCount: 2,
  }];
  const previous = [
    {
      id: "poi-auto-สมใจ_ใจดี",
      rawName: "สมใจ ใจดี",
      cleanName: "สมใจ ใจดี",
      selected: true,
      totalAmount: 100,
      txCount: 1,
    },
    {
      id: "poi-manual-มานะ_พากเพียร",
      rawName: "นาย มานะ พากเพียร",
      cleanName: "มานะ พากเพียร",
      selected: false,
    },
    {
      id: "poi-auto-stale",
      rawName: "เก่า เก่า",
      cleanName: "เก่า เก่า",
      selected: false,
    },
  ];

  assert.deepEqual(mergeDetectedTargetList(detected, previous), [
    {
      ...previous[0],
      totalAmount: 500,
      txCount: 2,
    },
    previous[1],
  ]);
});

test("detected target list retains manual-only entries when OCR has no names", () => {
  const manual = { id: "poi-manual-มานะ_พากเพียร", cleanName: "มานะ พากเพียร", selected: false };
  assert.deepEqual(mergeDetectedTargetList([], [manual]), [manual]);
});

test("new OCR-detected targets stay unchecked until a user selects them", () => {
  const [target] = mergeDetectedTargetList([{
    rawName: "น.ส. สมใจ ใจดี",
    cleanName: "สมใจ ใจดี",
    role: "ผู้รับโอน",
    totalAmount: 500,
    txCount: 1,
  }], []);

  assert.equal(target.selected, false);
  assert.equal(target.id, "poi-auto-สมใจ_ใจดี");
});

test("recipient-name retry conflicts do not enter detected person targets or totals", () => {
  const records = [
    {
      id: "clear",
      data: {
        receiver: { name: "สมใจ ใจดี", account_no: "XXX-X-XX111-1" },
        transaction: { amount: 300 },
      },
    },
    {
      id: "conflict",
      data: {
        receiver: { name: "สมใจ ใจดำ", account_no: "XXX-X-XX222-2" },
        transaction: { amount: 7200 },
        confidence: { receiver_name: 0.87 },
        warnings: ["OCR ตรวจชื่อผู้รับซ้ำแล้วได้ผลต่างกัน ต้องตรวจจากภาพต้นฉบับ"],
      },
    },
  ];
  const summary = summarizeDetectedSlipRecipients(records);
  const eligibleRecords = summary.groups.flatMap((group) => group.records);

  assert.deepEqual(buildDetectedTargetPeople(eligibleRecords), [{
    rawName: "สมใจ ใจดี",
    cleanName: "สมใจ ใจดี",
    role: "ผู้รับโอน",
    accountNo: "XXX-X-XX111-1",
    bank: "ธนาคาร",
    totalAmount: 300,
    txCount: 1,
  }]);
  assert.equal(summary.unassignedRecords[0].amount, 7200);
  assert.equal(summary.unassignedRecords[0].receiverNameNeedsReview, true);
});
