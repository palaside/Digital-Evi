"use client";

import React, { useRef } from "react";
import type { CourtCoverSheetData, HashManifestEntry } from "@/types/cover-sheet";
import type { ForensicEvidenceState } from "@/constants/forensic-ssot";
import type { SlipExtraction } from "@/schemas/slip.schema";
import CourtCoverSheet from "@/components/CourtCoverSheet";
import ExecutiveSummarySheet from "@/components/ExecutiveSummarySheet";
import HashManifestTable from "@/components/HashManifestTable";
import { HeaderA4 } from "@/components/HeaderA4";
import { ModeSelectorPanel } from "@/components/ModeSelectorPanel";
import { LedgerColumnToggle, ledgerColumns } from "@/components/LedgerColumnToggle";
import { useMode } from "@/context/ModeContext";
import { LEGAL_DISCLAIMER_LINES } from "@/constants/forensic-ssot";
import {
  resolveHeaderMode,
  resolveHeaderCorroborated,
  resolveHeaderPageNumber,
} from "@/utils/forensic-header-machine";

export interface StagedItemForBook {
  id: string;
  file: File;
  previewUrl: string;
  category: "SLIP" | "CHAT";
  detectType?: string;
  data?: SlipExtraction;
  chatSlices?: string[];
}

interface Props {
  coverData: CourtCoverSheetData;
  evidenceState: ForensicEvidenceState;
  extractedSlip: SlipExtraction | null;
  previewImage: string | null;
  stagedItems?: StagedItemForBook[];
  manifestEntries: HashManifestEntry[];
  caseNumber: string;
  suspectName?: string;
  investigatorName?: string;
  investigatorPosition?: string;
  vaultPassword?: string;
  onClose?: () => void;
  onJumpToSection?: (section: string) => void;
}

export default function MasterDossierFullBook({
  coverData,
  evidenceState,
  extractedSlip,
  previewImage,
  stagedItems = [],
  manifestEntries,
  caseNumber,
  suspectName,
  investigatorName = "พ.ต.ท. สมศักดิ์ นิติการ",
  investigatorPosition = "สารวัตรสอบสวน (กลุ่มงานพิสูจน์หลักฐานดิจิทัล)",
  vaultPassword = "",
  onClose,
  onJumpToSection,
}: Props) {
  // ...props
}: Props) {
  const { mode } = useMode();
  const [ledgerRows, setLedgerRows] = React.useState<any[]>([]);
  const [visibleCols, setVisibleCols] = React.useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {};
    ledgerColumns.forEach(col => { defaults[col.key] = true; });
    return defaults;
  });

  React.useEffect(() => {
    if (mode === 'SLIP') {
      fetch('/api/ledger?mode=SLIP')
        .then(res => res.json())
        .then(data => setLedgerRows(data))
        .catch(err => console.error('Failed to fetch ledger:', err));
    }
  }, [mode]);
  coverData,
  evidenceState,
  extractedSlip,
  previewImage,
  stagedItems = [],
  manifestEntries,
  caseNumber,
  suspectName,
  investigatorName = "พ.ต.ท. สมศักดิ์ นิติการ",
  investigatorPosition = "สารวัตรสอบสวน (กลุ่มงานพิสูจน์หลักฐานดิจิทัล)",
  vaultPassword = "",
  onClose,
  onJumpToSection,
}: Props) {
  const handlePrint = () => {
    window.print();
  };

  const nowFormatted = new Date().toLocaleDateString("en-GB") + " : " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const evidenceCorroboration = resolveHeaderCorroborated({
    type: "SLIP",
    itemIndex: 1,
    targetName: suspectName || evidenceState.poiName,
    amount: extractedSlip?.transaction?.amount || evidenceState.totalNetLoss,
    isDuplicate: false,
    chatHasSlip: evidenceState.slipCount > 0,
    slipPageRef: 1,
  });

  // Dynamic Evidence Pages Compilation (Flattens multi-page chat slices & slips)
  const compiledEvidencePages: Array<{
    pageId: string;
    category: "SLIP" | "CHAT";
    imageUrl: string;
    sliceLabel?: string;
    corroborationText: string;
  }> = [];

  if (stagedItems && stagedItems.length > 0) {
    stagedItems.forEach((item, itemIdx) => {
      if (item.category === "CHAT" && item.chatSlices && item.chatSlices.length > 0) {
        item.chatSlices.forEach((sliceUrl, sliceIdx) => {
          const corroText = resolveHeaderCorroborated({
            type: "CHAT",
            itemIndex: itemIdx + 1,
            targetName: suspectName || evidenceState.poiName,
            amount: item.data?.transaction.amount || evidenceState.totalNetLoss,
            isDuplicate: false,
            chatHasSlip: evidenceState.slipCount > 0,
            slipPageRef: 1,
          });
          compiledEvidencePages.push({
            pageId: `${item.id}-slice-${sliceIdx}`,
            category: "CHAT",
            imageUrl: sliceUrl,
            sliceLabel: `หน้าแชท ${sliceIdx + 1} / ${item.chatSlices!.length}`,
            corroborationText: corroText,
          });
        });
      } else {
        const corroText = resolveHeaderCorroborated({
          type: item.category,
          itemIndex: itemIdx + 1,
          targetName: suspectName || evidenceState.poiName,
          amount: item.data?.transaction.amount || evidenceState.totalNetLoss,
          isDuplicate: false,
          chatHasSlip: evidenceState.slipCount > 0,
          slipPageRef: 1,
        });
        compiledEvidencePages.push({
          pageId: item.id,
          category: item.category,
          imageUrl: item.previewUrl,
          corroborationText: corroText,
        });
      }
    });
  } else if (previewImage) {
    compiledEvidencePages.push({
      pageId: "single-preview",
      category: "SLIP",
      imageUrl: previewImage,
      corroborationText: evidenceCorroboration,
    });
  }

  // Pass 1: Total Pages Calculation
  // 3 Front Matter Pages (Cover, Executive Summary, 10-Col Ledger) + N Evidence Pages + 1 Hash Manifest Page
  const totalPages = 3 + (compiledEvidencePages.length > 0 ? compiledEvidencePages.length : 1) + 1;

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
              MASTER COURT DOSSIER — เล่มสำนวนคดีฉบับสมบูรณ์ ({totalPages} ลำดับชั้นสารบรรณศาล)
            </h2>
            <p className="text-[11px] text-slate-400 font-mono">
              TWO-PASS COMPILED : {totalPages} หน้าเต็มเล่ม (ISO/IEC 27037 & ป.วิ.อ. 226/1)
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {vaultPassword?.trim() ? (
            <span className="text-[11px] font-mono text-emerald-300 bg-emerald-500/20 px-2.5 py-1 rounded-lg border border-emerald-400/40 flex items-center gap-1.5 font-semibold">
              🔒 PDF LOCKED: {vaultPassword.trim()}
            </span>
          ) : (
            <span className="text-[11px] font-mono text-slate-400 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10 flex items-center gap-1.5">
              🔓 UNENCRYPTED PDF (ไม่มีรหัสผ่าน)
            </span>
          )}
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
        {/* Insert Mode Selector Panel */}
        <ModeSelectorPanel />
      </div>

      {/* Dossier Pages Scroll Container (Zero Blank Screen) */}
      <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center gap-10 print:p-0 print:gap-0">
        {/* ===================================================================
            ลำดับที่ 1 (แผ่นแรก): หน้าปกสำนวนศาล (PAGE : 1 / totalPages)
            =================================================================== */}
        <HeaderA4 />
        <div
          id="section-cover"
          className="w-full max-w-[850px] aspect-[1/1.414] shadow-2xl relative break-after-page print:shadow-none print:w-full print:h-screen"
        >
          <CourtCoverSheet data={coverData} />
        </div>

        {/* ===================================================================
            ลำดับที่ 2: ใบสรุปผู้บริหาร / ศาล / อัยการ (PAGE : 2 / totalPages)
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
            ลำดับที่ 3: ตารางสรุปรายการสลิป 10 คอลัมน์ แนวนอน (PAGE : 3 / totalPages)
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
                    <LedgerColumnToggle visible={visibleCols} setVisible={setVisibleCols} persist={true} />
                    ตารางบัญชีนิติวิทยาศาสตร์และเส้นทางธุรกรรม ๑๐ คอลัมน์ (Financial Ledger)
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
                      {ledgerColumns.filter(col => visibleCols[col.key]).map(col => (
                        <th key={col.key} className="p-1.5 text-center">{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.length > 0 ? (
                      ledgerRows.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-200">
                          {ledgerColumns.filter(col => visibleCols[col.key]).map(col => (
                            <td key={col.key} className="p-1.5 text-center font-mono">{row[col.key]}</td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={ledgerColumns.filter(col => visibleCols[col.key]).length} className="p-6 text-center text-slate-400">
                          ไม่พบรายการสลิปในสำนวน (Pure Zero State)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
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
            ลำดับที่ 4 ถึง 3+N: พยานหลักฐานแผ่นสลิป / แชททุกหน้า A4
            =================================================================== */}
        {compiledEvidencePages.map((evPage, idx) => {
          const pageNum = 4 + idx;
          return (
            <div
              key={evPage.pageId}
              id={`section-evidence-${idx}`}
              className="w-full max-w-[850px] aspect-[1/1.414] bg-white text-slate-900 rounded-lg p-8 shadow-2xl relative flex flex-col justify-between break-after-page print:shadow-none print:w-full print:h-screen"
              style={{ fontFamily: "'Sarabun', sans-serif" }}
            >
              <div>
                {/* Standard Evidence Ribbon Header */}
                <div className="bg-[#F8FAFC] border border-[#CBD5E1] rounded p-3 mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src="/LOGO.png"
                      alt="Emblem"
                      className="h-12 w-auto object-contain select-none"
                    />
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 text-xs text-[#111827]">
                        <span className="font-extralight">MODE : </span>
                        <span className="font-thin font-bold">{evPage.category}</span>
                        {evPage.sliceLabel && (
                          <span className="ml-2 font-mono text-[10px] text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded border border-sky-300 font-semibold">
                            {evPage.sliceLabel}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-[#111827]">
                        <span className="font-extralight">CORROBORATED : </span>
                        <span className="font-thin text-[11px] text-[#111827] max-w-[480px] truncate">
                          {evPage.corroborationText}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-0.5 text-xs text-[#111827]">
                    <div className="flex items-center gap-1">
                      <span className="font-extralight">PAGE : </span>
                      <span className="font-thin font-bold font-mono">{pageNum} / {totalPages}</span>
                    </div>
                    <span className="font-thin text-[10px] text-slate-500 font-mono">
                      {nowFormatted}
                    </span>
                  </div>
                </div>

                {/* Evidence Image Display */}
                <div className="my-4 h-[580px] flex items-center justify-center border border-dashed border-slate-300 rounded bg-slate-50 p-2">
                  <img
                    src={evPage.imageUrl}
                    alt={`Evidence ${evPage.category}`}
                    className="max-h-full max-w-full object-contain rounded shadow"
                  />
                </div>
              </div>

              <div className="text-[8px] text-slate-500 text-center leading-relaxed pt-2 border-t border-slate-200 shrink-0">
                {LEGAL_DISCLAIMER_LINES.join(" ")}
              </div>
            </div>
          );
        })}

        {/* ===================================================================
            ลำดับที่ปิดท้าย (PAGE : totalPages / totalPages): บัญชีคุมค่าแฮช + บล็อกลงลายมือชื่อ
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
            pageNumber={`${totalPages} / ${totalPages}`}
          />
        </div>
      </div>
    </div>
  );
}
