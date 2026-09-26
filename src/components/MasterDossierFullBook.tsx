"use client";

import React, { useRef } from "react";
import type { CourtCoverSheetData, HashManifestEntry } from "@/types/cover-sheet";
import type { ForensicEvidenceState } from "@/constants/forensic-ssot";
import type { SlipExtraction } from "@/schemas/slip.schema";
import CourtCoverSheet from "@/components/CourtCoverSheet";
import ExecutiveSummarySheet from "@/components/ExecutiveSummarySheet";
import HashManifestTable from "@/components/HashManifestTable";
import { LEGAL_DISCLAIMER_LINES } from "@/constants/forensic-ssot";

interface Props {
  coverData: CourtCoverSheetData;
  evidenceState: ForensicEvidenceState;
  extractedSlip: SlipExtraction | null;
  previewImage: string | null;
  manifestEntries: HashManifestEntry[];
  caseNumber: string;
  suspectName?: string;
  investigatorName?: string;
  investigatorPosition?: string;
  onClose?: () => void;
  onJumpToSection?: (section: string) => void;
}

export default function MasterDossierFullBook({
  coverData,
  evidenceState,
  extractedSlip,
  previewImage,
  manifestEntries,
  caseNumber,
  suspectName,
  investigatorName = "พ.ต.ท. สมศักดิ์ นิติการ",
  investigatorPosition = "สารวัตรสอบสวน (กลุ่มงานพิสูจน์หลักฐานดิจิทัล)",
  onClose,
  onJumpToSection,
}: Props) {
  // Pass 1: Total Pages Calculation
  // Page 1: Cover, Page 2: Exec Summary, Page 3: Summary Table, Page 4: Evidence Canvas, Page 5: Hash Manifest & Sign-Off
  const totalPages = 5;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#070a0f]/95 backdrop-blur-xl flex flex-col overflow-hidden select-text text-slate-100">
      {/* Control Top Bar */}
      <div className="h-16 px-6 glass-header border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <img
            src="/LOGO.png"
            alt="Dossier Logo"
            className="h-9 w-auto object-contain select-none"
          />
          <div>
            <h2 className="font-bold text-sm text-slate-100">
              MASTER COURT DOSSIER — เล่มสำนวนคดีฉบับสมบูรณ์ (5 ลำดับชั้นสารบรรณศาล)
            </h2>
            <p className="text-[11px] text-slate-400 font-mono">
              TWO-PASS COMPILED : 5 หน้าเต็มเล่ม (ISO/IEC 27037 & ป.วิ.อ. 226/1)
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="btn-proportional-primary glass-button glass-button-cyan text-xs"
          >
            🖨️ พิมพ์สำนวนศาล / บันทึก PDF (Single File)
          </button>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 flex items-center justify-center font-bold text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Dossier Pages Scroll Container (Zero Blank Screen) */}
      <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center gap-10 print:p-0 print:gap-0">
        {/* ===================================================================
            ลำดับที่ 1 (แผ่นแรก): หน้าปกสำนวนศาล (PAGE : 1 / 5)
            =================================================================== */}
        <div
          id="section-cover"
          className="w-full max-w-[850px] aspect-[1/1.414] shadow-2xl relative break-after-page print:shadow-none print:w-full print:h-screen"
        >
          <CourtCoverSheet data={coverData} />
        </div>

        {/* ===================================================================
            ลำดับที่ 2: ใบสรุปผู้บริหาร / ศาล / อัยการ (PAGE : 2 / 5)
            =================================================================== */}
        <div
          id="section-executive"
          className="w-full max-w-[850px] aspect-[1/1.414] shadow-2xl relative break-after-page print:shadow-none print:w-full print:h-screen"
        >
          <ExecutiveSummarySheet
            evidence={evidenceState}
            caseNumber={caseNumber}
            suspectName={suspectName}
          />
        </div>

        {/* ===================================================================
            ลำดับที่ 3: ตารางสรุปรายการสลิป 10 คอลัมน์ แนวนอน (PAGE : 3 / 5)
            =================================================================== */}
        <div
          id="section-ledger"
          className="w-full max-w-[850px] aspect-[1/1.414] bg-white text-slate-900 rounded-lg p-8 shadow-2xl relative flex flex-col justify-between break-after-page print:shadow-none print:w-full print:h-screen"
          style={{ fontFamily: "'Sarabun', sans-serif" }}
        >
          <div>
            <div className="border-b-2 border-slate-900 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-3xl">📊</span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    ตารางบัญชีนิติวิทยาศาสตร์และเส้นทางธุรกรรม ๑๐ คอลัมน์ (Financial Ledger)
                  </h3>
                  <p className="text-[10px] text-slate-600">
                    มาตรฐานการจัดทำบัญชีพยานหลักฐานประกอบคำฟ้องคดีอาญา
                  </p>
                </div>
              </div>
              <div className="text-right text-xs">
                <div className="font-mono font-bold text-slate-900">PAGE : 3 / {totalPages}</div>
                <div className="text-[10px] text-slate-600 font-mono">คดี: {caseNumber}</div>
              </div>
            </div>

            {/* Table */}
            <div className="mt-4 border border-slate-300 rounded overflow-hidden">
              <table className="w-full text-left border-collapse text-[10px]">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-300 font-bold text-slate-800">
                    <th className="p-1.5 text-center">ลำดับ</th>
                    <th className="p-1.5">วัน-เวลา</th>
                    <th className="p-1.5">ผู้โอน (ต้นทาง)</th>
                    <th className="p-1.5">ผู้รับโอน (เป้าหมาย)</th>
                    <th className="p-1.5 text-right">ยอดเงิน (บาท)</th>
                    <th className="p-1.5">รหัสอ้างอิงธุรกรรม</th>
                    <th className="p-1.5 text-center">การตรวจสอบ</th>
                  </tr>
                </thead>
                <tbody>
                  {extractedSlip && extractedSlip.transaction.amount ? (
                    <tr className="border-b border-slate-200">
                      <td className="p-1.5 text-center font-mono">1</td>
                      <td className="p-1.5 font-mono">
                        {extractedSlip.transaction.date} {extractedSlip.transaction.time}
                      </td>
                      <td className="p-1.5">
                        {extractedSlip.sender.name || "-"} ({extractedSlip.sender.bank || "-"})
                      </td>
                      <td className="p-1.5 font-bold text-emerald-800">
                        {extractedSlip.receiver.name || "-"} ({extractedSlip.receiver.bank || "-"})
                      </td>
                      <td className="p-1.5 text-right font-mono font-bold text-emerald-700">
                        ฿ {extractedSlip.transaction.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-1.5 font-mono text-[9px]">{extractedSlip.transaction.reference_no || "-"}</td>
                      <td className="p-1.5 text-center font-bold text-emerald-700 text-[9px]">✓ ไม่ซ้ำ 1:1</td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-slate-400">
                        ไม่พบรายการสลิปในสำนวน (Pure Zero State)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded flex justify-between items-center text-xs font-semibold">
              <span>ยอดเงินรวมสุทธิในสำนวน (Net Reconciled Loss):</span>
              <span className="font-mono text-base font-bold text-emerald-700">
                ฿ {evidenceState.totalNetLoss.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div className="text-[8px] text-slate-500 text-center leading-relaxed pt-2 border-t border-slate-200 shrink-0">
            {LEGAL_DISCLAIMER_LINES.join(" ")}
          </div>
        </div>

        {/* ===================================================================
            ลำดับที่ 4: พยานหลักฐานแผ่นสลิป / แชท (PAGE : 4 / 5)
            =================================================================== */}
        <div
          id="section-evidence"
          className="w-full max-w-[850px] aspect-[1/1.414] bg-white text-slate-900 rounded-lg p-8 shadow-2xl relative flex flex-col justify-between break-after-page print:shadow-none print:w-full print:h-screen"
          style={{ fontFamily: "'Sarabun', sans-serif" }}
        >
          <div>
            <div className="border-b-2 border-slate-900 pb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-3xl">🧾</span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    แผ่นพยานหลักฐานสลิปโอนเงิน (slip-block-fit)
                  </h3>
                  <p className="text-[10px] text-slate-600">
                    หลักฐานดิจิทัลจัดวางกึ่งกลางหน้า A4 สมบูรณ์แบบ (645×890 px) รักษาสัดส่วน 100%
                  </p>
                </div>
              </div>
              <div className="text-right text-xs">
                <div className="font-mono font-bold text-slate-900">PAGE : 4 / {totalPages}</div>
                <div className="text-[10px] text-slate-600 font-mono">คดี: {caseNumber}</div>
              </div>
            </div>

            {/* Evidence Image Center Display */}
            <div className="my-4 h-[580px] flex items-center justify-center border border-dashed border-slate-300 rounded bg-slate-50 p-2">
              {previewImage ? (
                <img
                  src={previewImage}
                  alt="Evidence Slip"
                  className="max-h-full max-w-full object-contain rounded shadow"
                />
              ) : (
                <div className="text-center text-slate-400">
                  <span className="text-4xl block mb-2">📄</span>
                  <span className="text-xs">รอการนำเข้าไฟล์ภาพสลิปพยานหลักฐาน</span>
                </div>
              )}
            </div>
          </div>

          <div className="text-[8px] text-slate-500 text-center leading-relaxed pt-2 border-t border-slate-200 shrink-0">
            {LEGAL_DISCLAIMER_LINES.join(" ")}
          </div>
        </div>

        {/* ===================================================================
            ลำดับที่ 5 (แผ่นปิดท้าย): บัญชีคุมค่าแฮช + บล็อกลงลายมือชื่อ (PAGE : 5 / 5)
            =================================================================== */}
        <div
          id="section-manifest"
          className="w-full max-w-[850px] aspect-[1/1.414] shadow-2xl relative break-after-page print:shadow-none print:w-full print:h-screen"
        >
          <HashManifestTable
            entries={manifestEntries}
            caseNumber={caseNumber}
            investigatorName={investigatorName}
            investigatorPosition={investigatorPosition}
            pageNumber={`5 / ${totalPages}`}
          />
        </div>
      </div>
    </div>
  );
}
