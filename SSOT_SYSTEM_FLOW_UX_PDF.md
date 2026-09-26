# MASTER ARCHITECTURE PROMPT: FORENSIC SYSTEM FLOW, UX SYSTEM & PDF-UI SSOT SYNCHRONIZATION

## 🏛️ สถาปัตยกรรมระบบ 3 เสาหลัก (The 3 Forensic Pillars)
1. **System Flow Engine:** ท่อส่งข้อมูลการประมวลผลหลักฐาน 5 สเตจตั้งแต่ต้นจนจบ
2. **UX System Design:** ระบบปฏิสัมพันธ์ 4 ขั้นตอน ไร้รอยต่อ และเป็น Pure Zero State
3. **SSOT Data Alignment & PDF-Component Contract:** ข้อมูลและข้อความฟุตเตอร์บนหน้าจอ UI และในเอกสาร PDF ต้องตรงกัน 100% อักษรต่ออักษร

---

## ภาคที่ 1: FORENSIC SYSTEM FLOW ARCHITECTURE (ท่อส่งข้อมูล 5 สเตจ)

```
[Stage 1: Pure Zero State]
      │ (รอรับไฟล์จริง ไม่แสดงยอดเงินปลอม 0.00 / 0 รายการ)
      ▼
[Stage 2: Intake & Classification Gateway]
      │ (แยกประเภทอัตโนมัติ: TYPE_SLIP / TYPE_CHAT / TYPE_CHAT_WITH_SLIP)
      ▼
[Stage 3: Offline Forensic Extraction Engine]
      │ (ถอดรหัส QR EMVCo Payload + In-Browser OCR สกัดยอดเงิน/บัญชี/วันที่/ชื่อบุคคล)
      ▼
[Stage 4: Target POI Matching & Net Reconciliation]
      │ (จับคู่ชื่อคู่กรณี กรองคำนำหน้าทิ้ง 100% + ตัดยอดซ้ำ Double-Counting)
      ▼
[Stage 5: Dual-Channel Rendering Engine]
      ├─► Channel A: Interactive Canvas Viewport (พรีวิวทันทีบน UI สัดส่วน A4 จริง)
      └─► Channel B: Court Standard PDF Export (พิมพ์สำนวนศาล Vector/Bitmap คุณภาพสูง)
```

1. **Pure Zero State Rule:**
   - เมื่อเปิดระบบมา ยอดรวมเงิน, จำนวนสลิป, จำนวนหน้าแชท, และรายชื่อ ต้องตั้งต้นที่ `0` หรือ `฿ 0.00`
   - ห้าม Hardcode ตัวเลขตัวอย่างใดๆ ค้างไว้ใน DOM หรือ State เด็ดขาด
2. **Deterministic Processing:**
   - สลิปรายใบ: จัดวางแบบ `slip-block-fit` (645×890 px กึ่งกลางหน้า A4 แนวตั้ง 993×1406 px)
   - หน้าแชทยาว: หั่นด้วย `Dicut_Chat` (807×1115 px ชิดขอบบน ไม่ผ่ากลางบับเบิ้ลข้อความ)
   - ตารางสรุป 10 คอลัมน์: สร้างในหน้า A4 แนวนอน (1406×993 px) ขอบปลอดภัย 1.25 ซม.

---

## ภาคที่ 2: UX SYSTEM DESIGN SPECIFICATION (สถาปัตยกรรมประสบการณ์ผู้ใช้)

ระบบถูกออกแบบในรูปแบบ **3-Column Fit-to-Screen Workbench** (100dvh ไร้การเลื่อนหลุดนอกจอ):

### 1. ระบบควบคุมขั้นตอน 4-Step Stepper (Workflow State Machine)
- **Step 1: อัพโหลดข้อมูล (Upload & Intake)** → เปิดรับไฟล์แบบ Drag & Drop แสดงสถานะจำนวนสลิป/แชท
- **Step 2: ตรวจสอบและประมวลผล (Process & Match)** → ช่องค้นหาชื่อเป้าหมาย (POI) และปุ่มเริ่มประมวลผล
- **Step 3: สร้างเอกสารหลักฐาน (Document & Audit)** → ตารางสรุป 13 ช่อง และสรุปยอดความเสียหายสุทธิ
- **Step 4: เสร็จสิ้น (Export & Packaging)** → สร้างไฟล์ PDF สำนวนศาล และแพ็กเกจเข้ารหัส WinRAR SFX (.exe)

### 2. สัดส่วนหน้าจอและการจัดวาง (Ergonomic Proportions)
- **Header Bar:** ความสูง `108px` โลโก้ขยายเต็มคอมโพเนนต์ (`height: calc(100% - 16px); max-height: 92px;`) ระยะห่างบรรทัดชื่อแบรนด์และสโลแกนมีช่องไฟชัดเจน (`gap: 6px; line-height: 1.4;`)
- **คอลัมน์ซ้าย (01 Controls)** และ **คอลัมน์ขวา (03 Summary):** ล็อกความกว้างด้วย `clamp(340px, 22vw, 440px)` เพื่อไม่ให้ยืดกว้างจนตัวอักษร 11px ดูหลุดสัดส่วนบนจอ 2K/4K/Ultrawide
- **คอลัมน์กลาง (02 Center Stage Review):** ได้รับพื้นที่สูงสุด (`minmax(480px, 1fr)`) เพื่อจำลองหน้ากระดาษ A4 เสมือนจริง ซูมเข้า-ออกได้ พิมพ์ได้ และไม่มีหน้าขาวตกค้าง

---

## ภาคที่ 3: THE SSOT CONTRACT — กฎเหล็กฟุตเตอร์และข้อมูล PDF ซิงค์ตรงกับคอมโพเนนต์ 100%

### 1. ข้อความรับรองทางกฎหมาย (Exact Legal Disclaimer Text)
ข้อความฟุตเตอร์ 3 บรรทัดที่ปรากฏบน **หน้าจอ UI**, ใน **HTML Canvas Preview**, ใน **ไฟล์ PDF สำนวนศาล**, และใน **บันทึก Hash Manifest** ต้องเป็นข้อความเดียวกัน ห้ามตัดทอนหรือดัดแปลงแม้แต่สระเดียว:
```text
บรรทัดที่ 1: "DIGITAL EVIDENCE เป็นเพียงเครื่องมืออำนวยความสะดวกให้กับผู้ว่าจ้าง โดยไม่ได้ดัดแปลง แก้ไข เพิ่ม-ลบ เนื้อหา
บรรทัดที่ 2: จากต้นฉบับใดๆ และไม่มีส่วนเกี่ยวข้องใดๆ กับเนื้อหาในเอกสาร เป็นเพียงเครื่องมือที่ทำงานเกี่ยวกับระบบไฟล์
บรรทัดที่ 3: เอกสารแบบอิเล็กทรอนิกส์ เท่านั้น"
```

### 2. กฎการจัดฟอนต์ฟุตเตอร์ภาษาไทย (Anti-Collision & No-Sink Typography)
- **ระยะบรรทัด (Line Spacing):** ต้องใช้ `lineSpacing = 26px - 28px` เสมอ (ห้ามใช้ 15-20px เพราะสระล่าง เช่น ุ, ู, ญ, ฎ ของบรรทัดบน จะขี่ทับสระบนและวรรณยุกต์ เช่น ิ, ี, ่, ้ ของบรรทัดล่าง)
- **ความหนาและขนาดฟอนต์:** ใช้ขนาด `13.5px` ฟอนต์ Sarabun Regular (400) (ห้ามใช้ ExtraLight หรือ Thin ที่ต่ำกว่า 13px เพราะหมึกพิมพ์หรือหน้าจอจะกลืนเส้นวรรณยุกต์จนสระจม)
- **เส้นฐาน (Text Baseline):** บังคับตั้งค่า `ctx.textBaseline = 'alphabetic'` และยึดแกน Y กึ่งกลางความสูงขอบล่างกระดาษ A4 (`footerY = 1406 - 92`)

### 3. การเชื่อมโยงสถานะข้อมูลระหว่าง UI และ PDF (Bi-Directional State Synchronization)
หากบนคอมโพเนนต์ UI ระบุว่ามี:
- สลิปตรวจพบ = N รายการ
- บุคคลเป้าหมาย = ชื่อ นาย A (ยอดรวม ฿ X,XXX.XX)
- วันที่และเวลาประมวลผล = DD/MM/YYYY : HH.MM

บน Header Ribbon, ตารางสรุป 10 คอลัมน์, และ Footer ของ PDF ต้องดึงค่าจาก State ตัวแปรเดียวกัน (เช่น `pdfState` / `evidenceStore`) ไปแสดงผลทันที ห้ามมีกรณีที่หน้าจอระบุยอดหนึ่ง แต่ PDF พิมพ์ออกมาเป็นอีกยอดหนึ่งโดยเด็ดขาด
