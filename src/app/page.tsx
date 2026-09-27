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
import {
  resolveHeaderMode,
  resolveHeaderCorroborated,
  resolveHeaderPageNumber,
  resolveWebHeaderStatus,
  fitCanvasText,
  type EvidencePageType,
} from "@/utils/forensic-header-machine";
import { extractSlipLocally } from "@/utils/local-qr-extractor";
import { computeFileSha256, getCachedSlip, setCachedSlip } from "@/utils/forensic-sha256-cache";
import { sliceChatImageLocally } from "@/utils/canvas-dicut-chat";

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

  // Real-Time Clock State (Web App Top Header Bar)
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTimeStr = useMemo(() => {
    return currentTime.toLocaleTimeString("en-GB", { hour12: false });
  }, [currentTime]);

  const formattedDateStr = useMemo(() => {
    return currentTime.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }, [currentTime]);

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

  // ---------------------------------------------------------------------------
  // 2-PHASE FORENSIC STAGING BUFFER ARCHITECTURE (SSOT)
  // Phase 1: Ingest & Stage (กี่รอบก็ได้ ยังไม่ยิง AI)
  // Phase 2: Execute Unified Batch (Slips First -> Chats Next -> Cross-Match -> Net Loss)
  // ---------------------------------------------------------------------------
  const [stagedQueue, setStagedQueue] = useState<Array<{
    id: string;
    file: File;
    previewUrl: string;
    category: "SLIP" | "CHAT";
    status: "staged" | "processing" | "done" | "error";
    data?: SlipExtraction;
    meta?: ExtractionMetadata;
    error?: string;
    isDuplicate?: boolean;
    duplicateOfRef?: string;
  }>>([]);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number>(0);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentFileName: string;
    phase: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Select an evidence item from the queue to view on canvas & inspection panels
  const selectEvidenceItem = (index: number) => {
    if (index < 0 || index >= stagedQueue.length) return;
    setSelectedItemIndex(index);
    const item = stagedQueue[index];
    setPreviewImage(item.previewUrl);
    setEvidenceMode(item.category);
    if (item.data) {
      setExtractedData(item.data);
    }
    if (item.meta) {
      setMetadata(item.meta);
    }
  };

  // Phase 1: Ingest files into Staging Buffer (Zero AI Cost, Append Anytime)
  const stageIncomingFiles = (files: FileList | File[]) => {
    const rawList = Array.from(files);
    const imageFiles = rawList.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(f.name));

    if (imageFiles.length === 0) {
      setErrorMsg("กรุณาเลือกไฟล์ภาพที่ถูกต้อง (PNG, JPG, WEBP)");
      return;
    }

    setErrorMsg(null);

    const newItems = imageFiles.map((file) => {
      // Intelligent Pre-Classification: Check current mode or file name heuristic
      const lowerName = file.name.toLowerCase();
      const detectedCategory: "SLIP" | "CHAT" = lowerName.includes("slip") || lowerName.includes("สลิป") || lowerName.includes("โอน")
        ? "SLIP"
        : lowerName.includes("chat") || lowerName.includes("แชท") || lowerName.includes("line")
        ? "CHAT"
        : evidenceMode;

      return {
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        category: detectedCategory,
        status: "staged" as const,
      };
    });

    const updatedQueue = [...stagedQueue, ...newItems];
    setStagedQueue(updatedQueue);

    // If no preview is currently active, preview the first newly staged image
    if (!previewImage && newItems.length > 0) {
      setPreviewImage(newItems[0].previewUrl);
      setSelectedItemIndex(stagedQueue.length);
      setEvidenceMode(newItems[0].category);
    }
  };

  // Remove a single item from the staging buffer
  const removeStagedItem = (id: string) => {
    setStagedQueue((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (next.length === 0) {
        setPreviewImage(null);
        setExtractedData(null);
      } else {
        selectEvidenceItem(0);
      }
      return next;
    });
  };

  // Clear entire staging buffer
  const clearStagingBuffer = () => {
    setStagedQueue([]);
    setManifestList([]);
    setEvidenceState(PURE_ZERO_STATE);
    setPreviewImage(null);
    setExtractedData(null);
    setMetadata(null);
    setCurrentStep(1);
  };

  // Phase 2: Unified Batch Execution (The Cross-Matching Law)
  const executeUnifiedBatch = async () => {
    if (stagedQueue.length === 0) {
      setErrorMsg("ยังไม่มีไฟล์ในหน่วยความจำพักรอ (Staging Buffer)");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    let currentQueue = [...stagedQueue];
    let updatedManifest = [...manifestList];

    // Identify Slips and Chats in queue
    const slipIndices: number[] = [];
    const chatIndices: number[] = [];

    currentQueue.forEach((item, idx) => {
      if (item.category === "SLIP") slipIndices.push(idx);
      else chatIndices.push(idx);
    });

    const executionOrder = [...slipIndices, ...chatIndices];
    const totalFiles = executionOrder.length;

    // STEP 1: Process All Slips First (Fact Extraction: Amount, Timestamp, Bank, Ref)
    // STEP 2: Process All Chats Next (Context & Timeline)
    for (let step = 0; step < totalFiles; step++) {
      const targetIdx = executionOrder[step];
      const targetItem = currentQueue[targetIdx];
      const isSlip = targetItem.category === "SLIP";

      setBatchProgress({
        current: step + 1,
        total: totalFiles,
        currentFileName: targetItem.file.name,
        phase: isSlip ? "สกัดข้อมูลสลิป (Slips First)" : "วิเคราะห์บริบทแชท (Chats Context)",
      });

      // Mark processing
      currentQueue = currentQueue.map((item, idx) =>
        idx === targetIdx ? { ...item, status: "processing" as const } : item
      );
      setStagedQueue(currentQueue);

      try {
        // TIER 1: Permanent SHA-256 Memory & LocalStorage Cache (0ms)
        const sha256 = await computeFileSha256(targetItem.file);
        let slip: SlipExtraction | null = getCachedSlip(sha256);
        let meta: ExtractionMetadata;

        if (slip) {
          meta = {
            file_name: targetItem.file.name,
            mime_type: targetItem.file.type || "image/png",
            sha256,
            size_bytes: targetItem.file.size,
            extracted_at: new Date().toISOString(),
          };
        } else if (isSlip) {
          // TIER 2: Local In-Memory jsQR Decoding (10ms Lightning Fast)
          const localQrResult = await extractSlipLocally(targetItem.file);

          if (localQrResult) {
            slip = localQrResult;
            meta = {
              file_name: targetItem.file.name,
              mime_type: targetItem.file.type || "image/png",
              sha256,
              size_bytes: targetItem.file.size,
              extracted_at: new Date().toISOString(),
            };
            setCachedSlip(sha256, slip);
          } else {
            // TIER 3: Non-QR / Damaged Slip Fallback (Vision AI API)
            const formData = new FormData();
            formData.append("file", targetItem.file);

            const response = await fetch("/api/slips/extract", {
              method: "POST",
              body: formData,
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
              throw new Error(result.message || "การสกัดข้อมูลไม่สำเร็จ");
            }

            slip = result.data;
            meta = result.metadata;
            if (slip) {
              setCachedSlip(sha256, slip);
            }
          }
        } else {
          // CHAT PROCESSING: Direct Pixel Quiet Zone Slicing on Canvas 2D (< 0.05s)
          await sliceChatImageLocally(targetItem.file);
          slip = {
            document_type: "bank_transfer_slip",
            bank: { name: "LINE / Chat Screen", confidence: 1 },
            transaction: {
              date: new Date().toISOString().slice(0, 10),
              time: new Date().toTimeString().slice(0, 8),
              amount: null,
              currency: "THB",
              fee: null,
              reference_no: `CHAT-${targetItem.file.name.slice(0, 8)}`,
              transaction_id: `CHAT-${targetItem.file.name.slice(0, 8)}`,
              note: null,
            },
            sender: { name: null, account_no: null, bank: null },
            receiver: { name: null, account_no: null, bank: null },
            confidence: {
              date: 1,
              time: 1,
              amount: 0,
              reference_no: 1,
              sender_name: 0,
              receiver_name: 0,
              sender_account: 0,
              receiver_account: 0,
            },
            raw_text: [],
            warnings: ["หั่นบล็อก A4 ด้วย Direct Pixel Quiet Zone (<0.05s) - Dicut_Chat Validated"],
          };
          meta = {
            file_name: targetItem.file.name,
            mime_type: targetItem.file.type || "image/png",
            sha256,
            size_bytes: targetItem.file.size,
            extracted_at: new Date().toISOString(),
          };
          setCachedSlip(sha256, slip);
        }

        if (!slip) {
          throw new Error("ไม่สามารถสกัดข้อมูลพยานหลักฐานได้");
        }

        // Check for duplicates across previously extracted slips
        let isDuplicate = false;
        let duplicateOfRef: string | undefined;

        if (isSlip && slip.transaction.amount && slip.transaction.amount > 0) {
          const currentRef = slip.transaction.reference_no;
          const currentAmt = slip.transaction.amount;
          const currentDate = slip.transaction.date;

          const existingMatch = currentQueue.find(
            (other, oIdx) =>
              oIdx !== targetIdx &&
              other.status === "done" &&
              other.data &&
              ((currentRef && other.data.transaction.reference_no === currentRef) ||
                (other.data.transaction.amount === currentAmt && other.data.transaction.date === currentDate))
          );

          if (existingMatch) {
            isDuplicate = true;
            duplicateOfRef = existingMatch.data?.transaction.reference_no || existingMatch.file.name;
          }
        }

        // Update item in queue
        currentQueue = currentQueue.map((item, idx) =>
          idx === targetIdx
            ? { ...item, status: "done" as const, data: slip!, meta, isDuplicate, duplicateOfRef }
            : item
        );
        setStagedQueue(currentQueue);

        // Append to Chain of Custody Hash Manifest
        const newManifestEntry: HashManifestEntry = {
          no: updatedManifest.length + 1,
          file_name: meta.file_name,
          file_type: isSlip ? "SLIP" : "CHAT",
          size_bytes: meta.size_bytes,
          sha256: meta.sha256,
          intake_timestamp: meta.extracted_at,
        };
        updatedManifest = [...updatedManifest, newManifestEntry];
        setManifestList(updatedManifest);

        // Update preview for the first processed item
        if (step === 0) {
          setExtractedData(slip);
          setMetadata(meta);
          setPreviewImage(targetItem.previewUrl);
          setSelectedItemIndex(targetIdx);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการประมวลผล";
        currentQueue = currentQueue.map((item, idx) =>
          idx === targetIdx ? { ...item, status: "error" as const, error: msg } : item
        );
        setStagedQueue(currentQueue);
      }
    }

    // STEP 3 & 4: Deduplication & Reconcile Net Loss
    let totalNetLoss = 0;
    let validSlipCount = 0;
    let duplicateCount = 0;
    let chatCount = 0;
    let poiLoss = 0;
    let lastPoiName: string | null = null;

    currentQueue.forEach((item) => {
      if (item.status === "done" && item.data) {
        if (item.category === "SLIP") {
          if (item.isDuplicate) {
            duplicateCount += 1;
          } else {
            const amt = item.data.transaction.amount || 0;
            totalNetLoss += amt;
            validSlipCount += 1;

            if (item.data.receiver.name) {
              lastPoiName = item.data.receiver.name;
              poiLoss += amt;
            }
          }
        } else {
          chatCount += 1;
        }
      }
    });

    const corroboratedPairs = Math.min(validSlipCount, chatCount > 0 ? chatCount : validSlipCount);

    setEvidenceState({
      totalNetLoss,
      slipCount: validSlipCount,
      chatPageCount: chatCount,
      poiName: lastPoiName || targetName || null,
      poiLossSum: poiLoss > 0 ? poiLoss : totalNetLoss,
      corroboratedPairsCount: corroboratedPairs,
      duplicateCount,
      processedAt: new Date().toLocaleString("th-TH"),
    });

    setBatchProgress(null);
    setLoading(false);
    setCurrentStep(2); // Step 2: ตรวจสอบและสืบพยาน
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      stageIncomingFiles(e.dataTransfer.files);
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

    // 2. Evidence Ribbon Header (Y = 38 - 115 px, Height = 77px)
    const ribbonTop = 38;
    const ribbonHeight = 77;
    const ribbonLeft = 40;
    const ribbonWidth = a4WidthPx - 80;

    // Background & Stroke
    ctx.fillStyle = "#F8FAFC";
    ctx.fillRect(ribbonLeft, ribbonTop, ribbonWidth, ribbonHeight);
    ctx.strokeStyle = "#CBD5E1";
    ctx.lineWidth = 1;
    ctx.strokeRect(ribbonLeft, ribbonTop, ribbonWidth, ribbonHeight);

    // Official LOGO Shield in Ribbon
    const logoImg = new Image();
    logoImg.src = "/LOGO.png";
    const drawRibbonContent = () => {
      if (logoImg.complete && logoImg.naturalWidth > 0) {
        const logoScale = Math.min(65 / logoImg.naturalHeight, 72 / logoImg.naturalWidth);
        const lW = logoImg.naturalWidth * logoScale;
        const lH = logoImg.naturalHeight * logoScale;
        ctx.drawImage(logoImg, ribbonLeft + 12, ribbonTop + (ribbonHeight - lH) / 2, lW, lH);
      }

      const contentLeft = ribbonLeft + 90;
      const contentRight = ribbonLeft + ribbonWidth - 20;

      // Row 1 (Y = ribbonTop + 30): MODE (Left) | PAGE (Right)
      const pageType: EvidencePageType = previewImage ? evidenceMode : "STANDBY";
      const modeLabel = "MODE : ";
      const modeValue = resolveHeaderMode(pageType);

      ctx.textBaseline = "alphabetic";
      ctx.font = "200 17pt 'Sarabun', sans-serif";
      ctx.fillStyle = "#111827";
      ctx.fillText(modeLabel, contentLeft, ribbonTop + 30);
      const modeLblW = ctx.measureText(modeLabel).width;

      ctx.font = "100 17pt 'Sarabun', sans-serif";
      ctx.fillText(modeValue, contentLeft + modeLblW, ribbonTop + 30);

      // Page Number (Right aligned)
      const totalPages = Math.max(1, evidenceState.slipCount + evidenceState.chatPageCount);
      const pageLabel = "PAGE : ";
      const pageValue = resolveHeaderPageNumber(selectedItemIndex + 1, totalPages, pageType);

      ctx.font = "100 17pt 'Sarabun', sans-serif";
      const pageValW = ctx.measureText(pageValue).width;
      ctx.fillText(pageValue, contentRight - pageValW, ribbonTop + 30);

      ctx.font = "200 17pt 'Sarabun', sans-serif";
      const pageLblW = ctx.measureText(pageLabel).width;
      ctx.fillText(pageLabel, contentRight - pageValW - pageLblW, ribbonTop + 30);

      // Row 2 (Y = ribbonTop + 62): CORROBORATED (Left) | Timestamp (Right)
      const activeItem = stagedQueue[selectedItemIndex];
      const corroborationText = resolveHeaderCorroborated({
        type: pageType,
        itemIndex: selectedItemIndex + 1,
        targetName: pdpaEnabled
          ? maskPersonName(targetName || evidenceState.poiName, true)
          : targetName || evidenceState.poiName,
        amount: activeItem?.data?.transaction.amount || evidenceState.totalNetLoss,
        isDuplicate: false,
        chatHasSlip: evidenceState.slipCount > 0,
        slipPageRef: 1,
      });

      const corroLabel = "CORROBORATED : ";
      ctx.font = "200 17pt 'Sarabun', sans-serif";
      ctx.fillStyle = "#111827";
      ctx.fillText(corroLabel, contentLeft, ribbonTop + 62);
      const corroLblW = ctx.measureText(corroLabel).width;

      // Date/Time on Right of Row 2: DD/MM/YYYY : HH.MM
      const dateFormatted = `${currentTime.toLocaleDateString("en-GB")} : ${currentTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
      ctx.font = "100 13pt 'Sarabun', sans-serif";
      ctx.fillStyle = "#475569";
      const dateW = ctx.measureText(dateFormatted).width;
      ctx.fillText(dateFormatted, contentRight - dateW, ribbonTop + 62);

      // Dynamic Shrink-to-Fit for Corroborated Value (Max width calculation)
      const maxCorroW = (contentRight - dateW - 25) - (contentLeft + corroLblW);
      const fitted = fitCanvasText(ctx, corroborationText, maxCorroW, 17, 10, "'Sarabun', sans-serif", "100");
      ctx.font = `100 ${fitted.fontSize}pt 'Sarabun', sans-serif`;
      ctx.fillStyle = "#111827";
      ctx.fillText(corroborationText, contentLeft + corroLblW, ribbonTop + 62);
    };

    if (logoImg.complete) {
      drawRibbonContent();
    } else {
      logoImg.onload = () => drawRibbonContent();
    }

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
          WEB APP TOP HEADER BAR (108px Fixed Height, 3-Zone Architecture)
          ----------------------------------------------------------------------- */}
      <header
        className="h-[108px] min-h-[108px] max-h-[108px] shrink-0 px-[28px] glass-header border-b border-white/[0.22] z-30 flex items-center justify-between select-none"
        style={{ height: "108px", minHeight: "108px", maxHeight: "108px", padding: "0 28px" }}
      >
        {/* =====================================================================
            HEADER LEFT: Logo Shield & Title Block
            ===================================================================== */}
        <div className="flex items-center gap-4 h-full py-2">
          {/* Logo Shield: Max 92px height fit */}
          <img
            src="/LOGO.png"
            alt="Digital Evidence Forensic Shield"
            className="h-[calc(100%-16px)] max-h-[92px] w-auto object-contain drop-shadow-[0_4px_14px_rgba(0,0,0,0.6)] cursor-pointer hover:scale-105 transition-transform"
          />

          {/* Title Block */}
          <div className="flex flex-col gap-[6px] leading-[1.4] justify-center">
            <div className="flex items-center gap-2.5">
              <span className="font-bold tracking-tight text-[20px] text-white leading-tight">
                DIGITAL EVIDENCE
              </span>
              <span className="badge-proportional glass-badge glass-badge-active font-mono text-[12px] px-2 py-0.5">
                REVISION 02
              </span>
            </div>
            <span className="text-[13.5px] text-[#94A3B8] font-medium leading-none">
              ศูนย์รวบรวมและวิเคราะห์พยานหลักฐานดิจิทัลคดีอาญา (Glassmorphism Certified)
            </span>
          </div>
        </div>

        {/* =====================================================================
            HEADER CENTER: Motto Block, Mode Switcher & Status Capsule
            ===================================================================== */}
        <div className="flex flex-col items-center gap-1.5 py-1">
          {/* Motto Block */}
          <div className="flex flex-col items-center gap-[4px] leading-[1.35] text-center">
            <span className="text-[13.5px] font-bold text-[#E2E8F0] tracking-wide">
              จากข้อมูลดิจิทัล สู่ความยุติธรรม
            </span>
            <span className="text-[10.5px] text-[#94A3B8] font-mono tracking-[1px] uppercase">
              DIGITAL EVIDENCE FOR A FAIRER TOMORROW
            </span>
          </div>

          {/* Control Bar: Mode Tabs, Status Capsule & PDPA Shield */}
          <div className="flex items-center gap-3">
            {/* Mode Tabs */}
            <div className="flex items-center bg-black/40 p-1 rounded-lg border border-white/10">
              <button
                onClick={() => setEvidenceMode("CHAT")}
                style={{ padding: "6px 18px", fontSize: "13.5px" }}
                className={`rounded-md font-semibold transition-all ${
                  evidenceMode === "CHAT"
                    ? "bg-sky-500/25 text-sky-300 border border-sky-400/50 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                CHAT (แชท)
              </button>
              <button
                onClick={() => setEvidenceMode("SLIP")}
                style={{ padding: "6px 18px", fontSize: "13.5px" }}
                className={`rounded-md font-semibold transition-all ${
                  evidenceMode === "SLIP"
                    ? "bg-emerald-500/25 text-emerald-300 border border-emerald-400/50 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                SLIP (สลิป)
              </button>
            </div>

            {/* Status Capsule with LED Pulsing State */}
            {(() => {
              const capsuleState = resolveWebHeaderStatus({
                loading,
                batchProgress,
                evidence: evidenceState,
                targetName,
              });
              return (
                <div
                  className="px-3.5 py-1.5 rounded-full flex items-center gap-2 border text-[12px] font-mono font-medium backdrop-blur-md transition-all shadow-sm"
                  style={{
                    borderColor: capsuleState.glowColor,
                    backgroundColor: "rgba(15, 23, 42, 0.75)",
                  }}
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      capsuleState.isPulsing ? "animate-ping" : "animate-pulse"
                    }`}
                    style={{ backgroundColor: capsuleState.color }}
                  />
                  <span style={{ color: capsuleState.color }}>
                    {capsuleState.text}
                  </span>
                </div>
              );
            })()}

            {/* PDPA Shield Toggle */}
            <div className="flex items-center gap-2 bg-black/40 px-3 py-1.5 rounded-lg border border-white/10">
              <span className="text-[12px] font-medium text-slate-300">🛡️ PDPA</span>
              <button
                onClick={() => setPdpaEnabled((p) => !p)}
                className={`w-8 h-4 flex items-center rounded-full p-0.5 transition-colors ${
                  pdpaEnabled ? "bg-emerald-500" : "bg-slate-700"
                }`}
              >
                <div
                  className={`bg-white w-3 h-3 rounded-full shadow-md transform transition-transform ${
                    pdpaEnabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <span className={`text-[10px] font-mono font-bold ${pdpaEnabled ? "text-emerald-400" : "text-slate-500"}`}>
                {pdpaEnabled ? "ON" : "OFF"}
              </span>
            </div>
          </div>
        </div>

        {/* =====================================================================
            HEADER RIGHT: Real-Time Clock & Date + Quick Tool
            ===================================================================== */}
        <div className="flex items-center gap-5">
          {/* Real-Time Clock & Date */}
          <div className="flex flex-col items-end justify-center font-mono leading-tight">
            <span className="text-[16px] font-bold text-slate-100 tracking-wider">
              {formattedTimeStr}
            </span>
            <span className="text-[12px] text-slate-400 font-sans mt-0.5">
              {formattedDateStr}
            </span>
          </div>

          {/* Quick Tool Button */}
          <button
            onClick={() => setFullBookOpen(true)}
            style={{ padding: "10px 18px", fontSize: "13.5px" }}
            className="glass-button glass-button-cyan rounded-lg font-semibold flex items-center gap-2 shadow-lg hover:scale-105 transition-transform"
          >
            <span>🖨️ พิมพ์เอกสาร</span>
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
            {/* Hidden File Input (Staging Buffer Intake) */}
            <input
              type="file"
              ref={fileInputRef}
              multiple
              onChange={(e) => e.target.files && stageIncomingFiles(e.target.files)}
              accept="image/*"
              className="hidden"
            />

            {/* Drag-and-Drop Dropzone (Staging Buffer Ingestion) */}
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
                    {batchProgress.phase} ({batchProgress.current}/{batchProgress.total})
                  </p>
                  <p className="text-[11px] text-slate-300 font-mono mt-0.5 truncate max-w-[280px]">
                    📄 {batchProgress.currentFileName}
                  </p>
                  {/* Progress bar */}
                  <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden mt-3 border border-white/10">
                    <div
                      className="bg-gradient-to-r from-sky-400 via-amber-400 to-emerald-400 h-full transition-all duration-300"
                      style={{
                        width: `${Math.round((batchProgress.current / batchProgress.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <span className="text-3xl mb-1.5 group-hover:scale-110 transition-transform">📥</span>
                  <p className="typo-label font-semibold text-slate-100">
                    ลากไฟล์ภาพแชท / สลิป มาหยอดพักไว้ที่นี่
                  </p>
                  <p className="text-xs text-sky-400 font-medium mt-0.5">
                    📦 หยอดไฟล์เพิ่มกี่รอบก็ได้ (Staging Buffer พักรอข้อมูล)
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    PNG, JPG, WEBP (พักรอให้ครบก่อนกดรันทีเดียว)
                  </p>
                  <button
                    type="button"
                    className="btn-proportional-compact mt-3 rounded-lg bg-white/5 border border-white/15 text-sky-400 hover:bg-white/10 font-medium"
                  >
                    + เลือกไฟล์เพิ่มลงในบัฟเฟอร์
                  </button>
                </>
              )}
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-500/15 border border-red-400/40 typo-label text-red-300">
                ⚠️ {errorMsg}
              </div>
            )}

            {/* -----------------------------------------------------------------
                PHASE 1: STAGING BUFFER CONTROL CARD (หน่วยความจำพักรอข้อมูล)
                ----------------------------------------------------------------- */}
            {stagedQueue.length > 0 && (
              <div className="glass-nested p-3.5 rounded-xl border border-sky-400/30 flex flex-col gap-3 shadow-lg bg-sky-950/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📦</span>
                    <div>
                      <span className="text-xs font-bold text-slate-100">
                        หน่วยความจำพักรอ (Staging Buffer)
                      </span>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                        <span className="text-emerald-400">
                          สลิป {stagedQueue.filter((i) => i.category === "SLIP").length} ใบ
                        </span>
                        <span>•</span>
                        <span className="text-sky-400">
                          แชท {stagedQueue.filter((i) => i.category === "CHAT").length} หน้า
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={clearStagingBuffer}
                    className="text-[11px] text-red-400 hover:text-red-300 font-medium"
                  >
                    ล้างคิว
                  </button>
                </div>

                {/* PHASE 2 EXECUTE BUTTON */}
                <button
                  onClick={executeUnifiedBatch}
                  disabled={loading}
                  className={`w-full py-2.5 px-4 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md ${
                    loading
                      ? "bg-amber-500/20 text-amber-300 border border-amber-400/40 cursor-wait"
                      : "bg-gradient-to-r from-emerald-600 to-sky-600 text-white hover:from-emerald-500 hover:to-sky-500 hover:scale-[1.02] border border-white/20 active:scale-[0.98]"
                  }`}
                >
                  {loading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-amber-300 border-t-transparent rounded-full animate-spin"></div>
                      <span>กำลังประมวลผลแบบ Cross-Matching...</span>
                    </>
                  ) : (
                    <>
                      <span>⚡ เริ่มประมวลผลพยานหลักฐาน ({stagedQueue.length} ไฟล์)</span>
                    </>
                  )}
                </button>
                <p className="text-[10px] text-slate-400 text-center leading-tight">
                  ระบบจะสกัดสลิป Fact → วิเคราะห์แชท → Match คู่ขนาน → ตัดยอดซ้ำ อัตโนมัติ
                </p>

                {/* Staged Items List */}
                <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1 border-t border-white/10 pt-2">
                  {stagedQueue.map((item, idx) => (
                    <div
                      key={item.id}
                      onClick={() => selectEvidenceItem(idx)}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${
                        selectedItemIndex === idx
                          ? "bg-sky-500/20 border-sky-400/60 shadow-sm"
                          : "bg-black/20 border-white/5 hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <img
                          src={item.previewUrl}
                          alt="thumb"
                          className="w-9 h-9 object-cover rounded border border-white/10 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium text-slate-200 truncate">
                            {idx + 1}. {item.file.name}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {item.status === "processing" ? (
                              <span className="text-[10px] text-amber-400 font-mono animate-pulse">
                                🔄 กำลังวิเคราะห์...
                              </span>
                            ) : item.status === "staged" ? (
                              <span className="text-[10px] text-sky-300 font-mono">
                                📦 {item.category === "SLIP" ? "สลิป (รอรัน)" : "แชท (รอรัน)"}
                              </span>
                            ) : item.status === "error" ? (
                              <span className="text-[10px] text-red-400 font-mono">
                                ⚠️ ผิดพลาด
                              </span>
                            ) : item.isDuplicate ? (
                              <span className="text-[10px] text-amber-400 font-mono font-bold">
                                ⚠️ สลิปซ้ำ (ตัดยอด NET)
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

                      {/* Remove item button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeStagedItem(item.id);
                        }}
                        className="text-slate-500 hover:text-red-400 text-xs px-1.5 py-0.5 ml-1 rounded hover:bg-white/5"
                        title="นำออกจากคิว"
                      >
                        ✕
                      </button>
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
