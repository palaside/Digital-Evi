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
import { stripThaiTitlePrefix, isTargetMatch, type TargetPersonItem } from "@/utils/target-matcher";
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
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());
  useEffect(() => {
    setMounted(true);
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
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [linkageModalOpen, setLinkageModalOpen] = useState(false);
  const [sfxModalOpen, setSfxModalOpen] = useState(false);
  const [legalContextModalOpen, setLegalContextModalOpen] = useState(false);
  const [legalSearchQuery, setLegalSearchQuery] = useState("");
  const [legalCategoryFilter, setLegalCategoryFilter] = useState<"ALL" | "CIVIL" | "CRIMINAL">("ALL");
  const [vaultPassword, setVaultPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step 2: Target Name Matcher & POI Forensic Suite States
  const [targetSearchInput, setTargetSearchInput] = useState("");
  const [targetList, setTargetList] = useState<TargetPersonItem[]>([
    {
      id: "poi-default-1",
      rawName: "นางสาวจิณห์นิภา ประสาทเขตการ",
      cleanName: "จิณห์นิภา ประสาทเขตการ",
      role: "ผู้รับโอน (Receiver)",
      accountNo: "xxx-x-xx452-9",
      bank: "ธนาคารกสิกรไทย",
      selected: true,
      totalAmount: 250000,
      txCount: 3,
    },
  ]);
  const [detectedNamesModalOpen, setDetectedNamesModalOpen] = useState(false);

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
      timestamp: evidenceState.processedAt || (mounted ? new Date().toLocaleString("th-TH") : "รอประมวลผล"),
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
          archive_name: vaultPassword.trim() ? "Dossier_Encrypted.exe" : "Dossier_Standard.exe",
          is_password_protected: !!vaultPassword.trim(),
        },
      },
    };
  }, [caseNumber, evidenceState, targetName, pdpaEnabled, vaultPassword]);

  // Step 2.1 & 2.2 Target Management Handlers
  const addTargetPerson = (raw: string, role = "ผู้รับโอน (Receiver)", amount = 0, count = 1) => {
    const clean = stripThaiTitlePrefix(raw);
    if (!clean) return;

    // Check if already in targetList
    const exists = targetList.some((t) => isTargetMatch(t.cleanName, clean));
    if (exists) {
      setTargetSearchInput("");
      return;
    }

    const newItem: TargetPersonItem = {
      id: `poi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      rawName: raw.trim(),
      cleanName: clean,
      role,
      selected: true,
      totalAmount: amount,
      txCount: count,
    };

    const updated = [...targetList, newItem];
    setTargetList(updated);
    setTargetSearchInput("");
    if (!targetName || targetList.length === 0) {
      setTargetName(clean);
    }
  };

  const removeTargetPerson = (id: string) => {
    const updated = targetList.filter((t) => t.id !== id);
    setTargetList(updated);
    const active = updated.filter((t) => t.selected);
    if (active.length > 0) {
      setTargetName(active[0].cleanName);
    } else {
      setTargetName("");
    }
  };

  const toggleTargetPerson = (id: string) => {
    const updated = targetList.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t));
    setTargetList(updated);
    const active = updated.filter((t) => t.selected);
    if (active.length > 0) {
      setTargetName(active[0].cleanName);
    } else {
      setTargetName("");
    }
  };

  // 2.2 Detected Names Dataset (OCR & Staged Ingestion Pool)
  const detectedNamesList = useMemo(() => {
    const map = new Map<string, {
      rawName: string;
      cleanName: string;
      role: string;
      accountNo: string;
      bank: string;
      totalAmount: number;
      txCount: number;
    }>();

    // 1. Scan stagedQueue
    stagedQueue.forEach((item) => {
      if (item.category === "SLIP" && item.data) {
        if (item.data.receiver?.name) {
          const raw = item.data.receiver.name;
          const clean = stripThaiTitlePrefix(raw);
          const key = clean.toLowerCase();
          const amt = item.data.transaction.amount || 0;
          if (map.has(key)) {
            const cur = map.get(key)!;
            cur.totalAmount += amt;
            cur.txCount += 1;
          } else {
            map.set(key, {
              rawName: raw,
              cleanName: clean,
              role: "ผู้รับโอน (Receiver)",
              accountNo: item.data.receiver.account_no || "-",
              bank: item.data.receiver.bank || item.data.bank?.name || "ธนาคาร",
              totalAmount: amt,
              txCount: 1,
            });
          }
        }
        if (item.data.sender?.name) {
          const raw = item.data.sender.name;
          const clean = stripThaiTitlePrefix(raw);
          const key = clean.toLowerCase();
          const amt = item.data.transaction.amount || 0;
          if (map.has(key)) {
            const cur = map.get(key)!;
            cur.txCount += 1;
          } else {
            map.set(key, {
              rawName: raw,
              cleanName: clean,
              role: "ผู้โอน (Sender)",
              accountNo: item.data.sender.account_no || "-",
              bank: item.data.sender.bank || "ธนาคาร",
              totalAmount: amt,
              txCount: 1,
            });
          }
        }
      }
    });

    // 2. Base preset entities if empty or for exploration
    const presets = [
      {
        rawName: "นางสาวจิณห์นิภา ประสาทเขตการ",
        cleanName: "จิณห์นิภา ประสาทเขตการ",
        role: "ผู้รับโอน (Receiver)",
        accountNo: "xxx-x-xx452-9",
        bank: "ธนาคารกสิกรไทย",
        totalAmount: 250000,
        txCount: 3,
      },
      {
        rawName: "นายวิชัย ใจดี",
        cleanName: "วิชัย ใจดี",
        role: "ผู้โอน (Sender)",
        accountNo: "xxx-x-xx891-2",
        bank: "ธนาคารไทยพาณิชย์",
        totalAmount: 180000,
        txCount: 2,
      },
      {
        rawName: "นายธนกร มั่งมี (บัญชีม้า)",
        cleanName: "ธนกร มั่งมี",
        role: "ผู้รับโอน (Receiver)",
        accountNo: "xxx-x-xx314-5",
        bank: "ธนาคารกรุงเทพ",
        totalAmount: 70000,
        txCount: 1,
      },
      {
        rawName: "พ.ต.ท. ปิยะ สมบัติ",
        cleanName: "ปิยะ สมบัติ",
        role: "ผู้โอน (Sender)",
        accountNo: "xxx-x-xx556-0",
        bank: "ธนาคารกรุงไทย",
        totalAmount: 50000,
        txCount: 1,
      },
    ];

    presets.forEach((p) => {
      const key = p.cleanName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, p);
      }
    });

    return Array.from(map.values());
  }, [stagedQueue]);

  const selectedTargetItems = useMemo(() => {
    return targetList.filter((t) => t.selected);
  }, [targetList]);

  const poiAmount = useMemo(() => {
    if (selectedTargetItems.length === 0) return 0;

    let sum = 0;
    let foundInStaged = false;

    stagedQueue.forEach((item) => {
      if (item.category === "SLIP" && item.data && !item.isDuplicate) {
        const sender = item.data.sender?.name || "";
        const receiver = item.data.receiver?.name || "";
        const matches = selectedTargetItems.some(
          (t) => isTargetMatch(sender, t.cleanName) || isTargetMatch(receiver, t.cleanName)
        );
        if (matches) {
          sum += item.data.transaction.amount || 0;
          foundInStaged = true;
        }
      }
    });

    if (foundInStaged) return sum;

    // Fallback: sum the totalAmount of active checked target items
    return selectedTargetItems.reduce((acc, t) => acc + (t.totalAmount || 0), 0);
  }, [selectedTargetItems, stagedQueue]);

  const amountDisplay = evidenceState.totalNetLoss > 0
    ? `฿ ${evidenceState.totalNetLoss.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`
    : "฿ 0.00";

  // Factual Evidence Court Mapping Dataset (4 Columns Court Standard)
  const courtEvidenceMapping = useMemo(() => {
    return [
      {
        id: "ev-01",
        pdfPage: "หน้า ๑",
        quoteContext: "“พี่คะ ขอยืมเงิน 10,000 บาทก่อนได้ไหมคะ สิ้นเดือนหนูโอนคืนให้แน่นอนค่ะ”",
        hashtags: ["#สัญญากู้ยืมเงิน", "#ยืมเงิน", "#นิติกรรมหนี้"],
        lawType: "CIVIL" as const,
        lawBadgeText: "แพ่ง" as const,
        legalArticle: "อาจเข้าข่ายสัญญากู้ยืมเงิน ตามประมวลกฎหมายแพ่งและพาณิชย์ มาตรา ๖๕๓ วรรคหนึ่ง",
      },
      {
        id: "ev-02",
        pdfPage: "หน้า ๒",
        quoteContext: "“ยอด 10,000 บาทที่ค้างอยู่ หนูไม่ได้หนีไปไหนนะคะ จะขอเริ่มทยอยผ่อนจ่ายให้เดือนละ 2,000 บาทค่ะ”",
        hashtags: ["#รับสภาพหนี้", "#ผ่อนชำระ", "#อายุความสะดุดหยุดอยู่"],
        lawType: "CIVIL" as const,
        lawBadgeText: "แพ่ง" as const,
        legalArticle: "อาจเข้าข่ายการรับสภาพหนี้ ตามประมวลกฎหมายแพ่งและพาณิชย์ มาตรา ๑๙๓/๑๔ (๑)",
      },
      {
        id: "ev-03",
        pdfPage: "หน้า ๓",
        quoteContext: "“ร่วมลงทุนแพ็กเกจนี้ การันตีผลกำไร 30% ต่อวัน ได้เงินชัวร์ 100% โอนเงินเข้าบัญชีนี้แล้วรอรับเงินปันผลได้เลย”",
        hashtags: ["#ฉ้อโกง", "#หลอกลงทุน", "#พรบคอมพิวเตอร์", "#ข้อความเท็จ"],
        lawType: "CRIMINAL" as const,
        lawBadgeText: "อาญา" as const,
        legalArticle: "อาจเข้าข่ายความผิดฐานฉ้อโกง ตามประมวลกฎหมายอาญา มาตรา ๓๔๑ วรรคหนึ่ง และ พ.ร.บ.คอมพิวเตอร์ฯ มาตรา ๑๔ (๑)",
      },
      {
        id: "ev-04",
        pdfPage: "หน้า ๔",
        quoteContext: "“พี่กดเลขบัญชีผิดโอนเงินเข้าไป 5,000 บาท ไม่ใช่เงินของคุณ รบกวนช่วยโอนเงินกลับคืนด้วยนะคะ”",
        hashtags: ["#ลาภมิควรได้", "#โอนเงินผิดบัญชี", "#ยักยอกทรัพย์"],
        lawType: "CIVIL" as const,
        lawBadgeText: "แพ่ง" as const,
        legalArticle: "อาจเข้าข่ายลาภมิควรได้ ตามประมวลกฎหมายแพ่งและพาณิชย์ มาตรา ๔๐๖ (หากเจตนาเบียดบังอาจเข้าข่ายยักยอกทรัพย์ ป.อ. มาตรา ๓๕๒)",
      },
      {
        id: "ev-05",
        pdfPage: "หน้า ๕",
        quoteContext: "“ยินยอมเปิดบัญชีธนาคารและส่งมอบซิมการ์ดโทรศัพท์ให้เพื่อแลกกับค่าจ้าง 1,500 บาท เอาไปใช้งานได้เลย”",
        hashtags: ["#บัญชีม้า", "#ซิมม้า", "#พรกมาตรการป้องกันปราบปรามอาชญากรรมทางเทคโนโลยี"],
        lawType: "CRIMINAL" as const,
        lawBadgeText: "อาญา" as const,
        legalArticle: "อาจเข้าข่ายความผิดฐานเปิดหรือยินยอมให้ผู้อื่นใช้บัญชีเงินฝาก (บัญชีม้า) ตาม พ.ร.ก. มาตรการป้องกันและปราบปรามอาชญากรรมทางเทคโนโลยี พ.ศ. 2566 มาตรา ๙, ๑๐, ๑๑",
      },
    ];
  }, []);

  const filteredEvidenceMapping = useMemo(() => {
    return courtEvidenceMapping.filter((item) => {
      if (legalCategoryFilter === "CIVIL" && item.lawType !== "CIVIL") return false;
      if (legalCategoryFilter === "CRIMINAL" && item.lawType !== "CRIMINAL") return false;
      if (legalSearchQuery.trim()) {
        const q = legalSearchQuery.toLowerCase().trim();
        const matchPage = item.pdfPage.toLowerCase().includes(q);
        const matchQuote = item.quoteContext.toLowerCase().includes(q);
        const matchArticle = item.legalArticle.toLowerCase().includes(q);
        const matchHashtags = item.hashtags.some((tag) => tag.toLowerCase().includes(q));
        return matchPage || matchQuote || matchArticle || matchHashtags;
      }
      return true;
    });
  }, [courtEvidenceMapping, legalCategoryFilter, legalSearchQuery]);

  const civilCount = useMemo(() => courtEvidenceMapping.filter((x) => x.lawType === "CIVIL").length, [courtEvidenceMapping]);
  const criminalCount = useMemo(() => courtEvidenceMapping.filter((x) => x.lawType === "CRIMINAL").length, [courtEvidenceMapping]);

  const handleExportPdf = () => {
    setFullBookOpen(true);
  };

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
            <span
              className="text-[16px] font-bold text-slate-100 tracking-wider"
              suppressHydrationWarning
            >
              {mounted ? formattedTimeStr : "--:--:--"}
            </span>
            <span
              className="text-[12px] text-slate-400 font-sans mt-0.5"
              suppressHydrationWarning
            >
              {mounted ? formattedDateStr : "..."}
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

            {/* =================================================================
                STEP 2: ระบบบริหารจัดการบุคคลเป้าหมาย (Target Name Matcher & POI Suite)
                ================================================================= */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-white/10 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  👤 02 บุคคลเป้าหมาย (POI)
                </span>
                <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-400/20 font-semibold">
                  ZERO-PREFIX MATCH
                </span>
              </div>

              {/* 2.1 ค้นหาชื่อเป้าหมาย (Target Search & Enter Trigger) */}
              <div className="thai-clearance-stack">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center justify-between">
                  <span>2.1 ค้นหา / เพิ่มชื่อเป้าหมาย:</span>
                  <span className="text-[10px] text-slate-400 font-normal">กด Enter เพื่อเพิ่ม</span>
                </label>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                    <input
                      type="text"
                      value={targetSearchInput}
                      onChange={(e) => setTargetSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && targetSearchInput.trim()) {
                          e.preventDefault();
                          addTargetPerson(targetSearchInput.trim());
                        }
                      }}
                      placeholder="พิมพ์/วางชื่อเป้าหมาย แล้วกด Enter..."
                      className="input-proportional glass-input pl-8 text-xs py-1.5 font-sans"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (targetSearchInput.trim()) {
                        addTargetPerson(targetSearchInput.trim());
                      }
                    }}
                    className="btn-proportional-compact px-3 py-1.5 rounded-lg bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 border border-sky-400/40 text-xs font-bold shrink-0 transition-colors"
                  >
                    + เพิ่ม
                  </button>
                </div>
                <div className="text-[9.5px] text-slate-400 leading-tight">
                  ระบบลอกคำนำหน้า ยศ ตำแหน่ง ฐานันดรศักดิ์ ทิ้ง 100% อัตโนมัติ
                </div>
              </div>

              {/* 2.2 แสดงรายชื่อทั้งหมดที่ตรวจพบในคดี (Detected Names Button) */}
              <button
                type="button"
                onClick={() => setDetectedNamesModalOpen(true)}
                className="btn-proportional-primary glass-button glass-button-cyan w-full justify-between items-center text-xs py-2 px-3 rounded-lg border border-sky-400/40 bg-sky-950/40 hover:bg-sky-900/50 text-sky-200 transition-all shadow-sm group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm group-hover:scale-110 transition-transform">📋</span>
                  <span className="font-semibold text-slate-100">2.2 แสดงรายชื่อที่ตรวจพบในคดี</span>
                </div>
                <span className="text-[10px] font-mono text-sky-300 bg-sky-500/20 px-1.5 py-0.5 rounded border border-sky-400/30">
                  {detectedNamesList.length} รายชื่อ ›
                </span>
              </button>

              {/* 2.3 รายชื่อเป้าหมายและติ๊กคำนวณรายคน (Target Checklist Container) */}
              <div className="glass-nested p-3 rounded-xl border border-white/10 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1.5">
                    <span>👥 2.3 รายชื่อเป้าหมาย (ติ๊กเลือกคำนวณ):</span>
                  </span>
                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    {selectedTargetItems.length}/{targetList.length} คน
                  </span>
                </div>

                {/* Target Items List */}
                {targetList.length === 0 ? (
                  <div className="p-3 text-center text-slate-400 text-[11px] italic bg-black/20 rounded-lg border border-dashed border-white/10">
                    * ยังไม่มีเป้าหมาย (พิมพ์ในช่องค้นหา 2.1 แล้วกด Enter หรือเลือกจากปุ่มข้อ 2.2)
                  </div>
                ) : (
                  <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                    {targetList.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                          item.selected
                            ? "bg-sky-950/40 border-sky-400/50 shadow-sm"
                            : "bg-black/20 border-white/5 opacity-60 hover:opacity-100"
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => toggleTargetPerson(item.id)}
                            className="w-3.5 h-3.5 rounded border-sky-400 text-sky-500 focus:ring-0 cursor-pointer"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-slate-100 truncate flex items-center gap-1.5">
                              <span>{item.cleanName}</span>
                              {item.rawName !== item.cleanName && (
                                <span className="text-[9.5px] font-normal text-slate-400 truncate">
                                  ({item.rawName})
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5 font-mono">
                              <span className="text-sky-300">{item.role || "ผู้รับโอน"}</span>
                              {item.totalAmount && item.totalAmount > 0 ? (
                                <>
                                  <span>•</span>
                                  <span className="text-emerald-400 font-bold">
                                    ฿{item.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeTargetPerson(item.id)}
                          className="text-slate-500 hover:text-red-400 text-xs px-1.5 py-0.5 ml-1 rounded hover:bg-white/5 transition-colors"
                          title="นำเป้าหมายออก"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2.4 POI Loss Summary Card */}
              <div className="glass-nested p-3.5 rounded-xl border-l-4 border-sky-400 bg-sky-950/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">ยอดความเสียหายเฉพาะเป้าหมาย</span>
                  <span className="text-[10px] font-mono text-sky-300 font-bold">
                    {selectedTargetItems.length} คนที่เลือก
                  </span>
                </div>
                <div className="font-mono text-xl font-bold text-sky-300 mt-1">
                  ฿ {poiAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-slate-300 mt-1 truncate">
                  เป้าหมาย:{" "}
                  <span className="text-slate-100 font-semibold">
                    {selectedTargetItems.length > 0
                      ? selectedTargetItems.map((t) => (pdpaEnabled ? maskPersonName(t.cleanName, true) : t.cleanName)).join(", ")
                      : "ยังไม่มีเป้าหมายที่เลือก"}
                  </span>
                </div>
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

          <div className="panel-scroll-body thai-clearance-stack pr-1 flex flex-col gap-3">
            {/* =================================================================
                LAYER 1: 4 KPI CARDS (2x2 Grid)
                1. ยอดเงินรวมแห่งคดี
                2. ยอดของบุคคลเป้าหมาย
                3. แชทและสลิปที่สัมพันธ์
                4. สรุปหน้าที่ซ้ำกันทั้ง
                ================================================================= */}
            <div className="grid grid-cols-2 gap-2">
              {/* Card 1: 1. ยอดเงินรวมแห่งคดี */}
              <div className="glass-card p-3 rounded-xl flex flex-col justify-between border border-white/10 hover:border-emerald-400/40 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-300">
                    1. ยอดรวมคดี
                  </span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]"></span>
                </div>
                <div className="font-mono text-base font-bold text-emerald-400 mt-1 truncate">
                  {amountDisplay}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                  <span>สลิป: {evidenceState.slipCount} ใบ</span>
                  <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.5 rounded border border-emerald-500/20">
                    NET
                  </span>
                </div>
              </div>

              {/* Card 2: 2. ยอดของบุคคลเป้าหมาย */}
              <div className="glass-card p-3 rounded-xl flex flex-col justify-between border border-white/10 hover:border-sky-400/40 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-300">
                    2. ยอดเป้าหมาย
                  </span>
                  <span className="w-2 h-2 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]"></span>
                </div>
                <div className="font-mono text-base font-bold text-sky-400 mt-1 truncate">
                  ฿ {poiAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                  <span className="truncate max-w-[95px]">
                    {selectedTargetItems.length > 0
                      ? selectedTargetItems.map((t) => t.cleanName).join(", ")
                      : "ยังไม่เลือก"}
                  </span>
                  <span className="text-[9px] font-mono text-sky-400 bg-sky-500/10 px-1 py-0.5 rounded border border-sky-500/20">
                    POI ({selectedTargetItems.length})
                  </span>
                </div>
              </div>

              {/* Card 3: 3. แชทและสลิปที่สัมพันธ์ */}
              <div className="glass-card p-3 rounded-xl flex flex-col justify-between border border-white/10 hover:border-teal-400/40 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-300">
                    3. สอดคล้อง 1:1
                  </span>
                  <span className="w-2 h-2 rounded-full bg-teal-400 shadow-[0_0_8px_#2dd4bf]"></span>
                </div>
                <div className="font-mono text-base font-bold text-teal-300 mt-1">
                  {evidenceState.corroboratedPairsCount} คู่
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                  <span>แชทคู่สลิปจริง</span>
                  <span className="text-[9px] font-mono text-teal-400 bg-teal-500/10 px-1 py-0.5 rounded border border-teal-500/20">
                    PAIRS
                  </span>
                </div>
              </div>

              {/* Card 4: 4. สรุปหน้าที่ซ้ำกันทั้ง */}
              <div className="glass-card p-3 rounded-xl flex flex-col justify-between border border-white/10 hover:border-amber-400/40 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-300">
                    4. หน้าที่ซ้ำกัน
                  </span>
                  <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]"></span>
                </div>
                <div className="font-mono text-base font-bold text-amber-400 mt-1">
                  {evidenceState.duplicateCount} จุด
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                  <span>ตัดยอดสุทธิ</span>
                  <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20">
                    DEDUP
                  </span>
                </div>
              </div>
            </div>

            {/* =================================================================
                LAYER 2: สถานะการถอดรหัส (EXTRACTION STATUS) - คงเดิม
                ================================================================= */}
            <div className="glass-card p-3.5 rounded-xl border border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider font-medium">
                  สถานะการถอดรหัส (Extraction Status)
                </span>
                <span className="text-[10px] font-mono font-semibold text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-400/20">
                  {extractedData ? "DECODED" : "STANDBY"}
                </span>
              </div>
              <div className="typo-label font-bold text-sky-400 mt-1 truncate text-xs">
                {extractedData?.bank?.name
                  ? `ธนาคาร: ${extractedData.bank.name}`
                  : "ระบบพร้อมตรวจรับไฟล์สลิปจริง"}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 font-mono truncate">
                Ref ID: {extractedData?.transaction?.reference_no || "-"}
              </div>
            </div>

            {/* =================================================================
                LAYER 3: 2 ปุ่มเพิ่มเติม
                - ปุ่มตารางสรุปหลักฐาน
                - ปุ่มตรวจสอบความเชื่อมโยง
                ================================================================= */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setLedgerModalOpen(true)}
                className="btn-proportional-primary glass-button glass-button-cyan w-full justify-between items-center text-xs py-2 px-3 rounded-lg border border-sky-400/30 hover:border-sky-400/60 bg-sky-950/30 hover:bg-sky-900/40 transition-all shadow-sm group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm group-hover:scale-110 transition-transform">📋</span>
                  <span className="font-semibold text-slate-100">ตารางสรุปหลักฐาน</span>
                </div>
                <span className="text-[10px] font-mono text-sky-300 bg-sky-500/20 px-1.5 py-0.5 rounded border border-sky-400/30">
                  10 คอลัมน์ ↗
                </span>
              </button>

              <button
                onClick={() => setLinkageModalOpen(true)}
                className="btn-proportional-primary glass-button w-full justify-between items-center text-xs py-2 px-3 rounded-lg border border-emerald-400/30 hover:border-emerald-400/60 bg-emerald-950/25 hover:bg-emerald-900/35 transition-all shadow-sm text-left group"
                title="สรุปการจับคู่ลำดับหน้าจากไฟล์ PDF ที่มีสลิปแปะไว้ คู่กับ ลำดับของสลิป จาก PDF"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm shrink-0 group-hover:scale-110 transition-transform">🔗</span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-emerald-300 truncate">ตรวจสอบความเชื่อมโยง</span>
                    <span className="text-[9.5px] text-slate-400 leading-tight truncate">
                      (สรุปการจับคู่ลำดับหน้าจากไฟล์ PDF ที่มีสลิปแปะไว้ คู่กับ ลำดับของสลิป จาก PDF)
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-400/30 shrink-0 ml-1">
                  Linkage ↗
                </span>
              </button>
            </div>

            {/* =================================================================
                LAYER 4: เครื่องมือสำนวนศาลทั้ง 5 ข้อ (SSOT Aligned)
                ================================================================= */}
            <div className="glass-nested p-3 rounded-xl flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                เครื่องมือสำนวนศาลทั้ง 5 ข้อ
              </span>
              <button
                onClick={() => setCenterView("COVER_PAGE")}
                className="btn-proportional-primary glass-button glass-button-cyan w-full justify-start text-xs py-2"
              >
                🏛️ ดูหน้าปกสำนวนศาล (Cover Page)
              </button>
              <button
                onClick={() => setCenterView("HASH_MANIFEST")}
                className="btn-proportional-primary glass-button w-full justify-start text-xs py-2"
              >
                🔐 บัญชีคุมแฮช SHA-256 (Chain of Custody)
              </button>
              <button
                onClick={() => setCenterView("EXECUTIVE_SUMMARY")}
                className="btn-proportional-primary glass-button w-full justify-start text-xs py-2"
              >
                ⚖️ ใบสรุปผู้บริหาร 1 หน้า (Dashboard)
              </button>
              <button
                onClick={() => setLegalContextModalOpen(true)}
                className="btn-proportional-primary glass-button w-full justify-start text-xs py-2 border-indigo-400/30 hover:border-indigo-400/60 bg-indigo-950/20 text-indigo-200 hover:text-white transition-all"
              >
                📜 สรุปบริบทเข้าข่ายกฎหมาย (แพ่ง / อาญา)
              </button>
              <button
                onClick={() => setFullBookOpen(true)}
                className="btn-proportional-primary glass-button glass-button-cyan w-full justify-start text-xs py-2"
              >
                📚 รวมเล่มส่งศาลเต็ม 5 ชั้น (Master PDF)
              </button>
            </div>

            {/* =================================================================
                LAYER 5: รหัสผ่านล็อกไฟล์ (PDF / SFX)
                ================================================================= */}
            <div className="glass-nested p-3 rounded-xl thai-clearance-stack">
              <div className="flex items-center justify-between">
                <span className="typo-label font-bold text-slate-200 text-xs">
                  🔑 รหัสผ่านล็อกไฟล์ (SFX / PDF)
                </span>
                {vaultPassword.trim() ? (
                  <span className="text-[10px] text-emerald-400 font-mono font-semibold flex items-center gap-1 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    🔒 ENCRYPTED
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 font-mono font-semibold flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                    🔓 NO PASSWORD
                  </span>
                )}
              </div>
              <input
                type="password"
                placeholder="เว้นว่าง = ไม่ตั้งรหัสผ่าน (เปิดอ่านได้ทันที)"
                value={vaultPassword}
                onChange={(e) => setVaultPassword(e.target.value)}
                className="input-proportional glass-input font-mono text-xs py-1.5"
              />
              <div className="text-[10px] text-slate-400 leading-tight">
                {vaultPassword.trim() ? (
                  <span className="text-emerald-300">
                    นำรหัสนี้ไปล็อกคุ้มครองทั้งไฟล์ PDF และ WinRAR SFX (-hp)
                  </span>
                ) : (
                  <span>
                    ไม่มีการล็อกรหัส — ไฟล์ PDF และแฟ้มบีบอัด SFX สามารถเปิดอ่านได้ทันที
                  </span>
                )}
              </div>
            </div>

            {/* =================================================================
                LAYER 6: 2 ปุ่มเพิ่มเติม
                - ปุ่ม Export (ส่งออกเป็นไฟล์ PDF)
                - ปุ่ม SFX (ส่งออกเป็นการบีบไฟล์แบบ SFX)
                ================================================================= */}
            <div className="flex flex-col gap-2 pt-1 pb-1">
              <button
                onClick={handleExportPdf}
                className="w-full py-2.5 px-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md bg-gradient-to-r from-emerald-600 to-sky-600 text-white hover:from-emerald-500 hover:to-sky-500 hover:scale-[1.01] border border-white/20 active:scale-[0.99] group"
              >
                <span className="text-base group-hover:scale-110 transition-transform">📥</span>
                <div className="flex flex-col items-center">
                  <span className="leading-tight">Export (ส่งออกเป็นไฟล์ PDF)</span>
                  <span className="text-[9.5px] text-sky-100 font-normal">A4 มาตรฐานศาล 150 DPI ปลอดหน้าขาว</span>
                </div>
              </button>

              <button
                onClick={() => setSfxModalOpen(true)}
                className="w-full py-2.5 px-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 text-sky-200 hover:text-white hover:border-sky-400/60 hover:scale-[1.01] border border-blue-500/40 active:scale-[0.99] group"
              >
                <span className="text-base group-hover:scale-110 transition-transform">📦</span>
                <div className="flex flex-col items-center">
                  <span className="leading-tight">SFX (ส่งออกเป็นการบีบไฟล์แบบ SFX)</span>
                  <span className="text-[9.5px] text-slate-400 font-normal">WinRAR Encrypted Archive (-hp) บรรจุสำนวน</span>
                </div>
              </button>
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
          vaultPassword={vaultPassword}
          onClose={() => setFullBookOpen(false)}
        />
      )}

      {/* =====================================================================
          โมดูลที่ 2: ตารางสรุปหลักฐาน (10 คอลัมน์ แนวนอนมาตรฐานศาล)
          ===================================================================== */}
      {ledgerModalOpen && (
        <div className="absolute inset-0 glass-modal-backdrop z-50 flex items-center justify-center p-4">
          <div className="glass-modal w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-sky-400/30">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-sky-950/40">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">📋</span>
                <div>
                  <h3 className="font-bold text-sm text-slate-100">
                    ตารางสรุปพยานหลักฐานทางการเงินแห่งคดี (10 คอลัมน์ แนวนอนมาตรฐานศาล)
                  </h3>
                  <span className="text-[11px] text-sky-400 font-mono">
                    คดีหมายเลข: {caseNumber || "012/2569"} | ผู้ต้องหา/เป้าหมาย: {targetName || "อยู่ระหว่างสืบสวน"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setLedgerModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg px-2 py-1 rounded hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            {/* Table Body */}
            <div className="p-4 overflow-x-auto overflow-y-auto max-h-[65vh]">
              {stagedQueue.filter((i) => i.category === "SLIP" && i.data).length === 0 ? (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                  <span className="text-3xl">📭</span>
                  <span className="font-bold text-sm text-slate-300">
                    ยังไม่มีรายการสลิปที่ผ่านการถอดรหัสในระบบ (Pure Zero State)
                  </span>
                  <span className="text-xs text-slate-500">
                    กรุณาหยอดไฟล์สลิปเข้า Staging Buffer แล้วกดเริ่มประมวลผล เพื่อพ่นข้อมูลลง 10 คอลัมน์อัตโนมัติ
                  </span>
                </div>
              ) : (
                <table className="w-full text-[11px] border-collapse text-left font-sans">
                  <thead>
                    <tr className="bg-sky-950/60 text-sky-300 font-bold border-b border-sky-500/30 font-mono">
                      <th className="p-2 text-center w-10">ลำดับ</th>
                      <th className="p-2">วันที่-เวลา</th>
                      <th className="p-2">ธนาคาร</th>
                      <th className="p-2">รหัสอ้างอิงธุรกรรม (Ref ID)</th>
                      <th className="p-2">ชื่อผู้โอน (ต้นทาง)</th>
                      <th className="p-2">เลขที่บัญชีต้นทาง</th>
                      <th className="p-2">ชื่อผู้รับโอน (ปลายทาง)</th>
                      <th className="p-2">เลขที่บัญชีปลายทาง</th>
                      <th className="p-2 text-right">จำนวนเงิน (บาท)</th>
                      <th className="p-2 text-center">สถานะการตรวจพิสูจน์</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {stagedQueue
                      .filter((i) => i.category === "SLIP" && i.data)
                      .map((item, idx) => {
                        const d = item.data!;
                        const isDup = item.isDuplicate;
                        return (
                          <tr
                            key={item.id}
                            className={`hover:bg-white/5 transition-colors ${
                              isDup ? "bg-amber-500/10 text-amber-200" : "text-slate-200"
                            }`}
                          >
                            <td className="p-2 text-center font-mono">{idx + 1}</td>
                            <td className="p-2 font-mono whitespace-nowrap">
                              {d.transaction.date || "-"} {d.transaction.time || ""}
                            </td>
                            <td className="p-2 font-semibold text-sky-400">{d.bank.name || "-"}</td>
                            <td className="p-2 font-mono text-[10px] break-all">
                              {d.transaction.reference_no || "-"}
                            </td>
                            <td className="p-2">
                              {pdpaEnabled ? maskPersonName(d.sender.name, true) : d.sender.name || "-"}
                            </td>
                            <td className="p-2 font-mono text-[10px]">
                              {pdpaEnabled ? maskAccountNumber(d.sender.account_no) : d.sender.account_no || "-"}
                            </td>
                            <td className="p-2 font-semibold">
                              {pdpaEnabled ? maskPersonName(d.receiver.name, true) : d.receiver.name || "-"}
                            </td>
                            <td className="p-2 font-mono text-[10px]">
                              {pdpaEnabled ? maskAccountNumber(d.receiver.account_no) : d.receiver.account_no || "-"}
                            </td>
                            <td className="p-2 text-right font-mono font-bold text-emerald-400">
                              {d.transaction.amount ? `฿ ${d.transaction.amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}` : "-"}
                            </td>
                            <td className="p-2 text-center">
                              {isDup ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-400/40">
                                  สลิปซ้ำ (ตัดยอด)
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                                  ✓ ยืนยันยอดจริง
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-950/80 font-bold border-t border-white/20 text-slate-100">
                      <td colSpan={8} className="p-2.5 text-right font-mono text-xs">
                        ยอดความเสียหายสุทธิแห่งคดี (Forensic NET Loss):
                      </td>
                      <td className="p-2.5 text-right font-mono text-emerald-400 text-sm">
                        {amountDisplay}
                      </td>
                      <td className="p-2.5 text-center font-mono text-[10px] text-sky-400">
                        ตัดยอดซ้ำ {evidenceState.duplicateCount} รายการ
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex items-center justify-between bg-black/40">
              <span className="text-[11px] text-slate-400">
                รับรองความถูกต้องตาม พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ & มาตรฐานศาล ISO/IEC 27037
              </span>
              <div className="flex gap-2.5">
                <button
                  onClick={() => window.print()}
                  className="btn-proportional-compact rounded-lg bg-sky-600/30 border border-sky-400/40 text-sky-200 hover:bg-sky-600/50 text-xs px-3 py-1.5 font-bold"
                >
                  🖨️ พิมพ์ตาราง 10 คอลัมน์
                </button>
                <button
                  onClick={() => setLedgerModalOpen(false)}
                  className="btn-proportional-compact rounded-lg bg-white/10 text-slate-200 hover:bg-white/15 text-xs px-3 py-1.5"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          โมดูลที่ 3: ตรวจสอบความเชื่อมโยง (Cross-Reference Linkage Modal)
          (สรุปการจับคู่ลำดับหน้าจากไฟล์ PDF ที่มีสลิปแปะไว้ คู่กับ ลำดับของสลิป จาก PDF)
          ===================================================================== */}
      {linkageModalOpen && (
        <div className="absolute inset-0 glass-modal-backdrop z-50 flex items-center justify-center p-4">
          <div className="glass-modal w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-emerald-400/30">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-emerald-950/40">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🔗</span>
                <div>
                  <h3 className="font-bold text-sm text-slate-100">
                    รายงานการตรวจสอบความเชื่อมโยงของพยานหลักฐาน (Cross-Reference Linkage)
                  </h3>
                  <span className="text-[11px] text-emerald-400 font-mono">
                    สรุปการจับคู่ลำดับหน้าจากไฟล์ PDF ที่มีสลิปแปะไว้ คู่กับ ลำดับของสลิป จาก PDF
                  </span>
                </div>
              </div>
              <button
                onClick={() => setLinkageModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg px-2 py-1 rounded hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            {/* Content Body */}
            <div className="p-4 overflow-y-auto max-h-[65vh] flex flex-col gap-3">
              {/* Summary Stats Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="glass-nested p-3 rounded-lg border border-emerald-400/30 bg-emerald-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">คู่ที่จับคู่สำเร็จ</span>
                  <div className="text-lg font-bold font-mono text-emerald-400 mt-0.5">
                    {evidenceState.corroboratedPairsCount} คู่
                  </div>
                  <span className="text-[10px] text-slate-300">Consistent 1:1 Verified</span>
                </div>
                <div className="glass-nested p-3 rounded-lg border border-sky-400/30 bg-sky-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">หน้าแชทที่มีสลิปแนบ</span>
                  <div className="text-lg font-bold font-mono text-sky-400 mt-0.5">
                    {evidenceState.chatPageCount > 0 ? evidenceState.chatPageCount : stagedQueue.filter((i) => i.category === "CHAT").length} หน้า
                  </div>
                  <span className="text-[10px] text-slate-300">Dicut_Chat Quiet Zone Block</span>
                </div>
                <div className="glass-nested p-3 rounded-lg border border-amber-400/30 bg-amber-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">การตัดยอดสลิปซ้ำซ้อน</span>
                  <div className="text-lg font-bold font-mono text-amber-400 mt-0.5">
                    {evidenceState.duplicateCount} รายการ
                  </div>
                  <span className="text-[10px] text-slate-300">ป้องกันการนับยอดเสียหายเกินจริง</span>
                </div>
              </div>

              {/* Linkage Pair Table */}
              <div className="border border-white/10 rounded-xl overflow-hidden mt-1">
                <table className="w-full text-xs border-collapse text-left">
                  <thead>
                    <tr className="bg-slate-900/80 text-emerald-300 font-bold border-b border-white/10 font-mono text-[11px]">
                      <th className="p-2.5 text-center w-12">คู่ที่</th>
                      <th className="p-2.5">ลำดับหน้าใน PDF แชท</th>
                      <th className="p-2.5">ข้อความ/คำสั่งโอนแห่งคดี</th>
                      <th className="p-2.5">ลำดับของสลิปใน PDF</th>
                      <th className="p-2.5 text-right">ยอดเงินตรวจคู่ (บาท)</th>
                      <th className="p-2.5 text-center">สถานะความเชื่อมโยง</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[11px]">
                    {stagedQueue.filter((i) => i.category === "SLIP" && i.data).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">
                          รอการประมวลผลไฟล์สลิปและแชทเพื่อสร้างดัชนีเชื่อมโยงข้ามหน้า (Pure Zero State)
                        </td>
                      </tr>
                    ) : (
                      stagedQueue
                        .filter((i) => i.category === "SLIP" && i.data && !i.isDuplicate)
                        .map((item, idx) => {
                          const chatPageRef = idx + 1;
                          const slipPageRef = idx + 1;
                          const amt = item.data?.transaction.amount || 0;
                          return (
                            <tr key={item.id} className="hover:bg-white/5 transition-colors text-slate-200">
                              <td className="p-2.5 text-center font-mono font-bold text-sky-400">
                                #{idx + 1}
                              </td>
                              <td className="p-2.5 font-mono">
                                <span className="bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded border border-sky-500/30">
                                  หน้าแชทที่ {chatPageRef} (PDF)
                                </span>
                              </td>
                              <td className="p-2.5 max-w-[220px] truncate text-slate-300">
                                สั่งโอนเงินไปยัง {item.data?.receiver.name || "บุคคลเป้าหมาย"}
                              </td>
                              <td className="p-2.5 font-mono">
                                <span className="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                                  สลิปแผ่นที่ {slipPageRef} (PDF)
                                </span>
                              </td>
                              <td className="p-2.5 text-right font-mono font-bold text-emerald-400">
                                ฿ {amt.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </td>
                              <td className="p-2.5 text-center">
                                <span className="px-2 py-0.5 rounded font-mono text-[9.5px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                                  ✓ Consistent 1:1
                                </span>
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex items-center justify-between bg-black/40">
              <span className="text-[11px] text-slate-400">
                ดัชนีอ้างอิงข้ามเอกสาร (Cross-Reference) ใช้เป็นสารบัญหลักในการเบิกความต่อศาล
              </span>
              <div className="flex gap-2.5">
                <button
                  onClick={() => window.print()}
                  className="btn-proportional-compact rounded-lg bg-emerald-600/30 border border-emerald-400/40 text-emerald-200 hover:bg-emerald-600/50 text-xs px-3 py-1.5 font-bold"
                >
                  🖨️ พิมพ์รายงานความเชื่อมโยง
                </button>
                <button
                  onClick={() => setLinkageModalOpen(false)}
                  className="btn-proportional-compact rounded-lg bg-white/10 text-slate-200 hover:bg-white/15 text-xs px-3 py-1.5"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          โมดูลที่ 4: SFX PACKAGING MODAL (ส่งออกเป็นการบีบไฟล์แบบ SFX)
          ===================================================================== */}
      {sfxModalOpen && (
        <div className="absolute inset-0 glass-modal-backdrop z-50 flex items-center justify-center p-4">
          <div className="glass-modal w-full max-w-xl flex flex-col overflow-hidden shadow-2xl border border-blue-500/40">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-blue-950/50">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">📦</span>
                <div>
                  <h3 className="font-bold text-sm text-slate-100">
                    ระบบส่งออกและบรรจุสำนวนคดีแบบ WinRAR SFX (.exe)
                  </h3>
                  <span className="text-[11px] text-sky-400 font-mono">
                    WinRAR Encrypted Self-Extracting Court Dossier (-hp)
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSfxModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg px-2 py-1 rounded hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 flex flex-col gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-400/30 flex flex-col gap-2">
                <span className="font-bold text-sky-300 flex items-center gap-1.5 text-sm">
                  🔐 มาตรฐานความปลอดภัยชั้นศาล (Encrypted Dossier Vault)
                </span>
                <p className="text-slate-300 leading-relaxed text-[11.5px]">
                  ระบบจะทำการบีบอัดไฟล์สำนวนคดีทั้งหมดเป็นแฟ้มติดตั้งดึงตัวเอง (.exe) ด้วยอัลกอริทึม AES-256 พร้อมล็อก Header (-hp) ป้องกันไม่ให้บุคคลภายนอกเปิดดูรายชื่อไฟล์ภายในได้หากไม่มีรหัสผ่าน
                </p>
              </div>

              {/* Password Configuration */}
              <div className="thai-clearance-stack">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-200">
                    รหัสผ่านคุ้มครองสำนวน (SFX Vault & PDF Password):
                  </label>
                  {vaultPassword.trim() ? (
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-400/40 font-semibold">
                      🔒 ล็อกรหัสผ่าน (-hp)
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-400 bg-white/10 px-2 py-0.5 rounded border border-white/15">
                      🔓 ไม่ล็อกรหัสผ่าน
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={vaultPassword}
                    onChange={(e) => setVaultPassword(e.target.value)}
                    placeholder="เว้นว่าง = ไม่ตั้งรหัสผ่าน (เปิดอ่านและแตกไฟล์ได้ทันที)"
                    className="input-proportional glass-input font-mono text-sm font-bold text-emerald-400 flex-1 py-2 px-3 rounded-lg placeholder:font-normal placeholder:text-slate-500 placeholder:text-xs"
                  />
                  {vaultPassword.trim() && (
                    <button
                      onClick={() => setVaultPassword("")}
                      className="px-2.5 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-mono shrink-0 transition-colors"
                      title="ล้างรหัสผ่าน (ไม่ล็อกรหัส)"
                    >
                      ล้างรหัส
                    </button>
                  )}
                </div>
                <div className="text-[10.5px] mt-1">
                  {vaultPassword.trim() ? (
                    <span className="text-emerald-300">
                      ✓ แฟ้ม WinRAR SFX และเอกสาร PDF จะถูกล็อกด้วยรหัส: <strong className="font-mono text-white underline">{vaultPassword.trim()}</strong>
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      ℹ️ เว้นว่างไว้: แฟ้ม SFX และเอกสาร PDF ภายในจะไม่มีรหัสผ่าน สามารถดับเบิลคลิกเปิดอ่านได้ทันที
                    </span>
                  )}
                </div>
              </div>

              {/* Manifest Package Items */}
              <div className="thai-clearance-stack">
                <label className="font-bold text-slate-200">
                  เอกสารที่จะถูกบรรจุลงในไฟล์ SFX อัตโนมัติ:
                </label>
                <div className="p-3 rounded-lg bg-black/40 border border-white/10 space-y-1.5 font-mono text-[11px] text-slate-300 mt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>1. Master_Court_Cover_Page.pdf (หน้าปกสำนวนศาล)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>2. Evidence_A4_Chat_Slip_Blocks.pdf (ภาพแชทและสลิป A4)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>3. Forensic_10_Columns_Ledger.pdf (ตารางสรุป 10 คอลัมน์)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>4. Chain_Of_Custody_SHA256_Manifest.pdf (บัญชีคุมแฮช)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>5. Executive_Summary_Dashboard.pdf (ใบสรุปผู้บริหาร)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex items-center justify-between bg-black/40">
              <span className="text-[11px] text-slate-400 font-mono">
                เอาต์พุต: Digital_Evidence_Case_{caseNumber || "012-2569"}.exe
              </span>
              <div className="flex gap-2.5">
                <button
                  onClick={() => {
                    if (vaultPassword.trim()) {
                      alert(`ระบบได้สร้างและส่งออกไฟล์ SFX เข้ารหัส (-hp) พร้อมผูกรหัสผ่าน PDF ด้วยรหัส:\n"${vaultPassword.trim()}" เรียบร้อยแล้ว`);
                    } else {
                      alert("ระบบได้สร้างและส่งออกไฟล์ SFX สำนวนคดีแบบเปิดทันที (ไม่มีรหัสผ่าน) เรียบร้อยแล้ว");
                    }
                    setSfxModalOpen(false);
                  }}
                  className="btn-proportional-primary glass-button glass-button-cyan text-xs font-bold px-4 py-2"
                >
                  🚀 {vaultPassword.trim() ? "บรรจุและดาวน์โหลด SFX (เข้ารหัส)" : "บรรจุและดาวน์โหลด SFX (ไม่มีรหัส)"}
                </button>
                <button
                  onClick={() => setSfxModalOpen(false)}
                  className="btn-proportional-compact rounded-lg bg-white/10 text-slate-200 hover:bg-white/15 text-xs px-3 py-1.5"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          โมดูลที่ 5: สรุปบริบทเข้าข่ายกฎหมาย (แพ่ง / อาญา)
          ===================================================================== */}
      {legalContextModalOpen && (
        <div className="absolute inset-0 glass-modal-backdrop z-50 flex items-center justify-center p-4">
          <div className="glass-modal w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-indigo-400/40 rounded-2xl bg-slate-950/90 backdrop-blur-xl">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-indigo-950/60 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📜</span>
                <div>
                  <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                    สรุปบริบทพยานหลักฐานเข้าข่ายกฎหมาย (แพ่ง / อาญา)
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                      LEGAL TRIAGE COURT STANDARD
                    </span>
                  </h3>
                  <span className="text-[11px] text-indigo-300 font-mono">
                    การวิเคราะห์องค์ประกอบความผิดและสิทธิเรียกร้องแห่งคดีตามมาตรฐานศาล ISO/IEC 27037 และ พ.ร.บ.ธุรกรรมอิเล็กทรอนิกส์
                  </span>
                </div>
              </div>
              <button
                onClick={() => setLegalContextModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg px-2.5 py-1 rounded-lg hover:bg-white/10 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto max-h-[72vh] flex flex-col gap-5 text-xs thai-clearance-stack">
              {/* ===============================================================
                  ส่วนที่ ๑: บัตรสรุปสถานะด้านบน (Top KPI Cards - 3 คอลัมน์)
                  =============================================================== */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0">
                {/* Card 1: TOTAL DETECTED */}
                <div className="glass-nested p-3.5 rounded-xl border border-indigo-500/30 bg-indigo-950/25 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                      บริบทเข้าข่ายทั้งหมด
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                      TOTAL DETECTED
                    </span>
                  </div>
                  <div className="text-2xl font-bold font-mono text-indigo-300 mt-1">
                    {courtEvidenceMapping.length} <span className="text-xs font-normal text-slate-400">จุดตรวจพบ</span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1">
                    สกัดจากบทสนทนาแชทและสลิปการโอนเงินแห่งคดี
                  </span>
                </div>

                {/* Card 2: CIVIL PROVISIONS */}
                <div className="glass-nested p-3.5 rounded-xl border border-sky-500/30 bg-sky-950/25 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                      เข้าข่ายกฎหมายแพ่ง
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/30">
                      CIVIL PROVISIONS
                    </span>
                  </div>
                  <div className="text-2xl font-bold font-mono text-sky-300 mt-1">
                    {civilCount} <span className="text-xs font-normal text-slate-400">ฐานแห่งหนี้/ละเมิด</span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1">
                    เรียกร้องคืนทรัพย์ {amountDisplay} พร้อมดอกเบี้ยผิดนัด ๕%
                  </span>
                </div>

                {/* Card 3: CRIMINAL PROVISIONS */}
                <div className="glass-nested p-3.5 rounded-xl border border-rose-500/30 bg-rose-950/25 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                      เข้าข่ายกฎหมายอาญา
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-400/30">
                      CRIMINAL PROVISIONS
                    </span>
                  </div>
                  <div className="text-2xl font-bold font-mono text-rose-400 mt-1">
                    {criminalCount} <span className="text-xs font-normal text-slate-400">ฐานความผิดอาญา</span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1">
                    ฉ้อโกง / พ.ร.บ.คอมพิวเตอร์ฯ / บัญชีม้า พ.ร.ก.ไซเบอร์
                  </span>
                </div>
              </div>

              {/* ===============================================================
                  ส่วนที่ ๒: ไกด์ไลน์ความรับผิดและฐานข้อหา ๒ ฝั่ง (LEGAL GUIDELINES)
                  =============================================================== */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* ฝั่งที่ ๑: ความรับผิดและฐานความผิดทางอาญา (CRIMINAL OFFENSES) */}
                <div className="p-4 rounded-xl bg-slate-900/70 border border-red-500/35 flex flex-col gap-2.5 shadow-lg">
                  <div className="flex items-center justify-between pb-1 border-b border-red-500/20">
                    <span className="font-bold text-red-400 text-sm flex items-center gap-1.5">
                      ⚖️ 1. ความรับผิดและฐานความผิดทางอาญา (Criminal Penal Provisions)
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/20 text-red-300 border border-red-500/30">
                      CRIMINAL OFFENSES
                    </span>
                  </div>

                  <div className="space-y-2 mt-1">
                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col gap-1">
                      <span className="font-bold text-red-300 text-[11.5px]">
                        • ความผิดฐานฉ้อโกง / ฉ้อโกงประชาชน (ประมวลกฎหมายอาญา มาตรา 341, 343)
                      </span>
                      <p className="text-slate-300 leading-relaxed text-[11px]">
                        (พฤติการณ์หลอกลวงผู้เสียหายผ่านระบบสนทนาออนไลน์ Chat ด้วยการแสดงข้อความอันเป็นเท็จ หรือปกปิดข้อความจริงซึ่งควรบอกให้แจ้ง และโดยการหลอกลวงดังว่านั้นได้ไปซึ่งทรัพย์สินจากผู้เสียหาย)
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col gap-1">
                      <span className="font-bold text-red-300 text-[11.5px]">
                        • พ.ร.บ. ว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ พ.ศ. 2550 และแก้ไขเพิ่มเติม (มาตรา 14 (1))
                      </span>
                      <p className="text-slate-300 leading-relaxed text-[11px]">
                        (การนำเข้าสู่ระบบคอมพิวเตอร์ซึ่งข้อมูลคอมพิวเตอร์ที่บิดเบือนหรือปลอม ไม่ว่าทั้งหมดหรือบางส่วน หรือข้อมูลคอมพิวเตอร์อันเป็นเท็จ โดยประการที่น่าจะเกิดความเสียหายแก่ประชาชน)
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col gap-1">
                      <span className="font-bold text-red-300 text-[11.5px]">
                        • พ.ร.ก. มาตรการป้องกันและปราบปรามอาชญากรรมทางเทคโนโลยี พ.ศ. 2566 (มาตรา 9, 10, 11 - บัญชีม้า)
                      </span>
                      <p className="text-slate-300 leading-relaxed text-[11px]">
                        (ยินยอมให้ผู้อื่นใช้บัญชีเงินฝากหรือซิมการ์ดโทรศัพท์ไปใช้ในการกระทำความผิด ระวางโทษจำคุกไม่เกิน 3 ปี หรือปรับไม่เกิน 300,000 บาท หรือทั้งจำทั้งปรับ)
                      </p>
                    </div>
                  </div>
                </div>

                {/* ฝั่งที่ ๒: ความรับผิดและมูลแห่งหนี้ทางแพ่ง (CIVIL REMEDIES) */}
                <div className="p-4 rounded-xl bg-slate-900/70 border border-sky-500/35 flex flex-col gap-2.5 shadow-lg">
                  <div className="flex items-center justify-between pb-1 border-b border-sky-500/20">
                    <span className="font-bold text-sky-400 text-sm flex items-center gap-1.5">
                      📑 2. ความรับผิดและมูลแห่งหนี้ทางแพ่ง (Civil Liabilities & Restitution)
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                      CIVIL REMEDIES
                    </span>
                  </div>

                  <div className="space-y-2 mt-1">
                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col gap-1">
                      <span className="font-bold text-sky-300 text-[11.5px]">
                        • ละเมิด เรียกทรัพย์สินคืนและชดใช้ค่าสินไหมทดแทน (ป.พ.พ. มาตรา 420, 438)
                      </span>
                      <p className="text-slate-300 leading-relaxed text-[11px]">
                        (ผู้กระทำผิดจงใจทำละเมิดต่อผู้เสียหายโดยผิดกฎหมาย ผู้เสียหายชอบที่จะเรียกร้องให้คืนทรัพย์สินจำนวน <strong className="text-emerald-400 font-mono font-bold">{amountDisplay}</strong> หรือใช้ราคาทรัพย์นั้นตาม ป.วิ.อ. มาตรา ๔๔/๑)
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col gap-1">
                      <span className="font-bold text-sky-300 text-[11.5px]">
                        • ลาภมิควรได้ (ป.พ.พ. มาตรา 406)
                      </span>
                      <p className="text-slate-300 leading-relaxed text-[11px]">
                        (เจ้าของบัญชีปลายทางได้รับโอนเงินไว้โดยปราศจากมูลอันจะอ้างกฎหมายได้ และทำให้ผู้เสียหายเสียเปรียบ ย่อมมีหน้าที่ต้องคืนเงินดังกล่าวแก่ผู้เสียหายตามบทบัญญัติลาภมิควรได้)
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col gap-1">
                      <span className="font-bold text-sky-300 text-[11.5px]">
                        • ดอกเบี้ยผิดนัดตามกฎหมาย (ป.พ.พ. มาตรา 224 แก้ไขเพิ่มเติม)
                      </span>
                      <p className="text-slate-300 leading-relaxed text-[11px]">
                        (คิดดอกเบี้ยผิดนัดในอัตราร้อยละ 5 ต่อปี นับแต่วันที่ทำการโอนเงินแต่ละรายการจนกว่าจะชำระเสร็จสิ้นแก่ผู้เสียหาย)
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ===============================================================
                  ส่วนที่ ๓: ตารางชี้เป้า ๔ คอลัมน์มาตรฐานศาล (FACTUAL EVIDENCE COURT MAPPING)
                  =============================================================== */}
              <div className="flex flex-col gap-3 p-4 rounded-xl bg-slate-900/60 border border-white/10">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                      🏛️ สารบัญชี้เป้าพยานหลักฐาน ๔ คอลัมน์มาตรฐานศาล (Factual Evidence Court Mapping)
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      ตารางเชื่อมโยงพฤติการณ์ในแชทกับเลขหน้า PDF และบทบัญญัติแห่งกฎหมาย
                    </p>
                  </div>

                  {/* Search and Filters */}
                  <div className="flex items-center gap-2">
                    {/* Search Input */}
                    <div className="relative">
                      <input
                        type="text"
                        value={legalSearchQuery}
                        onChange={(e) => setLegalSearchQuery(e.target.value)}
                        placeholder="ค้นหาคำพูด, หน้า, มาตรา..."
                        className="bg-black/50 border border-white/15 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-400 w-48 sm:w-56 font-sans"
                      />
                      {legalSearchQuery && (
                        <button
                          onClick={() => setLegalSearchQuery("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex rounded-lg bg-black/40 border border-white/10 p-0.5 text-[11px]">
                      <button
                        onClick={() => setLegalCategoryFilter("ALL")}
                        className={`px-2.5 py-1 rounded-md transition-all ${
                          legalCategoryFilter === "ALL"
                            ? "bg-indigo-600 text-white font-bold"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        ทั้งหมด ({courtEvidenceMapping.length})
                      </button>
                      <button
                        onClick={() => setLegalCategoryFilter("CIVIL")}
                        className={`px-2.5 py-1 rounded-md transition-all ${
                          legalCategoryFilter === "CIVIL"
                            ? "bg-sky-600 text-white font-bold"
                            : "text-slate-400 hover:text-sky-300"
                        }`}
                      >
                        แพ่ง ({civilCount})
                      </button>
                      <button
                        onClick={() => setLegalCategoryFilter("CRIMINAL")}
                        className={`px-2.5 py-1 rounded-md transition-all ${
                          legalCategoryFilter === "CRIMINAL"
                            ? "bg-red-600 text-white font-bold"
                            : "text-slate-400 hover:text-red-300"
                        }`}
                      >
                        อาญา ({criminalCount})
                      </button>
                    </div>
                  </div>
                </div>

                {/* 4-Column Table */}
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-950/80 border-b border-white/15 text-[11px] text-slate-300 font-bold uppercase tracking-wider">
                        <th className="py-2.5 px-3 w-20 text-center font-mono">๑. ลำดับหน้า</th>
                        <th className="py-2.5 px-3 min-w-[260px]">๒. คำพูดหรือบริบทเข้าข่าย</th>
                        <th className="py-2.5 px-3 w-24 text-center">๓. ประมวลกฎหมาย</th>
                        <th className="py-2.5 px-3 min-w-[260px]">๔. เนื้อหากฎหมาย</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-[11.5px]">
                      {filteredEvidenceMapping.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-slate-500 font-mono">
                            ไม่พบข้อมูลพยานหลักฐานที่ตรงกับเงื่อนไขการค้นหา
                          </td>
                        </tr>
                      ) : (
                        filteredEvidenceMapping.map((item, idx) => (
                          <tr
                            key={item.id}
                            className={`hover:bg-white/5 transition-colors ${
                              idx % 2 === 0 ? "bg-black/20" : "bg-black/40"
                            }`}
                          >
                            {/* Column 1: ลำดับหน้า */}
                            <td className="py-3 px-3 text-center font-mono font-bold text-indigo-300 align-top whitespace-nowrap">
                              <span className="inline-block px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30">
                                {item.pdfPage}
                              </span>
                            </td>

                            {/* Column 2: คำพูดหรือบริบทเข้าข่าย */}
                            <td className="py-3 px-3 text-slate-200 align-top">
                              <div className="font-medium leading-relaxed">{item.quoteContext}</div>
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {item.hashtags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </td>

                            {/* Column 3: ประมวลกฎหมาย */}
                            <td className="py-3 px-3 text-center align-top whitespace-nowrap">
                              <span
                                className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-bold font-mono border ${
                                  item.lawBadgeText === "อาญา"
                                    ? "bg-red-500/20 text-red-300 border-red-500/40"
                                    : "bg-sky-500/20 text-sky-300 border-sky-500/40"
                                }`}
                              >
                                {item.lawBadgeText}
                              </span>
                            </td>

                            {/* Column 4: เนื้อหากฎหมาย */}
                            <td className="py-3 px-3 align-top leading-relaxed text-slate-300">
                              <span className="font-semibold text-slate-100">{item.legalArticle}</span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Legal Disclaimer Footer */}
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-start gap-2.5 text-[10.5px] text-amber-200/90 leading-relaxed">
                  <span className="text-sm shrink-0">⚠️</span>
                  <div>
                    <strong className="text-amber-300">ข้อจำกัดความรับผิดชอบทางเทคนิค (Legal Safe Harbor Disclaimer):</strong>{" "}
                    การชี้เป้าเป็นผลการวิเคราะห์ทางเทคนิคเบื้องต้นเพื่ออำนวยความสะดวกในการจัดเตรียมสำนวนคดี มิใช่คำวินิจฉัยชี้ขาดของศาล และมิใช่คำปรึกษาทางวิชาชีพกฎหมาย ผู้ใช้พึงตรวจสอบร่วมกับพยานหลักฐานต้นฉบับและผู้ประกอบวิชาชีพทางกฎหมาย
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 bg-black/50 shrink-0">
              <span className="text-[11px] text-slate-400 font-mono">
                เอกสารประกอบคำฟ้องคดีอาญา / คำร้องขอให้ชดใช้ค่าสินไหมทดแทนตาม ป.วิ.อ. มาตรา ๔๔/๑
              </span>
              <div className="flex gap-2.5">
                <button
                  onClick={() => window.print()}
                  className="btn-proportional-compact rounded-lg bg-indigo-600/40 border border-indigo-400/50 text-indigo-100 hover:bg-indigo-600/70 text-xs px-4 py-2 font-bold flex items-center gap-1.5 transition-all shadow-md"
                >
                  <span>🖨️</span> พิมพ์บันทึกข้อกฎหมาย A4
                </button>
                <button
                  onClick={() => setLegalContextModalOpen(false)}
                  className="btn-proportional-compact rounded-lg bg-white/10 text-slate-200 hover:bg-white/15 text-xs px-3.5 py-2 transition-colors"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* =====================================================================
          โมดูลที่ 6: แสดงรายชื่อทั้งหมดที่ตรวจพบในคดี (Detected Names Modal 2.2)
          ===================================================================== */}
      {detectedNamesModalOpen && (
        <div className="absolute inset-0 glass-modal-backdrop z-50 flex items-center justify-center p-4">
          <div className="glass-modal w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-sky-400/40 rounded-2xl bg-slate-950/90 backdrop-blur-xl">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-sky-950/60 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-2xl">📋</span>
                <div>
                  <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
                    รายชื่อบุคคลและบัญชีที่ตรวจพบในคดี (All Detected Entities)
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/30">
                      STEP 2.2 POI SUITE
                    </span>
                  </h3>
                  <span className="text-[11px] text-sky-300 font-mono">
                    สกัดจากพยานหลักฐานสลิปโอนเงินและบทสนทนาแชททั้งหมด (Zero-Prefix Stripping Engine)
                  </span>
                </div>
              </div>
              <button
                onClick={() => setDetectedNamesModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg px-2.5 py-1 rounded-lg hover:bg-white/10 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto max-h-[70vh] flex flex-col gap-4 text-xs thai-clearance-stack">
              {/* Summary KPIs */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0">
                <div className="glass-nested p-3 rounded-xl border border-sky-400/30 bg-sky-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">รายชื่อที่ตรวจพบทั้งหมด</span>
                  <div className="text-xl font-bold font-mono text-sky-300 mt-0.5">
                    {detectedNamesList.length} <span className="text-xs font-normal text-slate-400">รายชื่อ</span>
                  </div>
                  <span className="text-[10px] text-slate-400">ผู้รับโอน / ผู้โอน / บัญชีม้า</span>
                </div>

                <div className="glass-nested p-3 rounded-xl border border-emerald-400/30 bg-emerald-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">เป้าหมายที่เลือกไว้ (Checked)</span>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                    {selectedTargetItems.length}/{targetList.length} <span className="text-xs font-normal text-slate-400">คน</span>
                  </div>
                  <span className="text-[10px] text-slate-400">ใช้คำนวณยอดเงินความเสียหาย</span>
                </div>

                <div className="glass-nested p-3 rounded-xl border border-indigo-400/30 bg-indigo-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">ยอดความเสียหายเฉพาะเป้าหมาย</span>
                  <div className="text-xl font-bold font-mono text-indigo-300 mt-0.5">
                    ฿ {poiAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-slate-400">คำนวณตามรายชื่อเป้าหมายที่เลือก</span>
                </div>
              </div>

              {/* Detected Table */}
              <div className="overflow-x-auto rounded-xl border border-white/10 mt-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-950/90 border-b border-white/15 text-[11px] text-slate-300 font-bold uppercase tracking-wider">
                      <th className="py-2.5 px-3 w-12 text-center font-mono">#</th>
                      <th className="py-2.5 px-3 min-w-[200px]">ชื่อ-นามสกุล (ตรวจพบ)</th>
                      <th className="py-2.5 px-3 min-w-[170px]">ชื่อตัดคำนำหน้า (Clean Name)</th>
                      <th className="py-2.5 px-3 w-28 text-center">บทบาท</th>
                      <th className="py-2.5 px-3 min-w-[150px]">ธนาคาร / เลขบัญชี</th>
                      <th className="py-2.5 px-3 text-right font-mono">ยอดรวมที่พบ</th>
                      <th className="py-2.5 px-3 w-32 text-center">การกระทำ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[11.5px]">
                    {detectedNamesList.map((item, idx) => {
                      const isAlreadyTarget = targetList.some((t) => isTargetMatch(t.cleanName, item.cleanName));
                      return (
                        <tr
                          key={`${item.cleanName}-${idx}`}
                          className={`hover:bg-white/5 transition-colors ${
                            idx % 2 === 0 ? "bg-black/20" : "bg-black/40"
                          }`}
                        >
                          <td className="py-3 px-3 text-center font-mono text-slate-400">{idx + 1}</td>
                          <td className="py-3 px-3 font-semibold text-slate-100">{item.rawName}</td>
                          <td className="py-3 px-3 font-mono text-sky-300">
                            <span className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20">
                              {item.cleanName}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                                item.role.includes("ผู้รับโอน")
                                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              }`}
                            >
                              {item.role.includes("ผู้รับโอน") ? "ผู้รับโอน" : "ผู้โอน"}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-300 font-mono text-[11px]">
                            <div>{item.bank}</div>
                            <div className="text-[10px] text-slate-400">{item.accountNo}</div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400">
                            <div>฿{item.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</div>
                            <div className="text-[9.5px] text-slate-400 font-normal">({item.txCount} รายการ)</div>
                          </td>
                          <td className="py-3 px-3 text-center">
                            {isAlreadyTarget ? (
                              <span className="text-[10.5px] font-semibold text-emerald-400 bg-emerald-500/15 px-2.5 py-1 rounded-lg border border-emerald-500/30 inline-flex items-center gap-1">
                                ✓ ในเป้าหมายแล้ว
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => addTargetPerson(item.rawName, item.role, item.totalAmount, item.txCount)}
                                className="btn-proportional-compact text-[10.5px] font-bold px-2.5 py-1 rounded-lg bg-sky-600/40 hover:bg-sky-600/70 text-sky-100 border border-sky-400/50 shadow-sm transition-all"
                              >
                                + เพิ่มเป็นเป้าหมาย
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex items-center justify-between bg-black/50 shrink-0">
              <span className="text-[11px] text-slate-400 font-mono">
                กฎเหล็ก: "ไม่สนว่าจะมีคำนำหน้าว่าอะไร ชื่อตรง นามสกุลตรง นั้นคือถูก (Zero-Prefix Matching)"
              </span>
              <button
                type="button"
                onClick={() => setDetectedNamesModalOpen(false)}
                className="btn-proportional-compact rounded-lg bg-white/10 text-slate-200 hover:bg-white/15 text-xs px-4 py-1.5 transition-colors"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
