# 💎 Glassmorphism Visual Contract & System Architecture (Tactical Forensic Edition)

> **Gatekeeper Mode: FORCED**  
> ป้องกันระบบหลุดเป็น Clean Card UI / Flat SaaS Card ธรรมดา 100%  
> ผสาน Layered Ambient Glow, Translucent Panels, Real Backdrop Blur, Rim Reflection และ Auto-handling Nested Glass

---

## 1. Visual Direction (ทิศทางด้านภาพ)

- **บรรยากาศพื้นหลัง (Layered Ambient Backdrop):** Deep Slate `#070A0F` เสริมด้วย Radial Ambient Lighting 3 จุด (Cyan `#38BDF8`, Emerald `#34D399`, และ Purple `#A855F7`) เพื่อให้แผงกระจกที่วางทับเกิดการมองทะลุ (Translucency) และสะท้อนแสงจริง
- **ผิวสัมผัสกระจก (Frosted Glass Panel):** ใช้ `rgba(15, 23, 42, 0.65)` พร้อม `backdrop-filter: blur(20px) saturate(180%)` ไม่ใช้การ์ดสีทึบหรือสีขาวแบบ SaaS ปกติ
- **สันขอบสะท้อนแสง (Highlight Edge & Rim Light):** เส้นขอบโปร่งแสง `1px solid rgba(255, 255, 255, 0.12)` พร้อม Inner Bevel Shadow `inset 0 1px 0 rgba(255, 255, 255, 0.15)` จำลองแสงสะท้อนของขอบกระจกพรีเมียม
- **การจัดการกระจกซ้อนกระจก (Auto Nested Glass Rule):** เมื่อกระจกถูกนำไปวางซ้อนในกระจกอีกชั้น ระบบจะลด Opacity เหลือ `0.03` และปิด `backdrop-filter` ซ้ำสองอัตโนมัติ เพื่อให้คงความโปร่งแสง ไม่ขุ่นมัว และไม่กินทรัพยากร GPU/RAM

---

## 2. Design Tokens Reference

```json
{
  "glass": {
    "background": "rgba(15, 23, 42, 0.65)",
    "backgroundStrong": "rgba(15, 23, 42, 0.85)",
    "backgroundNested": "rgba(255, 255, 255, 0.03)",
    "border": "1px solid rgba(255, 255, 255, 0.12)",
    "borderHighlight": "1px solid rgba(255, 255, 255, 0.22)",
    "blur": "blur(20px)",
    "blurHeavy": "blur(32px)",
    "saturate": "saturate(180%)",
    "shadow": "0 10px 30px -5px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.15)",
    "glowCyan": "0 0 24px rgba(56, 189, 248, 0.25)",
    "glowEmerald": "0 0 24px rgba(52, 211, 153, 0.25)",
    "textOnGlass": "#F8FAFC",
    "textMutedOnGlass": "#94A3B8"
  }
}
```

---

## 3. Component Rules

| Component | Glass Treatment | Border & Glow | Nested Rules |
| :--- | :--- | :--- | :--- |
| **Header** | Translucent Sticky Glass `rgba(11, 15, 23, 0.75)` + Blur 20px | เส้นคั่นล่าง 1px สีขาวจาง 10% | รองรับ Breadcrumb และ Indicator Capsule |
| **Card (Primary)** | `var(--glass-background)` + Blur 20px | ขอบ 1px + Inset 1px แสงสะท้อน | เมื่อ Hover ยกตัว -2px ขอบเรืองสี Cyan |
| **Nested Card** | `rgba(255, 255, 255, 0.03)` (โปร่งใสสูง) | ขอบ 1px ขาว 20% สันคมชัด | **ปิด Blur ซ้ำสอง (backdrop-filter: none)** |
| **Modal / Dialog** | `var(--glass-background-strong)` + Heavy Blur 32px | ขอบขาว 18% + Deep Drop Shadow | มี Backdrop Overlay มืด Blur 12px |
| **Input / Search** | `rgba(255, 255, 255, 0.05)` + Blur 8px (Min 44px) | Focus ขอบสีเขียว Emerald + Glow 14px | Contrast ตัวอักษรสีขาวชัดเจน |
| **Buttons** | Glass Capsule `rgba(255, 255, 255, 0.08)` (Min 44px) | ขอบขาว 18% / ขอบ Cyan เรืองแสง | Hover ขยายความสว่างพร้อม Bevel Highlight |
| **Chips / Badges** | Soft Translucent Capsule `rgba(255, 255, 255, 0.05)` | ขอบขาว 12% หรือ Cyan นีออน | ขนาดกระทัดรัด ไม่บดบังพื้นหลัง |

---

## 4. CSS Implementation

ดูไฟล์ฉบับเต็มได้ที่ [src/app/globals.css](file:///d:/Project/Digital%20Evi/digital-evidence/src/app/globals.css)

```css
/* Core Glass Panel */
.glass-panel, .glass-card {
  background: var(--glass-background);
  backdrop-filter: var(--glass-blur) var(--glass-saturate);
  -webkit-backdrop-filter: var(--glass-blur) var(--glass-saturate);
  border: var(--glass-border);
  box-shadow: var(--glass-shadow);
  border-radius: 12px;
  position: relative;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Auto Nested Glass Protection */
.glass-card .glass-card,
.glass-panel .glass-panel,
.glass-card .glass-nested {
  background: var(--glass-background-nested);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: 1px solid rgba(255, 255, 255, 0.20);
  box-shadow: var(--glass-shadow-nested);
}
```

---

## 5. ตัวอย่าง HTML / JSX Component Structure

```html
<div class="app-shell min-h-screen flex flex-col">
  <!-- 1. Header Sticky Glass -->
  <header class="glass-header sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="text-xl font-bold tracking-tight">DIGITAL EVIDENCE</span>
      <span class="glass-badge glass-badge-active">REVISION 02</span>
    </div>
    <div class="flex items-center gap-4">
      <div class="glass-badge">ISO/IEC 27037 FORENSIC READY</div>
      <button class="glass-button glass-button-cyan">🖨️ พิมพ์เอกสาร</button>
    </div>
  </header>

  <!-- 2. Workspace 3-Column Tactical Layout -->
  <main class="flex-1 p-4 grid grid-cols-12 gap-4">
    <!-- Left Column: Evidence Intake (Primary Glass Panel) -->
    <section class="col-span-3 glass-panel p-4 flex flex-col gap-4">
      <h2 class="text-sm font-semibold tracking-wider text-slate-300">นำเข้าพยานหลักฐาน</h2>
      
      <!-- Nested Glass Dropzone -->
      <div class="glass-nested p-6 rounded-lg border-dashed text-center flex flex-col items-center">
        <span class="text-3xl mb-2">📁</span>
        <p class="text-sm font-medium">ลากไฟล์ภาพแชท / สลิป มาวางที่นี่</p>
        <p class="text-xs text-slate-400 mt-1">PNG, JPG, PDF (Auto-Classify)</p>
      </div>

      <!-- Glass Input -->
      <input type="text" placeholder="ค้นหาชื่อเป้าหมาย..." class="glass-input w-full" />
    </section>

    <!-- Center Column: A4 Court Preview Canvas -->
    <section class="col-span-6 glass-panel p-4 flex flex-col items-center justify-center">
      <div class="w-full flex justify-between items-center mb-3">
        <span class="glass-badge glass-badge-active">MODE : SLIP</span>
        <span class="text-xs font-mono text-slate-400">PAGE : 1 / 1</span>
      </div>
      <!-- Virtual A4 Canvas Surface (Court White) -->
      <div class="bg-white text-slate-900 rounded shadow-2xl p-6 aspect-[1/1.414] max-h-[75vh] w-auto">
        <!-- Canvas Rendering Target -->
      </div>
    </section>

    <!-- Right Column: Forensic KPI Metrics -->
    <section class="col-span-3 flex flex-col gap-4">
      <div class="glass-card p-4">
        <span class="text-xs text-slate-400">ยอดเงินรวมในคดี</span>
        <div class="text-2xl font-mono font-bold text-emerald-400 mt-1">฿ 15,000.00</div>
        <div class="glass-badge mt-2">1 สลิปต้นฉบับ</div>
      </div>
      <div class="glass-card p-4">
        <span class="text-xs text-slate-400">สถานะความสอดคล้อง</span>
        <div class="text-lg font-bold text-sky-400 mt-1">✓ สอดคล้อง 1:1</div>
      </div>
    </section>
  </main>
</div>
```

---

## 6. Visual QA Checklist

- [x] **Layered Background:** มองเห็นแสงเรืองสะท้อน Cyan / Emerald / Purple ทะลุผ่านแผงกระจก
- [x] **Real Backdrop Blur:** ใช้งาน `backdrop-filter: blur(...)` และ `-webkit-backdrop-filter` จริง
- [x] **Translucent Panels:** ทุก Primary Surface โปร่งแสง `rgba(...)`
- [x] **Glass Border & Highlight:** มีขอบ `1px solid rgba(255,255,255,0.12)` พร้อม Inner Inset Bevel
- [x] **Depth & Soft Shadow:** ใช้เงาหลายชั้น `0 10px 30px -5px rgba(0, 0, 0, 0.6)`
- [x] **Nested Glass Auto-Handling:** กระจกซ้อนกระจกลด Opacity ลงเหลือ `0.03` และปิด blur ซ้ำสองอัตโนมัติ
- [x] **Accessibility & Contrast:** สีตัวอักษร `#F8FAFC` บนพื้นเข้ม มี Contrast Ratio สูงกว่า 4.5:1 ตามมาตรฐาน WCAG AA
- [x] **Minimum Interactive Target:** ทุก Input และ Button มีความสูงอย่างน้อย 44px
- [x] **No Flat SaaS Card:** ปลอดจากการ์ดสีทึบหรือ Clean White Card ธรรมดา 100%
- [x] **Browser Fallback:** มีกฎ `@supports not` รองรับเบราว์เซอร์เก่าให้อ่านได้ราบรื่น
