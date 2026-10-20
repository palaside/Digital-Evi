import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptSlipVisionResponse } from './slipvision-adapter.mjs';

const realSlip = {
  index: 1,
  dateTime: '09 มิ.ย. 2568 - 14:45',
  sourceBank: 'กรุงไทย',
  destBank: 'ทีเอ็มบีธนชาต',
  sender: 'สิบตรีณัฐชัย ร*** (XXX-X-XX526-6)',
  recipient: 'น.ส. จิณห์นิภา ประสาทเขตรการ (XXX-X-XX996-5)',
  amount: 5000,
  transId: 'Afe1cd222498c42a5',
  qrDetected: true,
  bbox_1000: [0, 0, 1000, 1000],
  rawOcrText: 'จาก\nสิบตรีณัฐชัย ร***\nไปยัง\nน.ส. จิณห์นิภา ประสาทเขตรการ\n5,000.00',
};

test('maps a real masked-name slip without confirming or inventing fields', () => {
  const [candidate] = adaptSlipVisionResponse({ success: true, data: { slips: [realSlip] } });
  assert.deepEqual(candidate.bbox_1000, [0, 0, 1000, 1000]);
  assert.equal(candidate.data.transaction.amount, 5000);
  assert.equal(candidate.data.transaction.reference_no, 'Afe1cd222498c42a5');
  assert.equal(candidate.data.transaction.date, '2025-06-09');
  assert.equal(candidate.data.transaction.time, '14:45');
  assert.equal(candidate.data.sender.name, 'สิบตรีณัฐชัย ร***');
  assert.equal(candidate.data.sender.account_no, 'XXX-X-XX526-6');
  assert.equal(candidate.data.receiver.name, 'น.ส. จิณห์นิภา ประสาทเขตรการ');
  assert.equal(candidate.data.confidence.sender_name, 0);
  assert.match(candidate.data.warnings.join(' '), /รอตรวจ/);
});

test('rejects simulated responses and malformed localization', () => {
  assert.throws(() => adaptSlipVisionResponse({ simulated: true, slips: [realSlip] }), /จำลอง/);
  assert.throws(() => adaptSlipVisionResponse({ success: true, data: { slips: [{ ...realSlip, bbox_1000: [0, 0, 0, 1000] }] } }), /กรอบ/);
});

test('returns no candidate for a no-slip response', () => {
  assert.deepEqual(adaptSlipVisionResponse({ success: true, data: { slips: [] } }), []);
});

test('keeps missing and ambiguous values pending rather than filling defaults', () => {
  const [candidate] = adaptSlipVisionResponse({ success: true, data: { slips: [{ ...realSlip, dateTime: 'เวลา 19:59 น.', sender: '', recipient: '', transId: '', amount: null }] } });
  assert.equal(candidate.data.transaction.date, null);
  assert.equal(candidate.data.transaction.amount, null);
  assert.equal(candidate.data.sender.name, null);
  assert.equal(candidate.data.receiver.name, null);
  assert.equal(candidate.data.transaction.reference_no, null);
});

test('interprets a two-digit Thai Buddhist year with an explicit review warning', () => {
  const [candidate] = adaptSlipVisionResponse({ success: true, data: { slips: [{ ...realSlip, dateTime: '10 มิ.ย. 68, 19:59 น.' }] } });
  assert.equal(candidate.data.transaction.date, '2025-06-10');
  assert.equal(candidate.data.transaction.time, '19:59');
  assert.match(candidate.data.warnings.join(' '), /ปี 2 หลัก/);
});

test('joins OCR-spaced mask marks without filling hidden letters', () => {
  const [candidate] = adaptSlipVisionResponse({ success: true, data: { slips: [{ ...realSlip, sender: 'สิบตรีณัฐชัย ร * * *' }] } });
  assert.equal(candidate.data.sender.name, 'สิบตรีณัฐชัย ร***');
});
