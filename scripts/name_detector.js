/**
 * name_detector.js — Thai Nickname Detector in Financial Context (Reference Script)
 * 
 * วัตถุประสงค์:
 *   จับ "ชื่อเล่น" ที่ปรากฏใน context การเงิน (โอน/ยืม/รับ/จ่าย)
 *   แล้ว flag ว่า "พบชื่อเล่นที่ยังไม่รู้ชื่อจริง — รอจับคู่กับสลิป"
 *
 * ไม่พยายามแปลงชื่อเล่น → ชื่อจริง (ต้องใช้มนุษย์ + สลิปยืนยัน)
 */

// ===================================================================
// 1. THAI NICKNAME PARTICLES (คำนำหน้าชื่อเล่น)
// ===================================================================
const NICKNAME_PARTICLES = [
  // เพศชาย
  'ไอ้', 'อ้าย', 'นาย',
  // เพศหญิง  
  'อี', 'อี้', 'นาง',
  // ทั่วไป (ไม่แบ่งเพศ)
  'พี่', 'น้อง', 'เจ้า', 'หมู', 'เพื่อน',
];

// คำกริยา/บริบทการเงินที่ชี้ว่ามีการโอนเงินเกี่ยวข้อง
const FINANCIAL_VERBS = [
  'โอน', 'โอนให้', 'โอนหา', 'โอนไปให้', 'โอนไปหา',
  'ส่ง', 'ส่งให้', 'ส่งหา',
  'ฝาก', 'ฝากให้', 'ฝากหา',
  'จ่าย', 'จ่ายให้', 'จ่ายหา',
  'ให้ยืม', 'ยืม', 'กู้',
  'รับ', 'รับเงิน', 'รับโอน',
  'เอาไป', 'เก็บไป', 'หยิบไป',
  'ค้าง', 'ติดหนี้', 'หนี้',
  'คืน', 'โอนคืน', 'จ่ายคืน',
];

// คำบ่งชี้จำนวนเงิน (ใช้ยืนยัน context)
const AMOUNT_PATTERN = /(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|บ\.|฿|THB)/g;

// ===================================================================
// 2. CORE NICKNAME EXTRACTION ENGINE
// ===================================================================

/**
 * Thai nickname = particle (optional) + short word (2-8 chars)
 * ชื่อเล่นไทยมักสั้น 2-5 ตัวอักษร
 */
const THAI_NICKNAME_CHAR = '[ก-ฮเแโใไa-zA-Z][ก-ฮเแโใไา-์a-zA-Z]{1,7}';

// Pattern หลัก: particle + ชื่อเล่น + บริบทการเงิน
const buildNicknamePatterns = () => {
  const particleAlt = NICKNAME_PARTICLES.join('|');
  const verbAlt = FINANCIAL_VERBS.join('|');

  return [
    // รูปแบบ A: [verb] + [particle?] + [nickname]
    // เช่น "โอนให้ไอ้ไก่" / "ส่งให้พี่โจ้"
    {
      name: 'VERB_THEN_NICKNAME',
      regex: new RegExp(
        `(?:${verbAlt})\\s*(?:${particleAlt})?\\s*(${THAI_NICKNAME_CHAR})(?![ก-ฮ])`,
        'g'
      ),
      captureGroup: 1,
      role: 'ผู้รับ',
    },

    // รูปแบบ B: [particle] + [nickname] + [verb]
    // เช่น "ไอ้ไก่โอนมาแล้ว" / "พี่แอมส่งให้ยัง"
    {
      name: 'NICKNAME_THEN_VERB',
      regex: new RegExp(
        `(?:${particleAlt})\\s*(${THAI_NICKNAME_CHAR})(?![ก-ฮ])\\s*(?:${verbAlt})`,
        'g'
      ),
      captureGroup: 1,
      role: 'ผู้โอน',
    },

    // รูปแบบ C: "ให้ + [particle] + [nickname] + หน่อย/ด้วย/เลย"
    // เช่น "ให้ไอ้ไก่หน่อย" / "ให้พี่แดงด้วย"
    {
      name: 'GIVE_NICKNAME_PARTICLE',
      regex: new RegExp(
        `ให้\\s*(?:${particleAlt})?\\s*(${THAI_NICKNAME_CHAR})(?![ก-ฮ])\\s*(?:หน่อย|ด้วย|เลย|ก่อน|นะ|ครับ|ค่ะ|นะคะ|นะครับ)?`,
        'g'
      ),
      captureGroup: 1,
      role: 'ผู้รับ',
    },

    // รูปแบบ D: "[particle]+[nickname] รับไป" / "...มาจาก[particle]+[nickname]"
    {
      name: 'NICKNAME_FINANCIAL_CONTEXT',
      regex: new RegExp(
        `(?:${particleAlt})\\s*(${THAI_NICKNAME_CHAR})(?![ก-ฮ])\\s*(?:รับไป|เอาไป|หยิบไป|ค้างอยู่|ยังไม่คืน|โกง|หาย|หนีไป)`,
        'g'
      ),
      captureGroup: 1,
      role: 'ผู้เกี่ยวข้อง',
    },
  ];
};

// ===================================================================
// 3. BLACKLIST (คำที่ไม่ใช่ชื่อเล่น — false positive)
// ===================================================================
const NICKNAME_BLACKLIST = new Set([
  // คำทั่วไปที่ตรงรูปแบบแต่ไม่ใช่ชื่อ
  'เงิน', 'บาท', 'ค่า', 'ของ', 'ได้', 'ไป', 'มา', 'แล้ว',
  'หน่อย', 'ด้วย', 'เลย', 'ก่อน', 'นะ', 'ครับ', 'ค่ะ',
  'ทั้ง', 'หมด', 'เต็ม', 'ครึ่ง', 'ตอน', 'วัน', 'คืน',
  'โอน', 'ส่ง', 'ฝาก', 'จ่าย', 'รับ', 'ยืม', 'กู้',
  'ธนาคาร', 'บัญชี', 'สลิป', 'หลักฐาน',
]);

// ===================================================================
// 4. MAIN EXTRACTOR FUNCTION
// ===================================================================
function extractNicknames(text) {
  const found = new Map(); // nickname → { nickname, particle, role, contexts[], lineNos[], count }
  const lines = text.split('\n');

  const addNickname = (nickname, role, patternName, lineNo, context) => {
    const nick = nickname.trim();
    if (nick.length < 2 || nick.length > 8) return;
    if (NICKNAME_BLACKLIST.has(nick)) return;
    // ต้องมีตัวอักษรไทยอย่างน้อย 1 ตัว
    if (!/[ก-ฮ]/.test(nick) && !/^[a-zA-Z]{2,}$/.test(nick)) return;

    const key = nick.toLowerCase();
    if (!found.has(key)) {
      found.set(key, {
        nickname: nick,
        role,
        patterns: [patternName],
        contexts: [context.trim()],
        lineNos: [lineNo],
        count: 1,
        realNameStatus: '❓ ยังไม่ทราบชื่อจริง — รอจับคู่กับสลิป',
      });
    } else {
      const e = found.get(key);
      if (!e.patterns.includes(patternName)) e.patterns.push(patternName);
      if (!e.contexts.includes(context.trim())) e.contexts.push(context.trim());
      e.lineNos.push(lineNo);
      e.count++;
      // Role upgrade: ถ้าเป็นทั้งผู้รับและผู้โอน
      if (e.role !== role) e.role = 'ผู้รับ/ผู้โอน';
    }
  };

  const patterns = buildNicknamePatterns();

  lines.forEach((line, lineIdx) => {
    const lineNo = lineIdx + 1;
    patterns.forEach((p) => {
      let m;
      p.regex.lastIndex = 0;
      while ((m = p.regex.exec(line)) !== null) {
        const nick = m[p.captureGroup];
        if (nick) addNickname(nick, p.role, p.name, lineNo, line);
      }
    });
  });

  // ตรวจว่า line นั้นมีจำนวนเงินหรือไม่ → เพิ่ม confidence
  const result = Array.from(found.values()).map((item) => {
    const hasAmount = item.contexts.some((ctx) => AMOUNT_PATTERN.test(ctx));
    AMOUNT_PATTERN.lastIndex = 0;
    return {
      ...item,
      confidence: hasAmount ? 'HIGH (มีจำนวนเงิน)' : 'MEDIUM (ไม่มีจำนวนเงิน)',
    };
  });

  return result.sort((a, b) => b.count - a.count);
}

// ===================================================================
// 5. TEST DATA — จำลองแชทคดีจริง
// ===================================================================
const TEST_CHATS = [
  {
    label: 'แชทยืมเงิน + ชื่อเล่น',
    text: `
สวัสดีครับ วันนี้ขอยืมก่อนนะ
โอนให้ไอ้ไก่หน่อย ตอนนี้เลย 3,000 บาท
พี่แอมบอกว่าส่งให้เธอด้วยนะ
ไอ้โจ้โอนมาแล้วยัง
อีนุ่นรับไปแล้ว 5,000 บาท
    `
  },
  {
    label: 'แชทฉ้อโกง (ชื่อเล่นหลายคน)',
    text: `
ให้พี่แดงก่อนเลย 10,000
อย่าโอนให้อีแนน ยังค้างอยู่เลย
น้องบิ๊กเอาไปแล้ว ไม่คืน
โอนหาไอ้บอยด้วยนะ 2,500 บาท
    `
  },
  {
    label: 'แชทที่ไม่มีชื่อเล่น (ทั่วไป)',
    text: `
วันนี้อากาศดีมาก
ไปกินข้าวด้วยกันไหม
ขอบคุณนะคะ
    `
  },
];

// ===================================================================
// 6. RUN + REPORT
// ===================================================================
console.log('='.repeat(72));
console.log('  Thai Nickname Detector — Financial Context (Ref. Script)');
console.log('='.repeat(72));

TEST_CHATS.forEach((tc, idx) => {
  console.log(`\n[Test ${idx + 1}] ${tc.label}`);
  console.log('-'.repeat(60));
  const results = extractNicknames(tc.text);

  if (results.length === 0) {
    console.log('  → ✅ ไม่พบชื่อเล่นใน context การเงิน');
  } else {
    results.forEach((r, i) => {
      console.log(`\n  ${i + 1}. ชื่อเล่น  : "${r.nickname}"`);
      console.log(`     บทบาท   : ${r.role}`);
      console.log(`     พบที่บรรทัด: ${r.lineNos.join(', ')}`);
      console.log(`     Confidence: ${r.confidence}`);
      console.log(`     Pattern  : [${r.patterns.join(', ')}]`);
      console.log(`     🚩 สถานะ: ${r.realNameStatus}`);
      r.contexts.forEach((ctx) => {
        if (ctx) console.log(`     💬 "${ctx.trim()}"`);
      });
    });
  }
});

console.log('\n' + '='.repeat(72));
console.log('  สรุป');
console.log('='.repeat(72));
console.log('  ✅ Script นี้ตรวจจับ "ชื่อเล่น" ใน context การเงินได้');
console.log('  🚩 Flag ทุกชื่อเล่นว่า "รอจับคู่กับสลิป"');
console.log('  ❌ ไม่แปลง ชื่อเล่น → ชื่อจริง (ต้องใช้สลิป + มนุษย์ยืนยัน)');
console.log('  💡 วิธีจับคู่: ดูสลิปที่ตามมาหลัง "โอนให้ไอ้ X" → ชื่อบัญชี = ชื่อจริงของ X');
console.log('='.repeat(72));
