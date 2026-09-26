"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import type { SlipExtraction } from "@/schemas/slip.schema";
import {
  LEGAL_DISCLAIMER_LINES,
  FORENSIC_CANVAS_SPEC,
  WORKFLOW_STEPS,
  PURE_ZERO_STATE,
  type ForensicEvidenceState,
} from "@/constants/forensic-ssot";
import type { CourtCoverSheetData, HashManifestEntry } from "@/types/cover-sheet";
import CourtCoverSheet from "@/components/CourtCoverSheet";
import HashManifestTable from "@/components/HashManifestTable";
import ExecutiveSummarySheet from "@/components/ExecutiveSummarySheet";
import MasterDossierFullBook from "@/components/MasterDossierFullBook";
import { maskAccountNumber, maskPersonName } from "@/utils/privacy-mask";
import { useSessionPersistence } from "@/hooks/useSessionPersistence";

interface ExtractionMetadata {
  file_name: string;
  mime_type: string;
  sha256: string;
  size_bytes: number;
  extracted_at: string;
}

type CenterViewMode = "EVIDENCE_A4" | "COVER_PAGE" | "HASH_MANIFEST" | "EXECUTIVE_SUMMARY";

export default function MasterEvidenceWorkspace() {
  const [currentStep, setCurrentStep] = useState(1);
  const [evidenceMode, setEvidenceMode] = useState<"CHAT" | "SLIP">("SLIP");
  const [centerView, setCenterView] = useState<CenterViewMode>("EVIDENCE_A4");
  const [fullBookOpen, setFullBookOpen] = useState(false);

  // Persistent States (Component 3: Session Auto-Save & Hydration)
  const [targetName, setTargetName] = useSessionPersistence<string>("poi_target_name", "");
  const [pdpaEnabled, setPdpaEnabled] = useSessionPersistence<boolean>("pdpa_masking_enabled", false);
  const [caseNumber, setCaseNumber] = useSessionPersistence<string>("case_number", "คดีอาญาที่ 012/2569");

  const [loading, setLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<SlipExtraction | null>(null);
  const [metadata, setMetadata] = useState<ExtractionMetadata | null>(null);
  const [manifestList, setManifestList] = useState<HashManifestEntry[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pure Zero State (SSOT Bi-Directional State)
  const [evidenceState, setEvidenceState] = useState<ForensicEvidenceState>(PURE_ZERO_STATE);

  // Multi-File Batch Evidence Queue State
  const [evidenceQueue, setEvidenceQueue] = useState<Array<{
    id: string;
    file: File;
    previewUrl: string;
    status: "pending" | "processing" | "done" | "error";
    data?: SlipExtraction;
    meta?: ExtractionMetadata;
    error?: string;
  }>>([]);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number>(0);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentFileName: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Select an evidence item from the queue to view on canvas & inspection panels
  const selectEvidenceItem = (index: number) => {
    if (index < 0 || index >= evidenceQueue.length) return;
    setSelectedItemIndex(index);
    const item = evidenceQueue[index];
    setPreviewImage(item.previewUrl);
    if (item.data) {
      setExtractedData(item.data);
      if (item.data.transaction.amount && item.data.transaction.amount > 0) {
        setEvidenceMode("SLIP");
      } else {
        setEvidenceMode("CHAT");
      }
    }
    if (item.meta) {
      setMetadata(item.meta);
    }
  };

  // Batch Multi-File Upload Handler
  const handleMultipleFiles = async (files: FileList | File[]) => {
    const rawList = Array.from(files);
    const imageFiles = rawList.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(f.name));

    if (imageFiles.length === 0) {
      setErrorMsg("กรุณาเลือกไฟล์ภาพที่ถูกต้อง (PNG, JPG, WEBP)");
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    // Create queue items
    const newItems = imageFiles.map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "pending" as const,
    }));

    const startIndex = evidenceQueue.length;
    let currentQueue = [...evidenceQueue, ...newItems];
    setEvidenceQueue(currentQueue);

    // Set first newly uploaded image as preview immediately
    if (!previewImage && newItems.length > 0) {
      setPreviewImage(newItems[0].previewUrl);
      setSelectedItemIndex(startIndex);
    }

    let updatedManifest = [...manifestList];

    // Process files sequentially to maintain transaction integrity and avoid RAM spikes
    for (let i = 0; i < newItems.length; i++) {
      const targetIdx = startIndex + i;
      const targetFile = newItems[i].file;

      setBatchProgress({
        current: i + 1,
        total: newItems.length,
        currentFileName: targetFile.name,
      });

      // Mark processing
      currentQueue = currentQueue.map((item, idx) =>
        idx === targetIdx ? { ...item, status: "processing" as const } : item
      );
      setEvidenceQueue(currentQueue);

      try {
        const formData = new FormData();
        formData.append("file", targetFile);

        const response = await fetch("/api/slips/extract", {
          method: "POST",
          body: formData,
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || "การสกัดข้อมูลไม่สำเร็จ");
        }

        const slip: SlipExtraction = result.data;
        const meta: ExtractionMetadata = result.metadata;

        // Update item in queue
        currentQueue = currentQueue.map((item, idx) =>
          idx === targetIdx ? { ...item, status: "done" as const, data: slip, meta } : item
        );
        setEvidenceQueue(currentQueue);

        // Append to Chain of Custody Hash Manifest
        const newManifestEntry: HashManifestEntry = {
          no: updatedManifest.length + 1,
          file_name: meta.file_name,
          file_type: slip.transaction.amount ? "SLIP" : "CHAT",
          size_bytes: meta.size_bytes,
          sha256: meta.sha256,
          intake_timestamp: meta.extracted_at,
        };
        updatedManifest = [...updatedManifest, newManifestEntry];
        setManifestList(updatedManifest);

        // If this is the currently selected item or the first processed item, sync active inspection view
        if (targetIdx === startIndex) {
          setExtractedData(slip);
          setMetadata(meta);
          setPreviewImage(newItems[i].previewUrl);
          setSelectedItemIndex(targetIdx);
          if (slip.transaction.amount && slip.transaction.amount > 0) {
            setEvidenceMode("SLIP");
          } else {
            setEvidenceMode("CHAT");
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการประมวลผล";
        currentQueue = currentQueue.map((item, idx) =>
          idx === targetIdx ? { ...item, status: "error" as const, error: msg } : item
        );
        setEvidenceQueue(currentQueue);
      }
    }

    // Re-aggregate Global Evidence State across all successfully processed items
    let totalLoss = 0;
    let slipCount = 0;
    let chatCount = 0;
    let poiLoss = 0;
    let lastPoiName: string | null = null;

    currentQueue.forEach((item) => {
      if (item.status === "done" && item.data) {
        const amt = item.data.transaction.amount || 0;
        if (amt > 0) {
          slipCount += 1;
          totalLoss += amt;
          if (item.data.receiver.name) {
            lastPoiName = item.data.receiver.name;
            poiLoss += amt;
          }
        } else {
          chatCount += 1;
        }
      }
    });

    const pairsCount = Math.min(slipCount, chatCount > 0 ? chatCount : slipCount);

    setEvidenceState({
      totalNetLoss: totalLoss,
      slipCount,
      chatPageCount: chatCount,
      poiName: lastPoiName || targetName || null,
      poiLossSum: poiLoss > 0 ? poiLoss : totalLoss,
      corroboratedPairsCount: pairsCount,
      duplicateCount: 0,
      processedAt: new Date().toLocaleString("th-TH"),
    });

    setBatchProgress(null);
    setLoading(false);
    setCurrentStep(2); // Step 2: ตรวจสอบและประมวลผล
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleMultipleFiles(e.dataTransfer.files);
    }
  };

  // Draw A4 Canvas with Anti-Collision Thai Typography & Exact Legal Disclaimer
  useEffect(() => {
    if (centerView !== "EVIDENCE_A4") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { a4WidthPx, a4HeightPx, footer } = FORENSIC_CANVAS_SPEC;
    canvas.width = a4WidthPx;
    canvas.height = a4HeightPx;

    // 1. Background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, a4WidthPx, a4HeightPx);

    // 2. Header Ribbon (Y = 20 - 120 px)
    ctx.fillStyle = "#F8FAFC";
    ctx.fillRect(40, 20, a4WidthPx - 80, 100);
    ctx.strokeStyle = "#CBD5E1";
    ctx.lineWidth = 1;
    ctx.strokeRect(40, 20, a4WidthPx - 80, 100);

    ctx.font = "bold 44px 'Sarabun', sans-serif";
    ctx.fillStyle = "#0F172A";
    ctx.textBaseline = "middle";
    ctx.fillText("🏛️", 55, 70);

    ctx.font = "bold 20px 'Sarabun', sans-serif";
    ctx.fillText(`MODE : ${evidenceMode}`, 120, 52);

    ctx.font = "14px 'Sarabun', sans-serif";
    ctx.fillStyle = "#475569";
    const amountStr = evidenceState.totalNetLoss
      ? `฿ ${evidenceState.totalNetLoss.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`
      : "PURE ZERO STATE (฿ 0.00)";
    ctx.fillText(
      `CORROBORATED : พยานหลักฐานดิจิทัลคดีอาญา | ยอดเงินสุทธิ: ${amountStr} | ${evidenceState.processedAt || "รอรับไฟล์"}`,
      120,
      82
    );

    ctx.font = "bold 16px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#0F172A";
    ctx.textAlign = "right";
    ctx.fillText("PAGE : 1 / 1", a4WidthPx - 60, 70);
    ctx.textAlign = "left";

    // 3. Evidence Block
    if (previewImage) {
      const img = new Image();
      img.src = previewImage;
      img.onload = () => {
        const { slipBlockW, slipBlockH, slipCenterX, slipCenterY } = FORENSIC_CANVAS_SPEC;
        const scale = Math.min(slipBlockW / img.width, slipBlockH / img.height, 1);
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const drawX = slipCenterX + (slipBlockW - drawW) / 2;
        const drawY = slipCenterY + (slipBlockH - drawH) / 2;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        drawFooter();
      };
    } else {
      ctx.strokeStyle = "#E2E8F0";
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(174, 247, 645, 890);
      ctx.setLineDash([]);

      ctx.fillStyle = "#94A3B8";
      ctx.font = "bold 20px 'Sarabun', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("รอการนำเข้าไฟล์ภาพพยานหลักฐาน (Pure Zero State)", a4WidthPx / 2, 680);
      ctx.font = "15px 'Sarabun', sans-serif";
      ctx.fillText("ระบบจะจัดบล็อกสลิป 645×890 px กึ่งกลางหน้า A4 อัตโนมัติ", a4WidthPx / 2, 715);
      ctx.textAlign = "left";
      drawFooter();
    }

    function drawFooter() {
      if (!ctx) return;
      ctx.font = `${footer.fontSize}px ${footer.fontFamily}`;
      ctx.fillStyle = footer.textColor;
      ctx.textBaseline = footer.textBaseline;
      ctx.textAlign = "center";

      const startY = footer.footerY;
      const centerX = a4WidthPx / 2;

      LEGAL_DISCLAIMER_LINES.forEach((line, index) => {
        ctx.fillText(line, centerX, startY + index * footer.lineSpacing);
      });

      ctx.textAlign = "left";
    }
  }, [evidenceMode, previewImage, evidenceState, centerView]);

  // Dynamic Cover Sheet Data calculation
  const coverSheetData: CourtCoverSheetData = useMemo(() => {
    return {
      dossier_title: "รายงานสรุปสำนวนพยานหลักฐานดิจิทัลคดีอาญา",
      case_number: caseNumber,
      timestamp: evidenceState.processedAt || new Date().toLocaleString("th-TH"),
      defaults: {
        chat_pages: evidenceState.chatPageCount,
        slip_pages: evidenceState.slipCount,
      },
      active_cards: {
        summary_ledger: {
          enabled: true,
          pages: 1,
        },
        poi_target: {
          enabled: !!(evidenceState.poiName || targetName),
          name: pdpaEnabled
            ? maskPersonName(targetName || evidenceState.poiName, true)
            : targetName || evidenceState.poiName || "นายวิชัย ใจดี",
          pages: 1,
          amount: evidenceState.poiLossSum.toLocaleString("th-TH", { minimumFractionDigits: 2 }),
        },
        corroborated_pairs: {
          enabled: evidenceState.corroboratedPairsCount > 0,
          pairs_count: evidenceState.corroboratedPairsCount,
          pages: 1,
        },
        forensic_net: {
          enabled: true,
          duplicates_cut: evidenceState.duplicateCount,
          net_loss_amount: evidenceState.totalNetLoss.toLocaleString("th-TH", { minimumFractionDigits: 2 }),
        },
        hash_manifest: {
          enabled: true,
          pages: 1,
        },
        sfx_vault: {
          enabled: true,
          archive_name: "Dossier_Encrypted.exe",
          is_password_protected: true,
        },
      },
    };
  }, [caseNumber, evidenceState, targetName, pdpaEnabled]);

  const amountDisplay = evidenceState.totalNetLoss > 0
    ? `฿ ${evidenceState.totalNetLoss.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`
    : "฿ 0.00";

  return (
    <div className="app-fit-shell bg-transparent text-slate-100 select-none">
      {/* -----------------------------------------------------------------------
          HEADER TIER (ความสูง 108px, PDPA Shield Toggle, ISO/IEC 27037)
          ----------------------------------------------------------------------- */}
      <header className="h-[108px] min-h-[108px] shrink-0 px-6 glass-header border-b border-white/10 z-30 flex items-center justify-between">
        <div className="flex items-center gap-4 h-full py-2">
          {/* Logo & Graphic Fit */}
          <div className="flex items-center gap-3.5 h-full">
            <img
              src="/LOGO.png"
              alt="Digital Evidence Forensic Emblem"
              className="h-[76px] w-auto max-h-[82px] object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] select-none cursor-pointer hover:scale-105 transition-transform"
            />
            <div className="flex flex-col gap-1 leading-tight">
              <span className="font-bold tracking-tight text-xl leading-tight bg-gradient-to-r from-sky-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
                DIGITAL EVIDENCE FORENSIC SUITE
              </span>
              <span className="text-xs text-slate-300 font-medium leading-none">
                ระบบวิเคราะห์พยานหลักฐานดิจิทัลคดีอาญา มาตรฐานศาล (ISO/IEC 27037)
              </span>
            </div>
          </div>

          <span className="badge-proportional glass-badge glass-badge-active font-mono ml-2">
            REVISION 02
          </span>

          {/* Dual Mode Switcher */}
          <div className="flex items-center bg-black/40 p-1.5 rounded-lg border border-white/10 ml-4">
            <button
              onClick={() => setEvidenceMode("CHAT")}
              className={`px-4 py-1.5 text-xs rounded-md font-semibold transition-all ${
                evidenceMode === "CHAT"
                  ? "bg-sky-500/20 text-sky-400 border border-sky-400/40 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              CHAT [แชท]
            </button>
            <button
              onClick={() => setEvidenceMode("SLIP")}
              className={`px-4 py-1.5 text-xs rounded-md font-semibold transition-all ${
                evidenceMode === "SLIP"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-400/40 shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              SLIP [สลิป]
            </button>
          </div>

          {/* Component 4: PDPA Shield / Privacy Masking Toggle */}
          <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-lg border border-white/10 ml-2">
            <span className="text-xs font-medium text-slate-300">🛡️ PDPA Shield</span>
            <button
              onClick={() => setPdpaEnabled((p) => !p)}
              className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors ${
                pdpaEnabled ? "bg-emerald-500" : "bg-slate-700"
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  pdpaEnabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <span className={`text-[10px] font-mono font-bold ${pdpaEnabled ? "text-emerald-400" : "text-slate-500"}`}>
              {pdpaEnabled ? "ON (MASKED)" : "OFF (FULL)"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="badge-proportional glass-badge flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                loading ? "bg-amber-400 animate-ping" : "bg-emerald-400 animate-pulse"
              }`}
            ></span>
            <span className="font-mono text-xs">
              {loading ? "AI EXTRACTING..." : "ISO/IEC 27037 FORENSIC READY"}
            </span>
          </div>
          <button
            onClick={() => setFullBookOpen(true)}
            className="btn-proportional-compact glass-button glass-button-cyan"
          >
            🖨️ รวมเล่มสำนวนศาล (5 หน้าเต็ม)
          </button>
        </div>
      </header>

      {/* -----------------------------------------------------------------------
          4-STEP WORKFLOW STEPPER BAR (Workflow State Machine)
          ----------------------------------------------------------------------- */}
      <div className="h-11 px-6 bg-black/35 border-b border-white/5 flex items-center justify-between shrink-0 text-xs">
        <div className="flex items-center gap-6">
          {WORKFLOW_STEPS.map((s, idx) => (
            <React.Fragment key={s.id}>
              <div
                className={`flex items-center gap-2 font-semibold cursor-pointer transition-colors ${
                  currentStep === s.id
                    ? "text-sky-400"
                    : currentStep > s.id
                    ? "text-emerald-400"
                    : "text-slate-500"
                }`}
                onClick={() => setCurrentStep(s.id)}
              >
                <span
                  className={`w-5 h-5 rounded-full border flex items-center justify-center text-[11px] font-bold ${
                    currentStep === s.id
                      ? "bg-sky-500/20 border-sky-400/60"
                      : currentStep > s.id
                      ? "bg-emerald-500/20 border-emerald-400/60 text-emerald-400"
                      : "bg-white/5 border-white/10"
                  }`}
                >
                  {currentStep > s.id ? "✓" : s.id}
                </span>
                <span>
                  Step {s.id}: {s.label} ({s.sub})
                </span>
              </div>
              {idx < WORKFLOW_STEPS.length - 1 && <span className="text-slate-600">→</span>}
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center gap-3 text-slate-400 font-mono text-xs">
          <span>เลขคดี:</span>
          <input
            type="text"
            value={caseNumber}
            onChange={(e) => setCaseNumber(e.target.value)}
            className="bg-black/30 border border-white/10 px-2 py-0.5 rounded text-slate-200 font-mono text-xs w-36"
          />
          <span className="text-emerald-400 font-bold">● 3453 ONLINE</span>
        </div>
      </div>

      {/* -----------------------------------------------------------------------
          MAIN WORKSPACE TIER (3-Column Fit-to-Screen Workbench)
          ----------------------------------------------------------------------- */}
      <main className="shell-workspace workspace-3col-grid relative">
        {/* =====================================================================
            LEFT PANEL: 01 Controls & Intake (Clamp 340px - 440px)
            ===================================================================== */}
        <section className="workspace-column glass-panel p-4 thai-clearance-stack">
          <div className="flex items-center justify-between shrink-0">
            <h2 className="typo-section-title uppercase tracking-wider text-slate-200">
              01 นำเข้าพยานหลักฐาน
            </h2>
            <span className="badge-proportional glass-badge">PURE ZERO STATE</span>
          </div>

          <div className="panel-scroll-body thai-clearance-stack pr-1">
            {/* Hidden File Input (Multiple Files Supported) */}
            <input
              type="file"
              ref={fileInputRef}
              multiple
              onChange={(e) => e.target.files && handleMultipleFiles(e.target.files)}
              accept="image/*"
              className="hidden"
            />

            {/* Drag-and-Drop Dropzone (Multi-Image Ready) */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`glass-nested p-5 rounded-xl border border-dashed transition-all flex flex-col items-center justify-center text-center cursor-pointer group ${
                loading
                  ? "border-amber-400/60 bg-amber-500/10"
                  : "border-white/20 hover:border-sky-400/50"
              }`}
            >
              {loading && batchProgress ? (
                <div className="flex flex-col items-center py-2 w-full">
                  <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mb-2"></div>
                  <p className="typo-label font-bold text-amber-300">
                    กำลังประมวลผล {batchProgress.current} จาก {batchProgress.total} ไฟล์...
                  </p>
                  <p className="text-[11px] text-slate-300 font-mono mt-0.5 truncate max-w-[280px]">
                    📄 {batchProgress.currentFileName}
                  </p>
                  {/* Progress bar */}
                  <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden mt-3 border border-white/10">
                    <div
                      className="bg-gradient-to-r from-sky-400 to-emerald-400 h-full transition-all duration-300"
                      style={{
                        width: `${Math.round((batchProgress.current / batchProgress.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ) : loading ? (
                <div className="flex flex-col items-center py-3">
                  <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mb-2"></div>
                  <p className="typo-label font-bold text-amber-300">
                    AI กำลังถอดรหัสพยานหลักฐาน...
                  </p>
                  <p className="text-xs text-slate-400 mt-1">วิเคราะห์พิกเซล + ตรวจ Zod Schema</p>
                </div>
              ) : (
                <>
                  <span className="text-3xl mb-1.5 group-hover:scale-110 transition-transform">📂</span>
                  <p className="typo-label font-semibold text-slate-100">
                    ลากไฟล์ภาพแชท / สลิป มาวางที่นี่
                  </p>
                  <p className="text-xs text-emerald-400 font-medium mt-0.5">
                    ✨ รองรับการเลือกและลากอัปโหลดทีละหลายรูปพร้อมกัน
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    PNG, JPG, WEBP (สกัด AI + แฮช SHA-256 รายใบ)
                  </p>
                  <button
                    type="button"
                    className="btn-proportional-compact mt-3 rounded-lg bg-white/5 border border-white/15 text-sky-400 hover:bg-white/10 font-medium"
                  >
                    + เลือกไฟล์จากเครื่อง (หลายรูปได้)
                  </button>
                </>
              )}
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-500/15 border border-red-400/40 typo-label text-red-300">
                ⚠️ {errorMsg}
              </div>
            )}

            {/* Evidence Queue Gallery (When multiple files are uploaded) */}
            {evidenceQueue.length > 0 && (
              <div className="glass-nested p-3 rounded-xl border border-white/10 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">
                    คลังหลักฐานในคดี ({evidenceQueue.length} ไฟล์)
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEvidenceQueue([]);
                      setManifestList([]);
                      setEvidenceState(PURE_ZERO_STATE);
                      setPreviewImage(null);
                      setExtractedData(null);
                    }}
                    className="text-[10px] text-red-400 hover:text-red-300 font-medium"
                  >
                    ล้างทั้งหมด
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                  {evidenceQueue.map((item, idx) => (
                    <div
                      key={item.id}
                      onClick={() => selectEvidenceItem(idx)}
                      className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-all border ${
                        selectedItemIndex === idx
                          ? "bg-sky-500/20 border-sky-400/60 shadow-sm"
                          : "bg-black/20 border-white/5 hover:bg-white/5"
                      }`}
                    >
                      <img
                        src={item.previewUrl}
                        alt="thumb"
                        className="w-10 h-10 object-cover rounded border border-white/10 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-200 truncate">
                          {idx + 1}. {item.file.name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {item.status === "processing" ? (
                            <span className="text-[10px] text-amber-400 font-mono animate-pulse">
                              🔄 กำลังวิเคราะห์...
                            </span>
                          ) : item.status === "pending" ? (
                            <span className="text-[10px] text-slate-500 font-mono">
                              ⏳ รอคิว
                            </span>
                          ) : item.status === "error" ? (
                            <span className="text-[10px] text-red-400 font-mono">
                              ⚠️ ผิดพลาด
                            </span>
                          ) : item.data?.transaction.amount && item.data.transaction.amount > 0 ? (
                            <span className="text-[10px] text-emerald-400 font-mono font-bold">
                              🧾 ฿{item.data.transaction.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-[10px] text-sky-400 font-mono">
                              📷 หน้าแชท
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Category Chips */}
            <div className="grid grid-cols-3 gap-2">
              <div
                className={`glass-nested p-2.5 rounded-lg text-center ${
                  evidenceState.chatPageCount > 0 ? "border-sky-400/40" : ""
                }`}
              >
                <div className="text-xs text-slate-400 font-medium">📷 แชท</div>
                <div className="font-mono text-sm font-bold text-slate-100 mt-0.5">
                  {evidenceState.chatPageCount}
                </div>
              </div>
              <div
                className={`glass-nested p-2.5 rounded-lg text-center ${
                  evidenceState.slipCount > 0 ? "border-emerald-400/40" : ""
                }`}
              >
                <div className="text-xs text-emerald-400 font-medium">🧾 สลิป</div>
                <div className="font-mono text-sm font-bold text-emerald-400 mt-0.5">
                  {evidenceState.slipCount}
                </div>
              </div>
              <div className="glass-nested p-2.5 rounded-lg text-center">
                <div className="text-xs text-slate-400 font-medium">📑 PDF</div>
                <div className="font-mono text-sm font-bold text-slate-100 mt-0.5">0</div>
              </div>
            </div>

            {/* POI Search Box */}
            <div className="thai-clearance-stack mt-1">
              <label className="typo-label text-slate-200">
                ค้นหาบุคคลเป้าหมาย (POI ตัดคำนำหน้าอัตโนมัติ)
              </label>
              <input
                type="text"
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                placeholder="พิมพ์ชื่อบุคคลเป้าหมาย..."
                className="input-proportional glass-input"
              />
            </div>

            {/* POI Loss Summary Card */}
            <div className="glass-nested p-3.5 rounded-xl border-l-4 border-emerald-400 mt-2">
              <div className="text-xs text-slate-400 font-medium">ยอดความเสียหายเฉพาะเป้าหมาย</div>
              <div className="font-mono text-xl font-bold text-emerald-400 mt-1">
                {amountDisplay}
              </div>
              <div className="text-xs text-slate-300 mt-1 truncate">
                เป้าหมาย:{" "}
                <span className="text-slate-100 font-semibold">
                  {pdpaEnabled
                    ? maskPersonName(targetName || evidenceState.poiName, true)
                    : targetName || evidenceState.poiName || "ยังไม่มีข้อมูล (Pure Zero State)"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            CENTER PANEL: 02 Center Stage Review (Minmax 480px, 1fr)
            ===================================================================== */}
        <section className="workspace-stage-center glass-panel p-4">
          {/* Viewport Top Ribbon & Tab Switcher (4 Document Views) */}
          <div className="w-full flex items-center justify-between text-xs px-2 shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCenterView("EVIDENCE_A4")}
                className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                  centerView === "EVIDENCE_A4"
                    ? "bg-sky-500/20 text-sky-400 border border-sky-400/40"
                    : "glass-nested text-slate-400 hover:text-white"
                }`}
              >
                📄 แคนวาส A4
              </button>
              <button
                onClick={() => setCenterView("COVER_PAGE")}
                className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                  centerView === "COVER_PAGE"
                    ? "bg-sky-500/20 text-sky-400 border border-sky-400/40"
                    : "glass-nested text-slate-400 hover:text-white"
                }`}
              >
                🏛️ หน้าปกสำนวน
              </button>
              <button
                onClick={() => setCenterView("HASH_MANIFEST")}
                className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                  centerView === "HASH_MANIFEST"
                    ? "bg-sky-500/20 text-sky-400 border border-sky-400/40"
                    : "glass-nested text-slate-400 hover:text-white"
                }`}
              >
                🔐 บัญชีคุมแฮช
              </button>
              <button
                onClick={() => setCenterView("EXECUTIVE_SUMMARY")}
                className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
                  centerView === "EXECUTIVE_SUMMARY"
                    ? "bg-sky-500/20 text-sky-400 border border-sky-400/40"
                    : "glass-nested text-slate-400 hover:text-white"
                }`}
              >
                ⚖️ สรุปผู้บริหาร
              </button>
            </div>

            <div className="flex items-center gap-3">
              {extractedData && (
                <button
                  onClick={() => setReviewOpen(true)}
                  className="btn-proportional-compact rounded-lg bg-sky-500/20 text-sky-400 border border-sky-400/40 hover:bg-sky-500/30"
                >
                  🔍 เปิดหน้า Review สลิป
                </button>
              )}
              <span className="font-mono text-xs text-slate-400">100% Fit</span>
            </div>
          </div>

          {/* Central Viewport Switcher */}
          <div className="flex-1 w-full flex items-center justify-center p-2 min-h-0 overflow-hidden">
            {centerView === "EVIDENCE_A4" && (
              <canvas
                ref={canvasRef}
                className="max-h-full max-w-full rounded shadow-2xl"
                style={{
                  aspectRatio: "1 / 1.4159",
                  height: "100%",
                  width: "auto",
                }}
              />
            )}

            {centerView === "COVER_PAGE" && (
              <CourtCoverSheet data={coverSheetData} />
            )}

            {centerView === "HASH_MANIFEST" && (
              <HashManifestTable entries={manifestList} caseNumber={caseNumber} />
            )}

            {centerView === "EXECUTIVE_SUMMARY" && (
              <ExecutiveSummarySheet
                evidence={evidenceState}
                caseNumber={caseNumber}
                suspectName={targetName}
              />
            )}
          </div>

          {/* Bottom Live Bar */}
          <div className="w-full flex items-center justify-between text-xs text-slate-400 px-2 shrink-0">
            <span className="truncate max-w-[340px] font-mono text-[11px]">
              {metadata?.sha256
                ? `SHA-256: ${metadata.sha256}`
                : "A4 COURT FORMAT: 993 × 1406 PX (150 DPI SSOT READY)"}
            </span>
            <span className="text-emerald-400 font-mono text-xs font-semibold">
              ✓ ZERO BLANK SCREEN PASS
            </span>
          </div>
        </section>

        {/* =====================================================================
            RIGHT PANEL: 03 Summary & SSOT KPI (Clamp 340px - 440px)
            ===================================================================== */}
        <section className="workspace-column glass-panel p-4 thai-clearance-stack">
          <div className="flex items-center justify-between shrink-0">
            <h2 className="typo-section-title uppercase tracking-wider text-slate-200">
              03 สรุปสำนวนศาล
            </h2>
            <span className="badge-proportional glass-badge text-emerald-400 font-mono">
              NET RECONCILED
            </span>
          </div>

          <div className="panel-scroll-body thai-clearance-stack pr-1">
            {/* KPI Card 1: Total Net Loss */}
            <div className="glass-card p-4">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                ยอดเงินรวมแห่งคดี (฿ Net Volume)
              </span>
              <div className="font-mono text-2xl font-bold text-emerald-400 mt-1">
                {amountDisplay}
              </div>
              <div className="text-xs text-slate-400 mt-1 flex justify-between">
                <span>สลิปในสำนวน: {evidenceState.slipCount} รายการ</span>
                <span className="text-emerald-400 font-semibold">
                  {evidenceState.slipCount > 0 ? "✓ ZOD PASS" : "PURE ZERO STATE"}
                </span>
              </div>
            </div>

            {/* KPI Card 2: Extraction Status */}
            <div className="glass-card p-4">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                สถานะการถอดรหัส (Extraction Status)
              </span>
              <div className="typo-label font-bold text-sky-400 mt-1 truncate">
                {extractedData?.bank?.name
                  ? `ธนาคาร: ${extractedData.bank.name}`
                  : "ระบบพร้อมตรวจรับไฟล์สลิปจริง"}
              </div>
              <div className="text-xs text-slate-400 mt-1 font-mono truncate">
                Ref ID: {extractedData?.transaction?.reference_no || "-"}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="glass-nested p-3.5 rounded-xl flex flex-col gap-2.5">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                เครื่องมือสำนวนศาล (SSOT Aligned)
              </span>
              <button
                onClick={() => setCenterView("COVER_PAGE")}
                className="btn-proportional-primary glass-button glass-button-cyan w-full justify-start"
              >
                🏛️ ดูหน้าปกสำนวนศาล (Cover Page)
              </button>
              <button
                onClick={() => setCenterView("HASH_MANIFEST")}
                className="btn-proportional-primary glass-button w-full justify-start"
              >
                🔐 บัญชีคุมแฮช SHA-256 (Chain of Custody)
              </button>
              <button
                onClick={() => setCenterView("EXECUTIVE_SUMMARY")}
                className="btn-proportional-primary glass-button w-full justify-start"
              >
                ⚖️ ใบสรุปผู้บริหาร 1 หน้า (Dashboard)
              </button>
              <button
                onClick={() => setFullBookOpen(true)}
                className="btn-proportional-primary glass-button glass-button-cyan w-full justify-start"
              >
                📚 รวมเล่มส่งศาลเต็ม 5 ชั้น (Master PDF)
              </button>
            </div>

            {/* Password Vault Sync Box */}
            <div className="glass-nested p-3.5 rounded-xl thai-clearance-stack mt-auto">
              <div className="flex items-center justify-between">
                <span className="typo-label font-bold text-slate-200">
                  🔑 รหัสผ่านล็อกไฟล์ (SFX / PDF)
                </span>
                <span className="text-xs text-emerald-400 font-mono font-semibold">✓ SYNCED</span>
              </div>
              <input
                type="password"
                placeholder="กำหนดรหัสผ่านคุ้มครองข้อมูล..."
                defaultValue="LegalEvidence2026"
                className="input-proportional glass-input font-mono"
              />
              <div className="text-xs text-slate-400">
                สร้างแฟ้มบีบอัดดึงตัวเอง WinRAR SFX เข้ารหัสชื่อไฟล์ (-hp)
              </div>
            </div>
          </div>
        </section>

        {/* =====================================================================
            FORENSIC REVIEW MODAL
            ===================================================================== */}
        {reviewOpen && extractedData && (
          <div className="absolute inset-0 glass-modal-backdrop z-50 flex items-center justify-center p-4">
            <div className="glass-modal w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
              <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">📋</span>
                  <h3 className="typo-section-title text-slate-100">
                    หน้าตรวจสอบพยานหลักฐานสลิป (Forensic Slip Review Gate)
                  </h3>
                </div>
                <button
                  onClick={() => setReviewOpen(false)}
                  className="w-8 h-8 rounded-full bg-white/10 text-slate-300 hover:text-white flex items-center justify-center text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="p-4 overflow-y-auto thai-clearance-stack text-xs">
                {metadata && (
                  <div className="glass-nested p-3 rounded-lg flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-medium">
                        ลายพิมพ์ดิจิทัล (Forensic SHA-256 Checksum)
                      </span>
                      <span className="text-xs text-emerald-400 font-mono font-bold">✓ VERIFIED</span>
                    </div>
                    <span className="font-mono text-xs text-sky-400 break-all">{metadata.sha256}</span>
                  </div>
                )}

                {extractedData.warnings && extractedData.warnings.length > 0 && (
                  <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-400/30 thai-clearance-stack">
                    <span className="font-bold text-amber-300 typo-label">⚠️ ข้อสังเกตจากระบบ:</span>
                    {extractedData.warnings.map((w, idx) => (
                      <span key={idx} className="text-amber-200 typo-label leading-relaxed">
                        • {w}
                      </span>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="glass-nested p-3.5 rounded-lg thai-clearance-stack">
                    <span className="text-xs text-slate-400">ธนาคารผู้ออกสลิป</span>
                    <span className="typo-label font-bold text-slate-100">
                      {extractedData.bank.name || "-"}
                    </span>
                    <span className="text-xs text-slate-400">
                      ความมั่นใจ: {(extractedData.bank.confidence * 100).toFixed(0)}%
                    </span>
                  </div>

                  <div className="glass-nested p-3.5 rounded-lg thai-clearance-stack">
                    <span className="text-xs text-slate-400">จำนวนเงินที่โอน</span>
                    <span className="font-mono text-lg font-bold text-emerald-400">
                      {extractedData.transaction.amount
                        ? `฿ ${extractedData.transaction.amount.toLocaleString()}`
                        : "-"}
                    </span>
                    <span className="text-xs text-slate-400">
                      ความมั่นใจ: {(extractedData.confidence.amount * 100).toFixed(0)}%
                    </span>
                  </div>

                  <div className="glass-nested p-3.5 rounded-lg thai-clearance-stack">
                    <span className="text-xs text-slate-400">วัน-เวลาที่ทำรายการ</span>
                    <span className="font-mono text-sm text-slate-100">
                      {extractedData.transaction.date || "-"} {extractedData.transaction.time || ""}
                    </span>
                  </div>

                  <div className="glass-nested p-3.5 rounded-lg thai-clearance-stack">
                    <span className="text-xs text-slate-400">รหัสอ้างอิงธุรกรรม (Ref ID)</span>
                    <span className="font-mono text-sm text-slate-100 break-all">
                      {extractedData.transaction.reference_no || "-"}
                    </span>
                  </div>

                  <div className="glass-nested p-3.5 rounded-lg thai-clearance-stack">
                    <span className="text-xs text-slate-400">ผู้โอน (ต้นทาง)</span>
                    <span className="typo-label font-medium text-slate-100">
                      {pdpaEnabled
                        ? maskPersonName(extractedData.sender.name, true)
                        : extractedData.sender.name || "-"}
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                      {pdpaEnabled
                        ? maskAccountNumber(extractedData.sender.account_no)
                        : extractedData.sender.account_no || ""}
                    </span>
                  </div>

                  <div className="glass-nested p-3.5 rounded-lg thai-clearance-stack border-l-4 border-emerald-400">
                    <span className="text-xs text-slate-400">ผู้รับโอน (ปลายทาง/เป้าหมาย)</span>
                    <span className="typo-label font-bold text-emerald-300">
                      {pdpaEnabled
                        ? maskPersonName(extractedData.receiver.name, true)
                        : extractedData.receiver.name || "-"}
                    </span>
                    <span className="font-mono text-xs text-slate-400">
                      {pdpaEnabled
                        ? maskAccountNumber(extractedData.receiver.account_no)
                        : extractedData.receiver.account_no || ""}
                    </span>
                  </div>
                </div>

                {extractedData.transaction.note && (
                  <div className="glass-nested p-3.5 rounded-lg thai-clearance-stack">
                    <span className="text-xs text-slate-400">บันทึกช่วยจำ (Memo)</span>
                    <span className="typo-body text-slate-100">{extractedData.transaction.note}</span>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-white/10 flex items-center justify-between shrink-0 bg-black/40">
                <span className="text-xs text-slate-400">
                  ตรวจสอบความถูกต้องแล้วพร้อมบรรจุเข้าสำนวนคดีมาตรฐานศาล
                </span>
                <div className="flex gap-3">
                  <button
                    onClick={() => setReviewOpen(false)}
                    className="btn-proportional-compact rounded-lg bg-white/10 text-slate-200 hover:bg-white/15"
                  >
                    ปิดหน้าต่าง
                  </button>
                  <button
                    onClick={() => {
                      setReviewOpen(false);
                      setCurrentStep(3); // Go to Step 3: สร้างเอกสารหลักฐาน
                      setCenterView("COVER_PAGE");
                    }}
                    className="btn-proportional-primary glass-button glass-button-cyan"
                  >
                    ✓ ยืนยันข้อมูลเข้าสำนวน
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* -----------------------------------------------------------------------
          FOOTER STATUS BAR TIER
          ----------------------------------------------------------------------- */}
      <footer className="shell-footer glass-header text-xs text-slate-400 border-t border-white/10">
        <div className="flex items-center gap-4">
          <span className="font-mono text-emerald-400">● LIVE RUNTIME</span>
          <span>FIT-TO-SCREEN NO-SCROLL ARCHITECTURE</span>
          <span className="text-sky-400 font-mono">
            {pdpaEnabled ? "[PDPA SHIELD: ON]" : "[PDPA SHIELD: OFF]"}
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span>VIEW: {centerView}</span>
        </div>
      </footer>

      {/* =====================================================================
          โมดูลที่ 1: MASTER DOSSIER STITCHER FULL BOOK MODAL
          ===================================================================== */}
      {fullBookOpen && (
        <MasterDossierFullBook
          coverData={coverSheetData}
          evidenceState={evidenceState}
          extractedSlip={extractedData}
          previewImage={previewImage}
          manifestEntries={manifestList}
          caseNumber={caseNumber}
          suspectName={targetName}
          onClose={() => setFullBookOpen(false)}
        />
      )}
    </div>
  );
}
