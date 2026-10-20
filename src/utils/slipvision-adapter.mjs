const THAI_MONTHS = new Map([
  ['มค', 1], ['กพ', 2], ['มีค', 3], ['เมย', 4],
  ['พค', 5], ['มิย', 6], ['กค', 7], ['สค', 8],
  ['กย', 9], ['ตค', 10], ['พย', 11], ['ธค', 12],
]);

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function splitPerson(value) {
  const text = textOrNull(value);
  if (!text) return { name: null, account_no: null };
  const account = text.match(/\s*\(([^()]*)\)\s*$/);
  const name = account && /[Xx*\d]/.test(account[1]) ? text.slice(0, account.index).trim() : text;
  const normalizedName = name.replace(/(\S)\s+(?=\*(?:\s*\*)+)/g, '$1').replace(/\*\s+(?=\*)/g, '*');
  return { name: normalizedName || null, account_no: account && /[Xx*\d]/.test(account[1]) ? account[1].trim() || null : null };
}

function parseDateTime(value) {
  const text = textOrNull(value) || '';
  const timeMatch = text.match(/(?:^|\D)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : null;
  const match = text.match(/(\d{1,2})\s+([^\s]+)\s+(\d{4}|\d{2})(?!\d)/);
  if (!match) return { date: null, time, interpretedTwoDigitYear: false };
  const month = THAI_MONTHS.get(match[2].replace(/\./g, ''));
  const interpretedTwoDigitYear = match[3].length === 2;
  const year = (interpretedTwoDigitYear ? 2500 + Number(match[3]) : Number(match[3])) - 543;
  const day = Number(match[1]);
  if (!month || year < 1900 || year > 2100) return { date: null, time, interpretedTwoDigitYear };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return { date: null, time, interpretedTwoDigitYear };
  }
  return { date: date.toISOString().slice(0, 10), time, interpretedTwoDigitYear };
}

function validBox(value) {
  return Array.isArray(value) && value.length === 4 && value.every((number) =>
    typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1000
  ) && value[0] < value[2] && value[1] < value[3];
}

export function adaptSlipVisionResponse(response) {
  if (response?.simulated) throw new Error('SlipVision ส่งข้อมูลจำลอง; ไม่รับเป็นหลักฐาน');
  if (response?.success !== true || !Array.isArray(response?.data?.slips)) {
    throw new Error('SlipVision ไม่ส่งผลสกัดตามสัญญา API');
  }
  if (response.data.slips.length > 20) throw new Error('SlipVision ส่งสลิปเกินจำนวนที่รองรับ');

  return response.data.slips.map((slip) => {
    if (!validBox(slip?.bbox_1000)) throw new Error('SlipVision ส่งกรอบสลิปไม่ถูกต้อง');
    const lines = textOrNull(slip.rawOcrText)?.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) || [];
    if (!lines.length) throw new Error('SlipVision ไม่มีข้อความจากบริเวณสลิปให้ตรวจย้อน');
    const sender = splitPerson(slip.sender);
    const receiver = splitPerson(slip.recipient);
    const dateTime = parseDateTime(slip.dateTime);
    const reference = textOrNull(slip.transId);
    const referenceNo = reference && /^[A-Za-z0-9\-_/]{4,100}$/.test(reference) ? reference : null;
    const amount = typeof slip.amount === 'number' && Number.isFinite(slip.amount) && slip.amount > 0
      ? slip.amount : null;
    const warnings = ['SlipVision เสนอข้อมูลจากภาพ; รอตรวจทานทุกช่อง ไม่ใช่การยืนยันจากธนาคาร'];
    if (!dateTime.date) warnings.push('วันที่อ่านไม่ครบหรือรูปแบบกำกวม; รอตรวจจากภาพ');
    if (dateTime.interpretedTwoDigitYear) warnings.push('ปี 2 หลักตีความเป็น พ.ศ. 25xx; รอตรวจจากภาพ');
    if (reference && !referenceNo) warnings.push('เลขอ้างอิงไม่ผ่านรูปแบบ; รอตรวจจากภาพ');
    const sourceBank = textOrNull(slip.sourceBank);
    const destBank = textOrNull(slip.destBank);

    return {
      bbox_1000: slip.bbox_1000,
      visual_cues: lines.slice(0, 4),
      data: {
        document_type: 'bank_transfer_slip',
        bank: { name: sourceBank, confidence: 0 },
        transaction: {
          date: dateTime.date,
          time: dateTime.time,
          amount,
          currency: 'THB',
          fee: null,
          reference_no: referenceNo,
          transaction_id: null,
          note: textOrNull(slip.memo),
        },
        sender: { name: sender.name, bank: sourceBank, account_no: sender.account_no },
        receiver: { name: receiver.name, bank: destBank, account_no: receiver.account_no },
        confidence: {
          date: 0, time: 0, amount: 0, reference_no: 0,
          sender_name: 0, receiver_name: 0, sender_account: 0, receiver_account: 0,
        },
        raw_text: lines,
        warnings,
      },
    };
  });
}
