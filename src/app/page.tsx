"use client";

import React, { useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import type { SlipExtraction } from "@/schemas/slip.schema";
import type { ChatEvidenceLayerPage, EmbeddedSlipRecord } from "@/types/embedded-slip";
import type { SlipOcrDiagnosticTrace } from "@/types/slip-ocr-trace";
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
import TyphoonOcrReview from "@/components/TyphoonOcrReview";
import { ModeProvider } from "@/context/ModeContext";
import { maskAccountNumber, maskPersonName } from "@/utils/privacy-mask";
import { stripThaiTitlePrefix, findExactTargetIdentity, isExactTargetMatch, mergeDetectedTargetList, buildDetectedTargetPeople, type TargetPersonItem } from "@/utils/target-matcher";
import { createSearchSlipExportErrorStatus, createSearchSlipScanCompleteStatus, createSearchSlipScanErrorStatus, type SearchSlipScanStatus } from "@/utils/search-slip-review-state";
import { useSessionPersistence } from "@/hooks/useSessionPersistence";
import {
  resolveEvidencePageType,
  resolveHeaderMode,
  resolveHeaderCorroborated,
  resolveHeaderPageNumber,
  resolveWebHeaderStatus,
  fitCanvasText,
  type EvidencePageType,
} from "@/utils/forensic-header-machine";
import { extractSlipsLocally } from "@/utils/local-qr-extractor";
import { findMatchingSlipRecord, getAiFilledFields, mergeAiSlipProposal, projectAiSlipBounds, retainAiOnlyRecordsAfterReprocess, retainSenderNameAfterReprocess } from "@/utils/ai-slip-candidate.mjs";
import { extractSlipCandidatesWithLocalOcr, getCachedChatEvidenceLayers, readChatPreflight } from "@/utils/local-slip-ocr";
import { explainSlipOcrRegionRejection } from "@/utils/slip-ocr-trace.mjs";
import { finalizeSlipCandidates } from "@/utils/finalize-slip-candidates.mjs";
import { buildSlipExtractionStatus, buildSlipQrWarning } from "@/utils/slip-extraction-status.mjs";
import { dedupeEmbeddedSlipDetections } from "@/utils/dedupe-embedded-slip-detections.mjs";
import { buildNamedCaseOutputPlans, groupImageBatchByPrefix, prepareImageBatch } from "@/utils/prepare-image-batch.mjs";
import { fitImageToEvidenceBlock } from "@/utils/fit-image-to-evidence-block.mjs";
import { mapWithConcurrency, runQrThenOcrPasses } from "@/utils/map-with-concurrency";
import { computeFileSha256, getCachedSlip, setCachedSlip, clearAllSlipCache } from "@/utils/forensic-sha256-cache";
import { findExactFileDuplicateGroups } from "@/utils/exact-file-duplicates.mjs";
import { findReferenceMatchGroups } from "@/utils/reference-match-groups.mjs";
import { buildChatOcrGroups, findChatSlipCorroborationCandidates, getCorroborationBasisLabel } from "@/utils/chat-slip-corroboration.mjs";
import { countChatPagesWithEmbeddedSlips } from "@/utils/embedded-slip-page-count.mjs";
import { buildConsistentReviewPacketPayload } from "@/utils/consistent-review-packet.mjs";
import { summarizeDetectedSlipRecipients } from "@/utils/slip-recipient-summary";
import { sliceChatImageLocally } from "@/utils/canvas-dicut-chat";
import { mapSliceBoundsToSource } from "@/utils/slice-coordinate-map";
import { mapSourceSlipCandidateToChatSlice } from "@/utils/chat-slip-source-fallback.mjs";
import { mapEvidenceBoundsToCanvas } from "@/utils/candidate-review-overlay";
import { stitchChatImages, type StitchedChatStream } from "@/utils/stitch-chat-images";
import { readImageCaptureTime, sortChatInputsByCaptureTime } from "@/utils/chat-capture-metadata.mjs";
import { mapStreamBoundsToSources } from "@/utils/map-stream-bounds";
import { formatLayer2ReviewItem } from "@/utils/two-layer-segmentation.mjs";
import { formatSlipReviewCounts, reconcileReviewedDuplicateReferences, summarizeConfirmedSlipRecords, type DuplicateReferenceResolution } from "@/utils/confirmed-ledger";
import { buildNetReconciliationDossier } from "@/utils/net-reconciliation-dossier.mjs";
import { appendUniqueManifestOccurrences } from "@/utils/manifest-occurrences.mjs";
import { buildSlipIndex, buildSlipIndexMarkdown, makePdfPageMapKey, prepareNamedGroupSlipIndex, prepareSlipRecordArtifact } from "@/utils/slip-index.mjs";
import { buildEvidenceContentPageDescriptors } from "@/utils/evidence-content-page-descriptors.mjs";
import { buildFinancialSummaryIndexRows } from "@/utils/financial-summary-index.mjs";
import { selectTargetDossierRecords } from "@/utils/only-target-dossier.mjs";
import { discoverChatEntityOccurrences, getChatEntityDiscoveryDiagnostics } from "@/utils/chat-entity-discovery.mjs";
import { detectImageType } from "@/utils/detect-image-type";
import { findSimilarImagePairs, perceptualHashFromDataUrl } from "@/utils/perceptual-image-similarity";
import { buildDuplicateAuditMatrix, filterVisualPairsByTransactionAnchors, hasConflictingTransactionAnchors } from "@/utils/duplicate-audit-matrix.mjs";
import { buildPixelDuplicateWarnings, buildUniquePixelJobPlan, expandUniquePixelJobResults, findPixelIdenticalPageGroups, type PixelPageOccurrence } from "@/utils/pixel-identical-pages.mjs";
import { buildQrDecoderDiagnostics } from "@/utils/qr-decoder-fallback.mjs";
import { buildProcessingWarningEntries } from "@/utils/processing-warning-entries.mjs";
import { clearEvidenceQueueSnapshot, EXTRACTION_VERSION, loadEvidenceQueueSnapshot, restoreEvidenceQueueSnapshot, saveEvidenceQueueSnapshot, serializeEvidenceQueueSnapshot } from "@/utils/evidence-queue-persistence";
import { buildEvidenceDiagnosticTrace } from "@/utils/evidence-diagnostic-trace.mjs";
import { classifyUniqueEvidenceItems } from "@/utils/evidence-detection-pipeline.mjs";

interface ExtractionMetadata {
  file_name: string;
  mime_type: string;
  sha256: string;
  size_bytes: number;
  extracted_at: string;
}

type CenterViewMode = "EVIDENCE_A4" | "COVER_PAGE" | "HASH_MANIFEST" | "EXECUTIVE_SUMMARY";
type SearchSlipScanCandidate = {
  occurrence_id: string;
  page: number;
  pages: number[];
  repeated_ref: boolean;
  amount: string;
  datetime: string;
  ref_id: string;
  sender_bank: string;
  sender_name: string;
  receiver_bank: string;
  receiver_name: string;
  memo: string;
  raw_text: string;
  review_status: string;
};
type DuplicateAuditCandidate = {
  occurrenceId: string;
  source: string;
  chatPage: string;
  dossierPage: number | null;
  locations: string[];
  reasons: string[];
  perceptualDistance?: number;
};
type DuplicateAuditMatrix = {
  summary: { totalOccurrenceCount: number; duplicateOccurrenceCount: number; withoutDuplicateSignalCount: number; affectedPages: string[]; affectedPageCount: number };
  rows: Array<{
    occurrenceId: string;
    source: string;
    locations: string[];
    status: "review" | "ambiguous";
    masterOccurrenceId: string | null;
    masterCandidates: DuplicateAuditCandidate[];
    reviewOnly: true;
  }>;
};

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export default function MasterEvidenceWorkspace() {
  const [currentStep, setCurrentStep] = useState(1);
  const [evidenceMode, setEvidenceMode] = useState<"CHAT" | "SLIP">("SLIP");
  const [centerView, setCenterView] = useState<CenterViewMode>("EVIDENCE_A4");
  const [fullBookOpen, setFullBookOpen] = useState(false);

  // Real-Time Clock State (Web App Top Header Bar)
  const mounted = useSyncExternalStore(subscribeToHydration, getClientHydrationSnapshot, getServerHydrationSnapshot);
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
  const [caseNumber, setCaseNumber] = useSessionPersistence<string>("case_number", "เรื่องตรวจสอบที่ 012/2569");

  const [loading, setLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<SlipExtraction | null>(null);
  const [metadata, setMetadata] = useState<ExtractionMetadata | null>(null);
  const [manifestList, setManifestList] = useState<HashManifestEntry[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [showEvidenceLayers, setShowEvidenceLayers] = useState(false);
  const [evidenceLayerView, setEvidenceLayerView] = useState<"LAYER_1" | "LAYER_2">("LAYER_1");
  const [ledgerModalOpen, setLedgerModalOpen] = useState(false);
  const [duplicateReferenceResolutions, setDuplicateReferenceResolutions] = useState<Record<string, DuplicateReferenceResolution>>({});
  const [duplicateMasterSelections, setDuplicateMasterSelections] = useState<Record<string, string>>({});
  const [netDossierStatus, setNetDossierStatus] = useState<string | null>(null);
  const [ledgerXlsxStatus, setLedgerXlsxStatus] = useState<string | null>(null);
  const [evidenceContentStatus, setEvidenceContentStatus] = useState<string | null>(null);
  const [summaryIndexStatus, setSummaryIndexStatus] = useState<string | null>(null);
  const [slipIndexStatus, setSlipIndexStatus] = useState<string | null>(null);
  const [pendingNamedSlipIndexes, setPendingNamedSlipIndexes] = useState<Array<{
    groupLabel: string;
    fileName: string;
    json: string;
    transactionCount: number;
  }>>([]);
  const [pdfPageMap, setPdfPageMap] = useState<Record<string, number>>({});
  const [searchSlipScanCandidates, setSearchSlipScanCandidates] = useState<SearchSlipScanCandidate[]>([]);
  const [evidenceContentPageMap, setEvidenceContentPageMap] = useState<{ sourceKey: string; pages: Record<string, number> } | null>(null);
  const [linkageModalOpen, setLinkageModalOpen] = useState(false);
  const [sfxModalOpen, setSfxModalOpen] = useState(false);
  const [legalContextModalOpen, setLegalContextModalOpen] = useState(false);
  const [legalSearchQuery, setLegalSearchQuery] = useState("");
  const [legalCategoryFilter, setLegalCategoryFilter] = useState<"ALL" | "CIVIL" | "CRIMINAL">("ALL");
  const [exportPassword, setExportPassword] = useState("");
  const [targetDossierStatus, setTargetDossierStatus] = useState("");
  const [exportingArtifact, setExportingArtifact] = useState<"PDF" | "SFX" | "CONTENT" | "SUMMARY_INDEX" | "CORROBORATION" | "DERIVED" | null>(null);
  const [corroborationPacketStatus, setCorroborationPacketStatus] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [searchSlipScanStatus, setSearchSlipScanStatus] = useState<SearchSlipScanStatus>({ state: "idle", message: "" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [queueRestoreNotice, setQueueRestoreNotice] = useState<string | null>(null);

  // Step 2: Target Name Matcher & POI Forensic Suite States (Pure Zero State)
  const [targetListSnapshot, setTargetListSnapshot] = useState<TargetPersonItem[]>([]);
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
    category: "PENDING" | "SLIP" | "CHAT";
    extractionVersion?: number;
    detectType?: string;
    status: "staged" | "processing" | "done" | "error";
    data?: SlipExtraction;
    sourceBounds?: { x: number; y: number; width: number; height: number };
    ocrTextBoxes?: Array<{ text: string; confidence: number; bounds: { x: number; y: number; width: number; height: number }; classification?: "slip_evidence" | "chat_context" | "uncertain"; reason?: string; supportsFields?: string[] }>;
    ocrDiagnosticTrace?: SlipOcrDiagnosticTrace;
    meta?: ExtractionMetadata;
    error?: string;
    isDuplicate?: boolean;
    isConfirmed?: boolean;
    aiProposedFields?: string[];
    duplicateOfRef?: string;
    chatSlices?: string[];
    chatSliceGeometry?: Array<{ sliceIndex: number; startY: number; endY: number; contentScaleX?: number; contentScaleY: number; contentOffsetX?: number; streamPageNumber?: number }>;
    chatStreamPageNumbers?: number[];
    chatSourceSegments?: StitchedChatStream["sourceSegments"];
    chatEvidenceLayers?: ChatEvidenceLayerPage[];
    qrScanDiagnostic?: NonNullable<ChatEvidenceLayerPage["qrScanDiagnostic"]>;
    stitchedIntoItemId?: string;
    stitchingWarnings?: string[];
    embeddedSlips?: EmbeddedSlipRecord[];
    processingWarnings?: string[];
  }>>([]);
  const [queuePersistenceReady, setQueuePersistenceReady] = useState(false);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number>(0);
  const [selectedSliceIndex, setSelectedSliceIndex] = useState<number>(0);
  const [selectedSlipRecordId, setSelectedSlipRecordId] = useState<string | null>(null);
  const [aiScanItemId, setAiScanItemId] = useState<string | null>(null);
  const [aiScanMessage, setAiScanMessage] = useState<string | null>(null);
  const exactDuplicateGroups = useMemo(() => findExactFileDuplicateGroups(stagedQueue.map((item) => ({
    id: item.id,
    fileName: item.file.name,
    sha256: item.meta?.sha256 || "",
  }))), [stagedQueue]);
  const filenamePrefixGroups = useMemo(() => groupImageBatchByPrefix(stagedQueue.map((item) => ({
    id: item.id,
    fileName: item.file.name,
  }))), [stagedQueue]);
  const exactDuplicateOf = useMemo(() => {
    const matches = new Map<string, string>();
    exactDuplicateGroups.forEach((group) => {
      const first = group.occurrences[0];
      const firstIndex = stagedQueue.findIndex((item) => item.id === first.id);
      group.occurrences.slice(1).forEach((occurrence) => {
        matches.set(occurrence.id, `#${firstIndex + 1} ${first.fileName}`);
      });
    });
    return matches;
  }, [exactDuplicateGroups, stagedQueue]);
  const ledgerRecords = useMemo<Array<{ id: string; sourceItemId: string; sha256: string; data: SlipExtraction; isDuplicate: boolean; isConfirmed: boolean; chatPage: string; dossierPage: number | null; source: string; bounds?: { x: number; y: number; width: number; height: number }; crossesSourceBoundary?: boolean; ocrTextBoxes?: Array<{ text: string; confidence: number; bounds: { x: number; y: number; width: number; height: number }; classification?: "slip_evidence" | "chat_context" | "uncertain"; reason?: string; supportsFields?: string[] }>; ocrDiagnosticTrace?: SlipOcrDiagnosticTrace; crop: string; needsReview: boolean; aiProposedFields?: string[] }>>(() => stagedQueue.flatMap((item) => {
    if (item.status !== "done") return [];
    const sourceIndex = stagedQueue.findIndex((candidate) => candidate.id === item.id);
    const pagesBefore = stagedQueue.slice(0, sourceIndex).reduce(
      (count, earlier) => count + (!earlier.isDuplicate ? earlier.category === "CHAT" ? earlier.chatSlices?.length ?? 1 : 1 : 0), 0
    );
    if (item.category === "CHAT") {
      return (item.embeddedSlips || []).map((record) => ({
        id: record.id, sourceItemId: record.sourceItemId, sha256: record.sourceSha256 || item.meta?.sha256 || "", data: record.data, isDuplicate: record.isDuplicate, isConfirmed: !!record.isConfirmed,
        chatPage: `${record.chatPageNumber} / ${record.chatPageCount}`,
        dossierPage: record.dossierPageNumber, source: record.sourceFileName, bounds: record.sourceBounds, crossesSourceBoundary: record.crossesSourceBoundary,
        crop: record.cropDataUrl, ocrTextBoxes: record.ocrTextBoxes, ocrDiagnosticTrace: record.ocrDiagnosticTrace, needsReview: !record.isConfirmed || !record.data.transaction.amount || !record.data.transaction.reference_no,
        aiProposedFields: record.aiProposedFields,
      }));
    }
    return item.data ? [{
      id: item.id, sourceItemId: item.id, sha256: item.meta?.sha256 || "", data: item.data, isDuplicate: !!item.isDuplicate, isConfirmed: !!item.isConfirmed,
      chatPage: "-", dossierPage: 4 + pagesBefore, source: item.file.name,
      bounds: item.sourceBounds,
      ocrTextBoxes: item.ocrTextBoxes,
      crop: item.previewUrl, needsReview: !item.isConfirmed || !item.data.transaction.amount || !item.data.transaction.reference_no,
      aiProposedFields: item.aiProposedFields,
    }] : [];
  }), [stagedQueue]);
  const contentVolumeSourceKey = useMemo(() => JSON.stringify(stagedQueue.map((item) => [
    item.id,
    item.file.name,
    item.meta?.sha256 || "",
    item.category,
    item.stitchedIntoItemId || "",
    item.chatStreamPageNumbers || [],
    item.chatSlices?.length || 0,
  ])), [stagedQueue]);
  const summaryPhysicalPages = evidenceContentPageMap?.sourceKey === contentVolumeSourceKey
    ? evidenceContentPageMap.pages
    : {};
  const summaryIndexReady = ledgerRecords.length > 0
    && ledgerRecords.every((record) => Number.isInteger(summaryPhysicalPages[record.id]) && summaryPhysicalPages[record.id] > 0);
  const ledgerReconciliation = useMemo(() => summarizeConfirmedSlipRecords(ledgerRecords.map((record) => ({
    id: record.id,
    isConfirmed: record.isConfirmed,
    amount: record.data.transaction.amount,
    referenceNo: record.data.transaction.reference_no,
  }))), [ledgerRecords]);
  const reviewedDuplicateSummary = useMemo(() => reconcileReviewedDuplicateReferences(ledgerRecords.map((record) => ({
    id: record.id,
    isConfirmed: record.isConfirmed,
    amount: record.data.transaction.amount,
    referenceNo: record.data.transaction.reference_no,
  })), duplicateReferenceResolutions), [ledgerRecords, duplicateReferenceResolutions]);
  const slipRecipientSummary = useMemo(
    () => summarizeDetectedSlipRecipients(ledgerRecords),
    [ledgerRecords]
  );
  const [perceptualHashes, setPerceptualHashes] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let active = true;
    void (async () => {
      const hashes = new Map<string, string>();
      for (const record of ledgerRecords) {
        try {
          hashes.set(record.id, await perceptualHashFromDataUrl(record.crop));
        } catch {
          // Unreadable or unsupported crops stay unevaluated.
        }
      }
      if (active) setPerceptualHashes(hashes);
    })();
    return () => { active = false; };
  }, [ledgerRecords]);
  const similarImageOf = useMemo(() => {
    const matches = new Map<string, Array<{ source: string; chatPage: string; dossierPage: number | null; crop: string; distance: number }>>();
    const recordsById = new Map(ledgerRecords.map((record) => [record.id, record]));
    const transactionAnchors = ledgerRecords.map((record) => ({
      id: record.id,
      referenceNo: record.data.transaction.reference_no,
      date: record.data.transaction.date,
      time: record.data.transaction.time,
    }));
    const pairs = filterVisualPairsByTransactionAnchors(
      findSimilarImagePairs(ledgerRecords.map((record) => ({ id: record.id, hash: perceptualHashes.get(record.id) || null }))),
      transactionAnchors,
    );
    pairs.forEach((pair: { leftId: string; rightId: string; distance: number }) => {
      const left = recordsById.get(pair.leftId);
      const right = recordsById.get(pair.rightId);
      if (!left || !right) return;
      matches.set(left.id, [...(matches.get(left.id) || []), { source: right.source, chatPage: right.chatPage, dossierPage: right.dossierPage, crop: right.crop, distance: pair.distance }]);
      matches.set(right.id, [...(matches.get(right.id) || []), { source: left.source, chatPage: left.chatPage, dossierPage: left.dossierPage, crop: left.crop, distance: pair.distance }]);
    });
    return matches;
  }, [ledgerRecords, perceptualHashes]);
  const duplicateAuditMatrix = useMemo<DuplicateAuditMatrix>(() => {
    const matrixRecords = ledgerRecords.map((record) => ({
      id: record.id,
      sourceItemId: record.sourceItemId,
      bounds: record.bounds,
      source: record.source,
      chatPage: record.chatPage,
      dossierPage: record.dossierPage,
      sha256: record.sha256,
      referenceNo: record.data.transaction.reference_no,
      date: record.data.transaction.date,
      time: record.data.transaction.time,
      amount: record.data.transaction.amount,
      senderAccount: record.data.sender.account_no,
      receiverAccount: record.data.receiver.account_no,
    }));
    const pairs = findSimilarImagePairs(ledgerRecords.map((record) => ({
      id: record.id,
      hash: perceptualHashes.get(record.id) || null,
    })));
    return buildDuplicateAuditMatrix(matrixRecords, pairs);
  }, [ledgerRecords, perceptualHashes]);
  const duplicateAuditOf = useMemo(
    () => new Map(duplicateAuditMatrix.rows.map((row) => [row.occurrenceId, row])),
    [duplicateAuditMatrix]
  );
  const referenceMatchOf = useMemo(() => {
    const matches = new Map<string, Array<{ source: string; chatPage: string; dossierPage: number | null; crop: string }>>();
    const recordsById = new Map(ledgerRecords.map((record) => [record.id, record]));
    const groups = findReferenceMatchGroups(ledgerRecords.map((record) => ({
      id: record.id,
      referenceNo: record.data.transaction.reference_no,
    })));
    groups.forEach((group) => {
      group.occurrences.forEach((occurrence) => {
        matches.set(occurrence.id, group.occurrences
          .filter((other) => other.id !== occurrence.id)
          .map((other) => {
            const record = recordsById.get(other.id)!;
            return { source: record.source, chatPage: record.chatPage, dossierPage: record.dossierPage, crop: record.crop };
          }));
      });
    });
    return matches;
  }, [ledgerRecords]);
  const chatSlipCorroborationCandidates = useMemo(() => {
    const slips = ledgerRecords.map((record) => ({
      id: record.id,
      amount: record.data.transaction.amount,
      referenceNo: record.data.transaction.reference_no,
      date: record.data.transaction.date,
      time: record.data.transaction.time,
    }));
    const recordsById = new Map(ledgerRecords.map((record) => [record.id, record]));
    const visualMatches = findSimilarImagePairs(ledgerRecords.map((record) => ({
      id: record.id,
      hash: perceptualHashes.get(record.id) || null,
    }))).flatMap((pair) => {
      const left = recordsById.get(pair.leftId);
      const right = recordsById.get(pair.rightId);
      if (!left || !right) return [];
      if (hasConflictingTransactionAnchors({
        referenceNo: left.data.transaction.reference_no,
        date: left.data.transaction.date,
        time: left.data.transaction.time,
      }, {
        referenceNo: right.data.transaction.reference_no,
        date: right.data.transaction.date,
        time: right.data.transaction.time,
      })) return [];
      const embedded = left.chatPage !== "-" ? left : right.chatPage !== "-" ? right : null;
      const master = left.chatPage === "-" ? left : right.chatPage === "-" ? right : null;
      const chatPageNumber = embedded ? Number.parseInt(embedded.chatPage, 10) : Number.NaN;
      if (!embedded || !master || !Number.isInteger(chatPageNumber)) return [];
      return [{
        chatSlipId: embedded.id,
        masterSlipId: master.id,
        chatSourceItemId: embedded.sourceItemId,
        chatPageNumber,
        distance: pair.distance,
      }];
    });
    const chatPages = stagedQueue
      .filter((item) => item.status === "done" && item.category === "CHAT")
      .flatMap((item) => (item.chatEvidenceLayers || []).map((page) => {
        const excludedRegions = (item.embeddedSlips || [])
          .filter((embedded) => embedded.chatPageNumber === page.pageNumber)
          .map((embedded) => ({ sourceItemId: embedded.sourceItemId, bounds: embedded.sourceBounds }));
        return {
          sourceItemId: item.id,
          pageNumber: page.pageNumber,
          groups: buildChatOcrGroups(page.layer2, excludedRegions, page.layer1),
        };
      }));
    return findChatSlipCorroborationCandidates({ slips, chatPages, visualMatches });
  }, [ledgerRecords, perceptualHashes, stagedQueue]);
  const chatPagesWithEmbeddedSlips = useMemo(
    () => countChatPagesWithEmbeddedSlips(stagedQueue),
    [stagedQueue],
  );
  const recomputeConfirmedEvidence = (queue: typeof stagedQueue) => {
    const records = queue.flatMap((item) => {
      if (item.status !== "done") return [];
      if (item.category === "CHAT") {
        return (item.embeddedSlips || []).map((record) => ({ id: record.id, isConfirmed: !!record.isConfirmed, amount: record.data.transaction.amount, referenceNo: record.data.transaction.reference_no, recipientName: record.data.receiver.name }));
      }
      return item.data ? [{ id: item.id, isConfirmed: !!item.isConfirmed, amount: item.data.transaction.amount, referenceNo: item.data.transaction.reference_no, recipientName: item.data.receiver.name }] : [];
    });
    const summary = summarizeConfirmedSlipRecords(records);
    let poiName: string | null = null;
    let poiLoss = 0;
    for (const record of records) {
      if (!record.isConfirmed) continue;
      if (record.recipientName) {
        poiName = record.recipientName;
        poiLoss += record.amount || 0;
      }
    }
    const chatPageCount = queue.reduce((count, item) => count + (item.category === "CHAT" ? (item.chatSlices?.length ?? (item.status === "done" ? 0 : 1)) : 0), 0);
    setEvidenceState((current) => ({
      ...current,
      totalNetLoss: summary.totalAmount,
      slipCount: summary.slipCount,
      duplicateCount: summary.duplicateCount,
      chatPageCount,
      poiName: poiName || current.poiName,
      poiLossSum: poiLoss,
      corroboratedPairsCount: 0,
      processedAt: new Date().toLocaleString("th-TH"),
    }));
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const stored = await loadEvidenceQueueSnapshot();
        const restored = await restoreEvidenceQueueSnapshot<typeof stagedQueue[number]>(stored);
        if (!active) {
          restored?.stagedQueue.forEach((item) => URL.revokeObjectURL(item.previewUrl));
          return;
        }
        if (restored) {
          if (restored.stalePendingCount > 0) {
            setQueueRestoreNotice(`ผล OCR เก่า ${restored.stalePendingCount} รายการถูกถอดออกจากผลตรวจที่ยังไม่ยืนยันแล้ว; ไฟล์ต้นฉบับยังอยู่ในคิว กรุณากดเริ่มประมวลผลใหม่`);
          }
          recomputeConfirmedEvidence(restored.stagedQueue);
          setStagedQueue((current) => {
            const knownIds = new Set(current.map((item) => item.id));
            const merged = [...restored.stagedQueue, ...current.filter((item) => !knownIds.has(item.id))];
            if (current.length === 0 && merged[0]) {
              setPreviewImage(merged[0].previewUrl);
              setSelectedItemIndex(0);
              if (merged[0].category !== "PENDING") setEvidenceMode(merged[0].category);
              if (merged[0].data) setExtractedData(merged[0].data);
              setCurrentStep(merged.some((item) => item.status === "done") ? 2 : 1);
            }
            return merged;
          });
          setManifestList(restored.manifestList as HashManifestEntry[]);
        }
      } catch (error) {
        if (active) setErrorMsg(error instanceof Error ? `กู้คืนคิวจากเครื่องไม่สำเร็จ: ${error.message}` : "กู้คืนคิวจากเครื่องไม่สำเร็จ");
      } finally {
        if (active) {
          setQueuePersistenceReady(true);
        }
      }
    })();
    return () => { active = false; };
  // Hydration runs once; queue state is intentionally merged inside the setter to preserve early intake.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!queuePersistenceReady || loading) return;
    const timer = window.setTimeout(() => {
      const snapshot = serializeEvidenceQueueSnapshot(stagedQueue, manifestList);
      void saveEvidenceQueueSnapshot(snapshot).catch((error: unknown) => {
        setErrorMsg(error instanceof Error ? `บันทึกผลไว้ในเครื่องไม่สำเร็จ: ${error.message}` : "บันทึกผลไว้ในเครื่องไม่สำเร็จ");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [queuePersistenceReady, loading, stagedQueue, manifestList]);

  const updateLedgerRecord = (recordId: string, field: "amount" | "reference_no" | "sender_name" | "sender_account" | "receiver_name" | "receiver_account", value: string) => {
    const amountValue = value === "" ? null : Number(value);
    const textValue = value || null;
    const updateData = (data: SlipExtraction): SlipExtraction => {
      if (field === "sender_name" || field === "sender_account") {
        const key = field === "sender_name" ? "name" : "account_no";
        const confidenceKey = field === "sender_name" ? "sender_name" : "sender_account";
        return {
          ...data,
          sender: { ...data.sender, [key]: textValue },
          confidence: { ...data.confidence, [confidenceKey]: 0 },
          ...(field === "sender_name" ? {
            reviewed_fields: [...new Set([...(data.reviewed_fields ?? []), "sender_name" as const])],
          } : {}),
        };
      }
      if (field === "receiver_name" || field === "receiver_account") {
        const key = field === "receiver_name" ? "name" : "account_no";
        const confidenceKey = field === "receiver_name" ? "receiver_name" : "receiver_account";
        return {
          ...data,
          receiver: { ...data.receiver, [key]: textValue },
          confidence: { ...data.confidence, [confidenceKey]: 0 },
          ...(field === "receiver_name" ? {
            reviewed_fields: [...new Set([...(data.reviewed_fields ?? []), "receiver_name" as const])],
          } : {}),
        };
      }
      return { ...data, transaction: field === "amount"
        ? { ...data.transaction, amount: amountValue }
        : { ...data.transaction, reference_no: textValue } };
    };
    const nextQueue = stagedQueue.map((item) => {
      if (item.id === recordId && item.data) {
        return { ...item, isConfirmed: false, data: updateData(item.data) };
      }
      if (item.embeddedSlips?.some((record) => record.id === recordId)) {
        return {
          ...item,
          embeddedSlips: item.embeddedSlips.map((record) => record.id === recordId ? {
            ...record,
            isConfirmed: false,
            data: updateData(record.data),
            needsReview: true,
          } : record),
        };
      }
      return item;
    });
    setStagedQueue(nextQueue);
    recomputeConfirmedEvidence(nextQueue);
  };

  const setLedgerRecordConfirmed = (recordId: string, isConfirmed: boolean) => {
    const nextQueue = stagedQueue.map((item) => {
      if (item.id === recordId) return { ...item, isConfirmed };
      if (item.embeddedSlips?.some((record) => record.id === recordId)) {
        return { ...item, embeddedSlips: item.embeddedSlips.map((record) => record.id === recordId ? { ...record, isConfirmed, needsReview: !isConfirmed } : record) };
      }
      return item;
    });
    setStagedQueue(nextQueue);
    recomputeConfirmedEvidence(nextQueue);
  };

  const scanSelectedSlipWithAi = async (itemId: string, engine: "gemini" | "slipvision" = "gemini") => {
    const item = stagedQueue.find((entry) => entry.id === itemId);
    if (!item || item.stitchedIntoItemId || (item.status !== "done" && item.status !== "error")) return;
    const engineLabel = engine === "slipvision" ? "SlipVision" : "Gemini";
    setAiScanItemId(itemId);
    setAiScanMessage(`กำลังสกัดจาก ${item.file.name} ด้วย ${engineLabel}; ผลจะรอตรวจทาน`);
    try {
      const body = new FormData();
      body.append("file", item.file, item.file.name);
      body.append("mode", "detect");
      const response = await fetch(engine === "slipvision" ? "/api/slips/slipvision" : "/api/slips/extract", { method: "POST", body });
      const result = await response.json() as {
        success: boolean;
        message?: string;
        candidates?: Array<{ bbox_1000: [number, number, number, number]; visual_cues: string[]; data: SlipExtraction }>;
        metadata?: ExtractionMetadata;
      };
      if (!response.ok || !result.success || !result.metadata || !Array.isArray(result.candidates)) {
        throw new Error(result.message || `API ตอบกลับ ${response.status}`);
      }
      if (result.metadata.sha256 !== await computeFileSha256(item.file)) {
        throw new Error("SHA-256 ของภาพที่ API ประมวลผลไม่ตรงกับไฟล์ต้นฉบับ");
      }
      const bitmap = await createImageBitmap(item.file);
      const sourceWidth = bitmap.width;
      const proposals = result.candidates.flatMap((candidate) => {
        const bounds = projectAiSlipBounds(candidate.bbox_1000, sourceWidth, bitmap.height);
        if (!bounds || bounds.width < 5 || bounds.height < 5) return [];
        const crop = document.createElement("canvas");
        crop.width = bounds.width;
        crop.height = bounds.height;
        const context = crop.getContext("2d");
        if (!context) return [];
        context.drawImage(bitmap, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
        return [{ bounds, cropDataUrl: crop.toDataURL("image/png"), data: {
          ...candidate.data,
          warnings: [...candidate.data.warnings, `${engineLabel} ตรวจพบกรอบสลิปจากภาพต้นฉบับ; หลักฐานภาพและ ${candidate.visual_cues.join(" / ")}; รอตรวจทาน`],
        } }];
      });
      bitmap.close();
      if (result.candidates.length > 0 && proposals.length !== result.candidates.length) {
        throw new Error("พิกัดกรอบที่ Gemini ส่งกลับไม่ถูกต้อง; ไม่บันทึกผลบางส่วน");
      }
      if (!proposals.length) {
        setAiScanMessage(`${engineLabel} ไม่พบสลิปใน ${item.file.name}; ภาพยังอยู่ในคิวและยังต้องตรวจด้วยตา`);
        return;
      }
      const pagesBefore = stagedQueue.slice(0, stagedQueue.findIndex((entry) => entry.id === itemId))
        .reduce((count, earlier) => count + (earlier.isDuplicate ? 0 : earlier.category === "CHAT" ? earlier.chatSlices?.length ?? 1 : 1), 0);
      let added = 0;
      let updated = 0;
      const nextQueue = stagedQueue.map((entry) => {
        if (entry.id !== itemId) return entry;
        if (entry.category !== "CHAT") {
          if (proposals.length !== 1) throw new Error("พบหลายสลิปในภาพที่จัดเป็นสลิปเดี่ยว; โปรดแยกภาพก่อน");
          const proposal = proposals[0];
          updated = entry.data ? 1 : 0;
          added = entry.data ? 0 : 1;
          return {
            ...entry, status: "done" as const, error: undefined, meta: entry.meta || result.metadata,
            data: entry.data ? mergeAiSlipProposal(entry.data, proposal.data) as SlipExtraction : proposal.data,
            sourceBounds: entry.sourceBounds || proposal.bounds, isConfirmed: false,
            aiProposedFields: entry.data
              ? [...new Set([...(entry.aiProposedFields || []), ...getAiFilledFields(entry.data, proposal.data)])]
              : ["all"],
          };
        }
        const records = [...(entry.embeddedSlips || [])];
        for (const [index, proposal] of proposals.entries()) {
          const match = findMatchingSlipRecord(records, proposal.bounds, proposal.data);
          if (match) {
            const matchIndex = records.findIndex((record) => record.id === match.id);
            records[matchIndex] = {
              ...records[matchIndex], data: mergeAiSlipProposal(match.data, proposal.data),
              isConfirmed: false, needsReview: true,
              aiProposedFields: [...new Set([...(match.aiProposedFields || []), ...getAiFilledFields(match.data, proposal.data)])],
            };
            updated += 1;
            continue;
          }
          const slices = entry.chatSlices || [];
          const sourceSegments = entry.chatSourceSegments || [];
          const mapped = mapSourceSlipCandidateToChatSlice(proposal, {
            sourceWidth, sourceItemId: entry.id, sourceSegments,
            slices: entry.chatSliceGeometry || [],
          });
          if (!mapped) throw new Error("ผูกพิกัดสลิปกับหน้าแชทไม่ได้; ไม่บันทึก candidate ที่ไม่มีหน้าอ้างอิง");
          records.push({
            id: `${entry.id}-gemini-${index + 1}`, extractionVersion: EXTRACTION_VERSION,
            sourceItemId: entry.id, sourceFileName: entry.file.name,
            sourceSha256: result.metadata!.sha256,
            sourceReferences: [{ sourceItemId: entry.id, fileName: entry.file.name, sha256: result.metadata!.sha256, bounds: proposal.bounds }],
            data: proposal.data, sourceBounds: proposal.bounds, candidateBounds: mapped.candidate.bounds,
            cropDataUrl: proposal.cropDataUrl,
            chatPageNumber: mapped.streamPageNumber, chatPageCount: slices.length,
            dossierPageNumber: 4 + pagesBefore + mapped.sliceIndex,
            isDuplicate: false, isConfirmed: false, needsReview: true,
            aiProposedFields: ["all"],
          });
          added += 1;
        }
        return { ...entry, embeddedSlips: records };
      });
      setStagedQueue(nextQueue);
      recomputeConfirmedEvidence(nextQueue);
      setAiScanMessage(`${item.file.name}: เพิ่ม candidate รอตรวจ ${added} รายการ; เติมเฉพาะช่องว่างในรายการเดิม ${updated} รายการ`);
    } catch (error) {
      setAiScanMessage(`สกัดด้วย ${engineLabel} ไม่สำเร็จ: ${error instanceof Error ? error.message : "ข้อผิดพลาดที่ไม่ทราบสาเหตุ"}`);
    } finally {
      setAiScanItemId(null);
    }
  };

  const saveDuplicateReferenceResolution = (referenceNo: string, resolution: DuplicateReferenceResolution) => {
    setDuplicateReferenceResolutions((current) => ({ ...current, [referenceNo]: resolution }));
  };

  const clearDuplicateReferenceResolution = (referenceNo: string) => {
    setDuplicateReferenceResolutions((current) => {
      const next = { ...current };
      delete next[referenceNo];
      return next;
    });
  };

  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentFileName: string;
    phase: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Select an evidence item from the queue to view on canvas & inspection panels
  const selectEvidenceItem = (index: number, sliceIndex: number = 0) => {
    if (index < 0 || index >= stagedQueue.length) return;
    setSelectedItemIndex(index);
    setSelectedSliceIndex(sliceIndex);
    const item = stagedQueue[index];
    setPreviewImage(item.previewUrl);
    if (item.category !== "PENDING") setEvidenceMode(item.category);
    if (item.data) {
      setExtractedData(item.data);
    }
    if (item.meta) {
      setMetadata(item.meta);
    }
  };

  const openSlipSourcePage = (record: { id?: string; sourceItemId: string; chatPage: string }) => {
    let itemIndex = stagedQueue.findIndex((item) => item.id === record.sourceItemId);
    if (itemIndex < 0) return;
    const pageNumber = Number.parseInt(record.chatPage, 10);
    if (stagedQueue[itemIndex].stitchedIntoItemId) {
      itemIndex = stagedQueue.findIndex((item) => item.id === stagedQueue[itemIndex].stitchedIntoItemId);
    }
    if (itemIndex < 0) return;
    const item = stagedQueue[itemIndex];
    const mappedPage = item.chatStreamPageNumbers?.indexOf(pageNumber) ?? -1;
    const sliceIndex = item.category === "CHAT" && Number.isFinite(pageNumber)
      ? Math.max(0, Math.min(mappedPage >= 0 ? mappedPage : pageNumber - 1, (item.chatSlices?.length || 1) - 1))
      : 0;
    selectEvidenceItem(itemIndex, sliceIndex);
    setSelectedSlipRecordId(record.id || null);
    setCenterView("EVIDENCE_A4");
  };

  // Phase 1: Ingest files into Staging Buffer — INSTANT local intake (< 50ms, zero network blocking)
  const stageIncomingFiles = async (files: FileList | File[]) => {
    const rawList = Array.from(files);
    const imageFiles = rawList.filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(f.name));

    if (imageFiles.length === 0) {
      setErrorMsg("กรุณาเลือกไฟล์ภาพที่ถูกต้อง (PNG, JPG, WEBP)");
      return;
    }
    setErrorMsg(null);

    const intakeResults = await Promise.all(imageFiles.map(async (file) => {
      try {
        const sha256 = await computeFileSha256(file);
        return {
          file,
          item: {
            id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
            file,
            previewUrl: URL.createObjectURL(file),
            category: "PENDING" as const,
            status: "staged" as const,
            meta: {
              file_name: file.name,
              mime_type: file.type || "image/png",
              sha256,
              size_bytes: file.size,
              extracted_at: new Date().toISOString(),
            },
          },
        };
      } catch {
        return { file, item: null };
      }
    }));
    const newItems = intakeResults.flatMap((result) => result.item ? [result.item] : []);
    const failedFiles = intakeResults.filter((result) => !result.item).map((result) => result.file.name);

    if (newItems.length === 0) {
      setErrorMsg(`คำนวณ SHA-256 ในเครื่องไม่สำเร็จ จึงยังไม่เพิ่มไฟล์เข้าคิว: ${failedFiles.join(", ")}`);
      return;
    }
    setErrorMsg(failedFiles.length > 0
      ? `บางไฟล์คำนวณ SHA-256 ไม่สำเร็จและยังไม่ถูกเพิ่มเข้าคิว: ${failedFiles.join(", ")}`
      : null);
    setAiScanMessage(null);

    // Update Staging Buffer IMMEDIATELY (< 50ms)
    setStagedQueue((prev) => {
      const mergedQueue = [...prev, ...newItems];
      const itemsById = new Map(mergedQueue.map((item) => [item.id, item]));
      const updatedQueue = prepareImageBatch(mergedQueue.map((item) => ({
        id: item.id,
        fileName: item.file.name,
        sha256: item.meta?.sha256 || "",
      }))).map(({ id }) => itemsById.get(id)!);
      if (!previewImage && newItems.length > 0) {
        setPreviewImage(updatedQueue[0].previewUrl);
        setSelectedItemIndex(0);
        setSelectedSliceIndex(0);
      } else {
        const selectedId = prev[selectedItemIndex]?.id;
        const reorderedIndex = updatedQueue.findIndex((item) => item.id === selectedId);
        if (reorderedIndex >= 0) setSelectedItemIndex(reorderedIndex);
      }
      return updatedQueue;
    });

  };

  // Remove a single item from the staging buffer
  const removeStagedItem = (id: string) => {
    setAiScanMessage(null);
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

  // Clear entire staging buffer + OCR cache (allows re-processing same files with new OCR)
  const clearStagingBuffer = () => {
    void clearEvidenceQueueSnapshot().catch((error: unknown) => {
      setErrorMsg(error instanceof Error ? `ลบคิวที่บันทึกในเครื่องไม่สำเร็จ: ${error.message}` : "ลบคิวที่บันทึกในเครื่องไม่สำเร็จ");
    });
    setStagedQueue([]);
    setAiScanMessage(null);
    setManifestList([]);
    setTargetListSnapshot([]);
    setTargetName("");
    setEvidenceState(PURE_ZERO_STATE);
    setPreviewImage(null);
    setExtractedData(null);
    setMetadata(null);
    setPendingNamedSlipIndexes([]);
    setCurrentStep(1);
    // ล้าง OCR Cache เพื่อให้ประมวลผลไฟล์เดิมใหม่ด้วย Typhoon OCR ได้
    clearAllSlipCache();
  };

  // Phase 2: Unified Batch Execution (The Cross-Matching Law)
  const executeUnifiedBatch = async () => {
    if (stagedQueue.length === 0) {
      setErrorMsg("ยังไม่มีไฟล์ในหน่วยความจำพักรอ (Staging Buffer)");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setAiScanMessage(null);

    const orderedBatch = prepareImageBatch(stagedQueue.map((item) => ({
      id: item.id,
      fileName: item.file.name,
      sha256: item.meta?.sha256 || "",
    })));
    const itemsById = new Map(stagedQueue.map((item) => [item.id, item]));
    const positionsById = new Map(orderedBatch.map((item, index) => [item.id, index + 1]));
    const uniqueDetections = await classifyUniqueEvidenceItems(orderedBatch.map((occurrence) => {
      const item = itemsById.get(occurrence.id)!;
      return { ...occurrence, file: item.file };
    }), detectImageType);
    const detectionsById = new Map(uniqueDetections);
    let currentQueue = orderedBatch.map((occurrence) => {
      const item = itemsById.get(occurrence.id)!;
      const master = occurrence.duplicateOfId ? itemsById.get(occurrence.duplicateOfId) : null;
      const detected = detectionsById.get(master?.id || item.id)!;
      return {
        ...item,
        category: detected.category,
        detectType: detected.type,
        status: occurrence.isDuplicate ? "done" as const : item.status === "done" ? "processing" as const : item.status,
        isDuplicate: occurrence.isDuplicate,
        duplicateOfRef: master ? `#${positionsById.get(master.id)} ${master.file.name}` : undefined,
        processingWarnings: occurrence.isDuplicate
          ? [...(item.processingWarnings || []), `ไฟล์ซ้ำแบบ SHA-256 กับ ${master?.file.name || "รายการต้นฉบับ"}; ข้าม OCR และเก็บ occurrence/แฮชไว้ตรวจสอบ`]
          : item.processingWarnings,
      };
    });
    setStagedQueue(currentQueue);
    let updatedManifest = [...manifestList];
    currentQueue.filter((item) => item.isDuplicate).forEach((item) => {
      const meta = item.meta;
      if (!meta) return;
      updatedManifest = appendUniqueManifestOccurrences(updatedManifest, [{
        no: updatedManifest.length + 1,
        file_name: meta.file_name,
        file_type: item.category === "SLIP" ? "SLIP" : "CHAT",
        size_bytes: meta.size_bytes,
        sha256: meta.sha256,
        intake_timestamp: meta.extracted_at,
      }]);
    });
    setManifestList(updatedManifest);

    // Identify Slips and Chats in queue
    const slipIndices: number[] = [];
    const chatIndices: number[] = [];

    currentQueue.forEach((item, idx) => {
      if (item.isDuplicate) return;
      if (item.category === "SLIP") slipIndices.push(idx);
      else chatIndices.push(idx);
    });

    const chatSlicesByItem = new Map<string, Awaited<ReturnType<typeof sliceChatImageLocally>>>();
    const chatStreamPageNumbersByItem = new Map<string, number[]>();
    const chatPreparationFailures = new Map<string, string>();
    const chatSourceSegmentsByItem = new Map<string, StitchedChatStream["sourceSegments"]>();
    const chatStitchWarningsByItem = new Map<string, string[]>();
    const chatSliceJobs: Array<{ kind: "CHAT"; itemId: string; fileName: string; sliceOffset: number; slice: Awaited<ReturnType<typeof sliceChatImageLocally>>[number] }> = [];
    chatIndices.forEach((itemIndex) => chatSlicesByItem.set(currentQueue[itemIndex].id, []));
    chatIndices.forEach((itemIndex) => chatStreamPageNumbersByItem.set(currentQueue[itemIndex].id, []));
    let stitchedStreams: StitchedChatStream[] = [];
    try {
      const preflightByItem = chatIndices.length > 1
        ? await mapWithConcurrency(chatIndices, 2, async (itemIndex, orderIndex) => {
          const item = currentQueue[itemIndex];
          return await readChatPreflight(item.file, orderIndex).catch(() => null);
        })
        : [];
      const timestampedInputs = await Promise.all(chatIndices.map(async (itemIndex, index) => {
        const item = currentQueue[itemIndex];
        const preflight = preflightByItem[index] || null;
        return {
          id: item.id,
          file: item.file,
          fileName: item.file.name,
          sha256: item.meta?.sha256 || "",
          captureTime: await readImageCaptureTime(item.file),
          eventTime: preflight?.eventTime || null,
          ocrLines: preflight?.lines || [],
        };
      }));
      const timeline = sortChatInputsByCaptureTime(timestampedInputs);
      stitchedStreams = await stitchChatImages(timeline.items.map((item, index) => ({
        ...item,
        isFirst: index === 0,
        isLast: index === timeline.items.length - 1,
      })));
      if (timeline.warnings.length) {
        stitchedStreams = stitchedStreams.map((stream) => ({
          ...stream,
          warnings: [...stream.warnings, ...timeline.warnings],
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "ตรวจรอยต่อภาพแชทไม่สำเร็จ";
      chatIndices.forEach((itemIndex) => chatStitchWarningsByItem.set(currentQueue[itemIndex].id, [
        `ระบบ stitch ใช้ไม่ได้ในรอบนี้ (${message}); แยกประมวลผลภาพต้นทางและไม่ตัดส่วนซ้ำ`,
      ]));
      for (const itemIndex of chatIndices) {
        const item = currentQueue[itemIndex];
        try {
          const bitmap = await createImageBitmap(item.file);
          const sourceScale = bitmap.width / 807;
          const normalizedHeight = Math.max(1, Math.round(bitmap.height / sourceScale));
          bitmap.close();
          const slices = await sliceChatImageLocally(item.file);
          const sourceSegments = [{
            sourceItemId: item.id,
            sourceFileName: item.file.name,
            sourceSha256: item.meta?.sha256 || "",
            streamStartY: 0,
            streamEndY: normalizedHeight,
            sourceOffsetY: 0,
            sourceScale,
          }];
          chatSourceSegmentsByItem.set(item.id, sourceSegments);
          const slicesWithSource = slices.map((slice) => ({ ...slice, sourceSegments, streamPageNumber: slice.sliceIndex, streamPageCount: slices.length }));
          chatSlicesByItem.set(item.id, slicesWithSource);
          chatStreamPageNumbersByItem.set(item.id, slicesWithSource.map((slice) => slice.streamPageNumber || slice.sliceIndex));
          slicesWithSource.forEach((slice, sliceOffset) => chatSliceJobs.push({ kind: "CHAT", itemId: item.id, fileName: item.file.name, sliceOffset, slice }));
        } catch (sliceError) {
          chatPreparationFailures.set(item.id, sliceError instanceof Error ? sliceError.message : "เตรียมหน้าแชทไม่สำเร็จ");
        }
      }
    }

    if (stitchedStreams.length > 0) {
      let globalStreamPage = 0;
      for (const itemIndex of chatIndices) {
        const item = currentQueue[itemIndex];
        setBatchProgress({ current: itemIndex + 1, total: currentQueue.length, currentFileName: item.file.name, phase: "จับรอยซ้อนและต่อภาพแชทที่ยืนยันได้" });
      }
      const chatIds = new Set(chatIndices.map((itemIndex) => currentQueue[itemIndex].id));
      for (const stream of stitchedStreams) {
        const sourceIds = stream.sourceSegments.map((segment) => segment.sourceItemId).filter((id) => chatIds.has(id));
        for (const sourceId of sourceIds) {
          chatSourceSegmentsByItem.set(sourceId, stream.sourceSegments);
          const joinWarnings = stream.overlapJoins.map((join) =>
              `ต่อ ${join.previousFileName} กับ ${join.nextFileName}; overlap ${join.overlapPixels}px (pixel similarity ${Math.round(join.pixelSimilarity * 100)}%)${join.appliedBrightnessOffset === 0 ? "" : ` · brightness-match offset ${join.appliedBrightnessOffset} · ไม่ปรับพิกเซลต้นฉบับ`}`,
            );
          const warnings = [...joinWarnings, ...stream.warnings];
          if (stream.overlapJoins.length === 0 && warnings.length === 0 && chatIndices.length > 1) {
            warnings.push("ภาพนี้ไม่มีรอยต่อที่ยืนยันได้ใน stream; เก็บแยกโดยไม่ตัดเนื้อหา");
          }
          if (warnings.length) chatStitchWarningsByItem.set(sourceId, warnings);
        }

        try {
          const streamSlices = await sliceChatImageLocally(stream.canvas);
          streamSlices.forEach((slice) => {
            const streamPage = ++globalStreamPage;
            const midpoint = (slice.startY + slice.endY) / 2;
            const owner = [...stream.sourceSegments]
              .filter((segment) => segment.streamStartY <= midpoint && segment.streamEndY > midpoint)
              .sort((left, right) => right.streamStartY - left.streamStartY)[0]
              || stream.sourceSegments[0];
            if (!owner || !chatIds.has(owner.sourceItemId)) return;
            const item = currentQueue[chatIndices.find((index) => currentQueue[index].id === owner.sourceItemId)!];
            const assignedSlices = chatSlicesByItem.get(owner.sourceItemId) || [];
            const sourceSlice = {
              ...slice,
              sliceIndex: assignedSlices.length + 1,
              streamPageNumber: streamPage,
              streamPageCount: 0,
              sourceSegments: stream.sourceSegments,
            };
            assignedSlices.push(sourceSlice);
            chatSlicesByItem.set(owner.sourceItemId, assignedSlices);
            chatStreamPageNumbersByItem.get(owner.sourceItemId)?.push(streamPage);
            chatSliceJobs.push({ kind: "CHAT", itemId: owner.sourceItemId, fileName: item.file.name, sliceOffset: assignedSlices.length - 1, slice: sourceSlice });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "แบ่งหน้า stitched stream ไม่สำเร็จ";
          for (const sourceId of sourceIds) chatPreparationFailures.set(sourceId, message);
        }
      }
      for (const slices of chatSlicesByItem.values()) {
        slices.forEach((slice) => { slice.streamPageCount = globalStreamPage; });
      }
      chatSliceJobs.forEach((job) => { job.slice.streamPageCount = globalStreamPage; });
    }

    const pixelPages: PixelPageOccurrence[] = [];
    for (const [sourceItemId, slices] of chatSlicesByItem) {
      for (const [sliceOffset, slice] of slices.entries()) {
        const sourceItem = currentQueue.find((item) => item.id === sourceItemId);
        pixelPages.push({
          id: `${sourceItemId}:${sliceOffset}`,
          sourceItemId,
          fileName: sourceItem?.file.name || sourceItemId,
          pageNumber: chatStreamPageNumbersByItem.get(sourceItemId)?.[sliceOffset] || sliceOffset + 1,
          width: slice.canvas.width,
          height: slice.canvas.height,
          readPixels: async () => {
            try {
              const context = slice.canvas.getContext("2d", { willReadFrequently: true });
              const pixels = context?.getImageData(0, 0, slice.canvas.width, slice.canvas.height).data || null;
              if (!pixels) throw new Error("อ่าน canvas pixels ไม่ได้");
              return pixels;
            } catch {
              chatStitchWarningsByItem.set(sourceItemId, [
                ...(chatStitchWarningsByItem.get(sourceItemId) || []),
                `ตรวจพิกเซลหน้า ${sliceOffset + 1} เพื่อหาหน้าซ้ำไม่ได้; เก็บหน้าหลักฐานไว้ครบ`,
              ]);
              return null;
            }
          },
        });
      }
    }
    const pixelDuplicateGroups = await findPixelIdenticalPageGroups(pixelPages);
    const pixelDuplicateWarnings = buildPixelDuplicateWarnings(pixelDuplicateGroups);
    for (const { sourceItemId, warning } of pixelDuplicateWarnings) {
      chatStitchWarningsByItem.set(sourceItemId, [
        ...(chatStitchWarningsByItem.get(sourceItemId) || []),
        warning,
      ]);
    }

    const executionOrder = [...slipIndices, ...chatIndices.filter((itemIndex) =>
      (chatSlicesByItem.get(currentQueue[itemIndex].id)?.length || 0) > 0,
    )];
    const totalFiles = executionOrder.length;

    const slipQrJobs = slipIndices.map((itemIndex) => ({
      kind: "SLIP" as const,
      itemId: currentQueue[itemIndex].id,
      fileName: currentQueue[itemIndex].file.name,
      file: currentQueue[itemIndex].file,
    }));
    const qrJobs = [...slipQrJobs, ...chatSliceJobs];
    const qrJobPlan = buildUniquePixelJobPlan(qrJobs, pixelDuplicateGroups, (job) =>
      job.kind === "CHAT" ? `${job.itemId}:${job.sliceOffset}` : `slip:${job.itemId}`,
    );
    const qrFailedPagesByItem = new Map<string, Set<number>>();
    const ocrFailedPagesByItem = new Map<string, Set<number>>();
    const qrScanDiagnosticsByPage = new Map<string, NonNullable<ChatEvidenceLayerPage["qrScanDiagnostic"]>>();
    const ocrRetryDiagnosticsByItem = new Map<string, Set<string>>();
    const recordFailedPage = (failures: Map<string, Set<number>>, itemId: string, pageNumber: number) => {
      const pages = failures.get(itemId) || new Set<number>();
      pages.add(pageNumber);
      failures.set(itemId, pages);
    };
    let qrPagesCompleted = 0;
    let ocrPagesCompleted = 0;
    const uniqueQrJobResults = await runQrThenOcrPasses(
      qrJobPlan.jobs,
      2,
      async (job) => {
        try {
          return await extractSlipsLocally(job.kind === "CHAT" ? job.slice.canvas : job.file, {
            diagnosticProbeRegion: job.kind === "CHAT" && job.slice.streamPageNumber === 11
              ? { x: 370, y: 560, width: 140, height: 140 }
              : undefined,
            onScanDiagnostics: (diagnostics) => qrScanDiagnosticsByPage.set(
              job.kind === "CHAT" ? `${job.itemId}:${job.sliceOffset}` : `${job.itemId}:slip`,
              diagnostics,
            ),
            onError: () => recordFailedPage(
              qrFailedPagesByItem,
              job.itemId,
              job.kind === "CHAT" ? job.slice.sliceIndex : 1,
            ),
          });
        } catch {
          recordFailedPage(qrFailedPagesByItem, job.itemId, job.kind === "CHAT" ? job.slice.sliceIndex : 1);
          return [];
        } finally {
          qrPagesCompleted += 1;
          setBatchProgress({ current: qrPagesCompleted, total: qrJobPlan.jobs.length, currentFileName: job.fileName, phase: "ค้นหา QR ในหน้าไม่ซ้ำทุกไบต์" });
        }
      },
      async (job, qrCandidates, pageIndex) => {
        try {
          let sourceCanvas: HTMLCanvasElement;
          let workerSlot: number;
          if (job.kind === "CHAT") {
            sourceCanvas = job.slice.canvas;
            workerSlot = pageIndex;
          } else {
            const bitmap = await createImageBitmap(job.file);
            sourceCanvas = document.createElement("canvas");
            sourceCanvas.width = bitmap.width;
            sourceCanvas.height = bitmap.height;
            const context = sourceCanvas.getContext("2d");
            if (!context) {
              bitmap.close();
              throw new Error("เตรียมภาพสลิปสำหรับ OCR ไม่สำเร็จ");
            }
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            workerSlot = pageIndex;
          }
          const ocrCandidates = await extractSlipCandidatesWithLocalOcr(sourceCanvas, qrCandidates, workerSlot, {
            jobKind: job.kind,
            onRetryDiagnostic: (message) => {
              const diagnostics = ocrRetryDiagnosticsByItem.get(job.itemId) || new Set<string>();
              diagnostics.add(message);
              ocrRetryDiagnosticsByItem.set(job.itemId, diagnostics);
            },
          });
          return finalizeSlipCandidates(qrCandidates, ocrCandidates);
        } catch {
          recordFailedPage(ocrFailedPagesByItem, job.itemId, job.kind === "CHAT" ? job.slice.sliceIndex : 1);
          return finalizeSlipCandidates(qrCandidates, []);
        } finally {
          ocrPagesCompleted += 1;
          setBatchProgress({ current: ocrPagesCompleted, total: qrJobPlan.jobs.length, currentFileName: job.fileName, phase: "OCR หน้าไม่ซ้ำทุกไบต์ภายในเครื่อง" });
        }
      },
    );
    const candidatesByQrJob = expandUniquePixelJobResults(qrJobs, qrJobPlan, uniqueQrJobResults);
    qrJobPlan.resultIndexes.forEach((resultIndex, jobIndex) => {
      const job = qrJobs[jobIndex];
      const representative = qrJobPlan.jobs[resultIndex];
      if (job === representative || job.kind !== "CHAT" || representative.kind !== "CHAT") return;
      if (qrFailedPagesByItem.get(representative.itemId)?.has(representative.slice.sliceIndex)) {
        recordFailedPage(qrFailedPagesByItem, job.itemId, job.slice.sliceIndex);
      }
      if (ocrFailedPagesByItem.get(representative.itemId)?.has(representative.slice.sliceIndex)) {
        recordFailedPage(ocrFailedPagesByItem, job.itemId, job.slice.sliceIndex);
      }
    });
    type QrSlipCandidate = Awaited<ReturnType<typeof extractSlipsLocally>>[number];
    const candidatesByItem = new Map<string, Map<number, QrSlipCandidate[]>>();
    const slipCandidatesByItem = new Map<string, QrSlipCandidate[]>();
    const qrDecoderDiagnosticsByItem = new Map<string, Set<string>>();
    const sourceQrFallbackWarningsByItem = new Map<string, string[]>();
    const recordQrDecoderRoutes = (itemId: string, candidates: QrSlipCandidate[]) => {
      const routes = new Set(qrDecoderDiagnosticsByItem.get(itemId) || []);
      buildQrDecoderDiagnostics(candidates.map(({ qrDecodeRoute }) => qrDecodeRoute)).forEach((message) => routes.add(message));
      if (routes.size) qrDecoderDiagnosticsByItem.set(itemId, routes);
    };
    const chatEvidenceLayersByItem = new Map<string, ChatEvidenceLayerPage[]>();
    qrJobs.forEach((job, index) => {
      if (job.kind === "SLIP") {
        slipCandidatesByItem.set(job.itemId, candidatesByQrJob[index]);
        recordQrDecoderRoutes(job.itemId, candidatesByQrJob[index]);
        return;
      }
      const pages = candidatesByItem.get(job.itemId) || new Map<number, QrSlipCandidate[]>();
      pages.set(job.sliceOffset, candidatesByQrJob[index]);
      candidatesByItem.set(job.itemId, pages);
      recordQrDecoderRoutes(job.itemId, candidatesByQrJob[index]);

      const layers = getCachedChatEvidenceLayers(job.slice.canvas);
      if (!layers) return;
      const mapBounds = (bounds: { x: number; y: number; width: number; height: number }) => {
        const streamBounds = mapSliceBoundsToSource(bounds, {
          sourceWidth: 807,
          sliceStartY: job.slice.startY,
          contentScaleY: job.slice.contentScaleY,
          contentScaleX: job.slice.contentScaleX,
          contentOffsetX: job.slice.contentOffsetX,
        });
        const mapped = mapStreamBoundsToSources(streamBounds, job.slice.sourceSegments || []);
        return {
          streamBounds,
          sourceReferences: mapped.sources.map((source) => ({
            sourceItemId: source.sourceItemId,
            fileName: source.sourceFileName,
            sha256: source.sourceSha256,
            captureTime: source.captureTime || null,
            eventTime: source.eventTime || null,
            sourceTrim: source.sourceTrim,
            bounds: source.sourceBounds,
          })),
        };
      };
      const pageLayers: ChatEvidenceLayerPage = {
        pageNumber: job.slice.streamPageNumber || job.slice.sliceIndex,
        ocrDiagnosticTrace: layers.ocrDiagnosticTrace,
        qrScanDiagnostic: qrScanDiagnosticsByPage.get(`${job.itemId}:${job.sliceOffset}`),
        layer1: layers.layer1.map((object) => ({ ...object, ...mapBounds(object.bounds) }) as ChatEvidenceLayerPage["layer1"][number]),
        layer2: layers.layer2.map((line) => ({ ...line, ...mapBounds(line.bounds) })),
        warnings: [
          ...layers.warnings,
          `Semantic segmentation แบบ heuristic; grayscale mask ${layers.maskCoverage === null ? "ไม่มี" : `${(layers.maskCoverage * 100).toFixed(1)}%`} · HSV/LAB color mask ${layers.colorMaskCoverage === null ? "ไม่มี" : `${(layers.colorMaskCoverage * 100).toFixed(1)}%`}. ผลทุกกรอบเป็น candidate รอตรวจ ไม่ใช่การยืนยันชนิดวัตถุ`,
        ],
      };
      const itemLayers = chatEvidenceLayersByItem.get(job.itemId) || [];
      itemLayers.push(pageLayers);
      chatEvidenceLayersByItem.set(job.itemId, itemLayers);
    });

    // A QR can be missed when chat segmentation splits the embedded slip; retry the
    // original only for detector-confirmed hybrid images with no page-level QR result.
    for (const itemIndex of chatIndices) {
      const item = currentQueue[itemIndex];
      if (item.detectType !== "TYPE_CHAT_WITH_SLIP") continue;
      const slices = chatSlicesByItem.get(item.id) || [];
      const pageCandidates = candidatesByItem.get(item.id);
      if (!slices.length || slices.some((_, sliceOffset) => (pageCandidates?.get(sliceOffset) || []).length > 0)) continue;

      try {
        setBatchProgress({ current: itemIndex + 1, total: currentQueue.length, currentFileName: item.file.name, phase: "ตรวจ QR/OCR ซ้ำบนภาพต้นฉบับของแชทที่มีสลิป" });
        const bitmap = await createImageBitmap(item.file);
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = bitmap.width;
        sourceCanvas.height = bitmap.height;
        const context = sourceCanvas.getContext("2d");
        if (!context) {
          bitmap.close();
          throw new Error("เตรียมภาพต้นฉบับสำหรับตรวจสลิปไม่สำเร็จ");
        }
        context.drawImage(bitmap, 0, 0);
        const sourceWidth = bitmap.width;
        bitmap.close();

        const qrCandidates = await extractSlipsLocally(sourceCanvas, {
          onError: () => recordFailedPage(qrFailedPagesByItem, item.id, 1),
        });
        if (!qrCandidates.length) continue;
        recordQrDecoderRoutes(item.id, qrCandidates);
        const ocrCandidates = await extractSlipCandidatesWithLocalOcr(sourceCanvas, qrCandidates, 0, {
          jobKind: "CHAT",
          onRetryDiagnostic: (message) => {
            const diagnostics = ocrRetryDiagnosticsByItem.get(item.id) || new Set<string>();
            diagnostics.add(message);
            ocrRetryDiagnosticsByItem.set(item.id, diagnostics);
          },
        });
        const sourceCandidates = finalizeSlipCandidates(qrCandidates, ocrCandidates);
        for (const candidate of sourceCandidates) {
          const mapped = mapSourceSlipCandidateToChatSlice(candidate, {
            sourceWidth,
            sourceItemId: item.id,
            sourceSegments: chatSourceSegmentsByItem.get(item.id) || slices[0].sourceSegments || [],
            slices,
          });
          if (!mapped) continue;
          const mappedPages = candidatesByItem.get(item.id) || new Map<number, QrSlipCandidate[]>();
          mappedPages.set(mapped.sliceIndex, [...(mappedPages.get(mapped.sliceIndex) || []), mapped.candidate]);
          candidatesByItem.set(item.id, mappedPages);
        }
        if (sourceCandidates.length) {
          sourceQrFallbackWarningsByItem.set(item.id, [
            "ตรวจ QR บนภาพต้นฉบับซ้ำหลังไม่พบในหน้าที่แบ่ง; ผูก candidate กลับหน้าที่ตรงกับพิกัดต้นฉบับแล้ว และยังต้องตรวจทานก่อนยืนยัน",
          ]);
        }
      } catch (error) {
        const diagnostics = sourceQrFallbackWarningsByItem.get(item.id) || [];
        diagnostics.push(`ตรวจ QR/OCR ซ้ำบนภาพต้นฉบับไม่สำเร็จ: ${error instanceof Error ? error.message : "ข้อผิดพลาดที่ไม่ทราบสาเหตุ"}`);
        sourceQrFallbackWarningsByItem.set(item.id, diagnostics);
      }
    }

    // STEP 1: Process All Slips First (Fact Extraction: Amount, Timestamp, Bank, Ref)
    // All chat QR anchors are found first, then the missing fields are supplemented by local OCR.
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
        const qrOcrSlip = isSlip ? slipCandidatesByItem.get(targetItem.id)?.[0]?.data || null : null;
        let slip: SlipExtraction | null = isSlip ? qrOcrSlip || getCachedSlip(sha256) : null;
        let meta: ExtractionMetadata;
        let embeddedSlips: EmbeddedSlipRecord[] | undefined;

        if (slip) {
          meta = {
            file_name: targetItem.file.name,
            mime_type: targetItem.file.type || "image/png",
            sha256,
            size_bytes: targetItem.file.size,
            extracted_at: new Date().toISOString(),
          };
        } else if (isSlip) {
          // QR detection completed for the whole batch before supplemental chat OCR began.
          const localQrResult = slipCandidatesByItem.get(targetItem.id)?.[0]?.data || null;

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
            // Local-only intake: retain the source for manual review; never invent transaction values.
            meta = {
              file_name: targetItem.file.name,
              mime_type: targetItem.file.type || "image/png",
              sha256,
              size_bytes: targetItem.file.size,
              extracted_at: new Date().toISOString(),
            };
          }
        } else {
          const preparationFailure = chatPreparationFailures.get(targetItem.id);
          if (preparationFailure) throw new Error(preparationFailure);
          const slices = chatSlicesByItem.get(targetItem.id) || [];
          const chatSlices = slices.map((s) => s.canvas.toDataURL("image/png"));

          const pageCandidates: Array<{ sliceIndex: number; candidate: Awaited<ReturnType<typeof extractSlipsLocally>>[number] }> = [];
          const noCandidatePages: number[] = [];
          const failedPages = new Set([
            ...(qrFailedPagesByItem.get(targetItem.id) || []),
            ...(ocrFailedPagesByItem.get(targetItem.id) || []),
          ]);
          const itemCandidates = candidatesByItem.get(targetItem.id)
            || new Map<number, Awaited<ReturnType<typeof extractSlipsLocally>>[number][]>();
          for (const [sliceOffset, slice] of slices.entries()) {
            const candidates = itemCandidates.get(sliceOffset) || [];
            if (candidates.length === 0 && !failedPages.has(slice.sliceIndex)) noCandidatePages.push(slice.sliceIndex);
            candidates.forEach((candidate) => pageCandidates.push({ sliceIndex: slice.sliceIndex - 1, candidate }));
          }
          const bitmap = await createImageBitmap(targetItem.file);
          const sourceWidth = bitmap.width;
          bitmap.close();
          const precedingPages = currentQueue.slice(0, targetIdx).reduce(
            (count, item) => count + (item.category === "CHAT" ? (chatSlicesByItem.get(item.id)?.length ?? item.chatSlices?.length ?? 1) : 1), 0
          );
          embeddedSlips = dedupeEmbeddedSlipDetections(pageCandidates.map(({ sliceIndex, candidate }, candidateIndex) => {
            const slice = slices[sliceIndex];
            const streamBounds = mapSliceBoundsToSource(candidate.bounds, {
              sourceWidth: 807,
              sliceStartY: slice.startY,
              contentScaleY: slice.contentScaleY,
              contentScaleX: slice.contentScaleX,
              contentOffsetX: slice.contentOffsetX,
            });
            const sourceMapping = mapStreamBoundsToSources(streamBounds, slice.sourceSegments || []);
            const primarySource = sourceMapping.primary;
            const sourceBounds = primarySource?.sourceBounds || mapSliceBoundsToSource(candidate.bounds, {
              sourceWidth,
              sliceStartY: slice.startY,
              contentScaleY: slice.contentScaleY,
              contentScaleX: slice.contentScaleX,
              contentOffsetX: slice.contentOffsetX,
            });
            return {
              id: `${targetItem.id}-embedded-${candidateIndex + 1}`,
              extractionVersion: EXTRACTION_VERSION,
              sourceItemId: primarySource?.sourceItemId || targetItem.id,
              sourceFileName: primarySource?.sourceFileName || targetItem.file.name,
              sourceSha256: primarySource?.sourceSha256 || sha256,
              sourceReferences: sourceMapping.sources.map((source) => ({
                sourceItemId: source.sourceItemId,
                fileName: source.sourceFileName,
                sha256: source.sourceSha256,
                bounds: source.sourceBounds,
              })),
              crossesSourceBoundary: sourceMapping.crossesSourceBoundary,
              data: candidate.data,
              candidateBounds: candidate.bounds,
              sourceBounds,
              cropDataUrl: candidate.cropDataUrl,
              ocrTextBoxes: candidate.ocrTextBoxes,
              ocrDiagnosticTrace: candidate.ocrDiagnosticTrace,
              chatPageNumber: slice.streamPageNumber || sliceIndex + 1,
              chatPageCount: slice.streamPageCount || slices.length,
              dossierPageNumber: 4 + precedingPages + sliceIndex,
              isDuplicate: false,
              isConfirmed: false,
              needsReview: true,
            };
          })).map((record) => retainSenderNameAfterReprocess(targetItem.embeddedSlips || [], record));
          embeddedSlips = retainAiOnlyRecordsAfterReprocess(targetItem.embeddedSlips || [], embeddedSlips, sha256);
          const embeddedSlip = embeddedSlips[0]?.data;
          const ocrSlipData: SlipExtraction | null = embeddedSlip || null;

          const senderName = ocrSlipData?.sender?.name || embeddedSlip?.sender?.name || null;
          const senderAccount = ocrSlipData?.sender?.account_no || embeddedSlip?.sender?.account_no || null;
          const senderBank = ocrSlipData?.sender?.bank || embeddedSlip?.sender?.bank || null;

          const receiverName = ocrSlipData?.receiver?.name || embeddedSlip?.receiver?.name || null;
          const receiverAccount = ocrSlipData?.receiver?.account_no || embeddedSlip?.receiver?.account_no || null;
          const receiverBank = ocrSlipData?.receiver?.bank || embeddedSlip?.receiver?.bank || null;

          const amount = ocrSlipData?.transaction?.amount || embeddedSlip?.transaction?.amount || null;
          const refNo = ocrSlipData?.transaction?.reference_no || embeddedSlip?.transaction?.reference_no || null;
          const bankName = ocrSlipData?.bank?.name || embeddedSlip?.bank?.name || "LINE / Chat Screen";

          slip = {
            document_type: "bank_transfer_slip",
            bank: { name: bankName, confidence: 1 },
            transaction: {
              date: ocrSlipData?.transaction?.date || embeddedSlip?.transaction?.date || null,
              time: ocrSlipData?.transaction?.time || embeddedSlip?.transaction?.time || null,
              amount: amount,
              currency: "THB",
              fee: null,
              reference_no: refNo,
              transaction_id: refNo,
              note: null,
            },
            sender: { name: senderName, account_no: senderAccount, bank: senderBank },
            receiver: { name: receiverName, account_no: receiverAccount, bank: receiverBank },
            confidence: {
              date: ocrSlipData?.transaction.date ? 0.99 : 0,
              time: ocrSlipData?.transaction.time ? 0.99 : 0,
              amount: amount ? 0.99 : 0,
              reference_no: refNo ? 0.99 : 0,
              sender_name: senderName ? 0.99 : 0,
              receiver_name: receiverName ? 0.99 : 0,
              sender_account: senderAccount ? 0.99 : 0,
              receiver_account: receiverAccount ? 0.99 : 0,
            },
            raw_text: ocrSlipData?.raw_text || embeddedSlip?.raw_text || [],
            warnings: [
              `หั่นบล็อก A4 จำนวน ${slices.length} หน้า; พบ candidate ${pageCandidates.length} รายการ (สกัดในเครื่อง)`,
              ...(embeddedSlips.length > 0 ? [`พบรายการสลิปที่รอตรวจ ${embeddedSlips.length} รายการ หลังรวมการตรวจจับซ้ำเฉพาะ Ref และบริเวณภาพต้นฉบับเดียวกัน`] : []),
              ...(noCandidatePages.length > 0 ? [`ยังไม่พบ candidate ในหน้าแชท ${noCandidatePages.join(", ")} — ไม่ได้ยืนยันว่าไม่มีสลิป โปรดตรวจภาพหน้านี้ด้วยตนเอง`] : []),
              ...(failedPages.size > 0 ? [`การตรวจ QR/OCR ในเครื่องทำงานไม่สำเร็จที่หน้า ${Array.from(failedPages).join(", ")} — เก็บหน้าแชทไว้แล้วและต้องตรวจภาพด้วยตนเอง`] : []),
              ...(sourceQrFallbackWarningsByItem.get(targetItem.id) || []),
            ],
          };
          meta = {
            file_name: targetItem.file.name,
            mime_type: targetItem.file.type || "image/png",
            sha256,
            size_bytes: targetItem.file.size,
            extracted_at: new Date().toISOString(),
          };
          currentQueue = currentQueue.map((item, idx) =>
            idx === targetIdx ? {
              ...item,
              chatSlices,
              chatSliceGeometry: slices.map((slice) => ({
                sliceIndex: slice.sliceIndex, startY: slice.startY, endY: slice.endY,
                contentScaleX: slice.contentScaleX, contentScaleY: slice.contentScaleY,
                contentOffsetX: slice.contentOffsetX, streamPageNumber: slice.streamPageNumber,
              })),
              chatStreamPageNumbers: chatStreamPageNumbersByItem.get(item.id) || [],
              embeddedSlips,
              chatSourceSegments: chatSourceSegmentsByItem.get(item.id),
              chatEvidenceLayers: chatEvidenceLayersByItem.get(item.id) || [],
              stitchingWarnings: chatStitchWarningsByItem.get(item.id) || [],
              processingWarnings: [...(slip?.warnings || []), ...Array.from(qrDecoderDiagnosticsByItem.get(item.id) || []), ...(chatStitchWarningsByItem.get(item.id) || []), ...slices.flatMap((slice) => slice.cutWarnings || []), ...Array.from(ocrRetryDiagnosticsByItem.get(item.id) || []), ...(sourceQrFallbackWarningsByItem.get(item.id) || [])],
            } : item
          );
        }

        // Update item in queue
        const ocrFailures = ocrFailedPagesByItem.get(targetItem.id);
        const ocrWarning = ocrFailures?.size && (!isSlip || Boolean(slip))
          ? [`OCR ในเครื่องไม่สำเร็จที่หน้า ${Array.from(ocrFailures).join(", ")} — เก็บรายการต้นทางไว้และต้องตรวจภาพด้วยตนเอง`]
          : [];
        const slipExtractionStatus = isSlip && !slip
          ? buildSlipExtractionStatus({
            qrFailed: Boolean(qrFailedPagesByItem.get(targetItem.id)?.size),
            ocrFailed: Boolean(ocrFailures?.size),
          })
          : null;
        const slipQrWarning = isSlip && slip
          ? buildSlipQrWarning(Boolean(qrFailedPagesByItem.get(targetItem.id)?.size))
          : null;
        currentQueue = currentQueue.map((item, idx) =>
          idx === targetIdx
          ? { ...item, status: isSlip && !slip ? "error" as const : "done" as const, ...(!isSlip || slip ? { extractionVersion: EXTRACTION_VERSION } : {}), ...(isSlip && slip ? { data: { ...slip, warnings: [...slip.warnings, ...ocrWarning, ...(slipQrWarning ? [slipQrWarning] : [])] }, sourceBounds: slipCandidatesByItem.get(targetItem.id)?.[0]?.bounds, ocrTextBoxes: slipCandidatesByItem.get(targetItem.id)?.[0]?.ocrTextBoxes, ocrDiagnosticTrace: slipCandidatesByItem.get(targetItem.id)?.[0]?.ocrDiagnosticTrace, qrScanDiagnostic: qrScanDiagnosticsByPage.get(`${item.id}:slip`), isConfirmed: false } : {}), ...(slipExtractionStatus ? { error: slipExtractionStatus.error } : {}), processingWarnings: [...(item.processingWarnings || []), ...ocrWarning, ...(slipQrWarning ? [slipQrWarning] : []), ...Array.from(qrDecoderDiagnosticsByItem.get(item.id) || []), ...Array.from(ocrRetryDiagnosticsByItem.get(item.id) || []), ...(slipExtractionStatus?.warnings || [])], meta, isDuplicate: false, duplicateOfRef: undefined }
            : item
        );
        // Append to Chain of Custody Hash Manifest
        const newManifestEntry: HashManifestEntry = {
          no: updatedManifest.length + 1,
          file_name: meta.file_name,
          file_type: isSlip ? "SLIP" : "CHAT",
          size_bytes: meta.size_bytes,
          sha256: meta.sha256,
          intake_timestamp: meta.extracted_at,
        };
        updatedManifest = appendUniqueManifestOccurrences(updatedManifest, [newManifestEntry]);
        setManifestList(updatedManifest);

        // Update preview for the first processed item
        if (step === 0) {
          setExtractedData(isSlip ? slip : null);
          setMetadata(meta);
          setPreviewImage(targetItem.previewUrl);
          setEvidenceMode(isSlip ? "SLIP" : "CHAT");
          setSelectedItemIndex(targetIdx);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการประมวลผล";
        currentQueue = currentQueue.map((item, idx) =>
          idx === targetIdx ? { ...item, status: "error" as const, error: msg } : item
        );
      }
    }

    for (const itemIndex of chatIndices) {
      const item = currentQueue[itemIndex];
      if (executionOrder.includes(itemIndex)) continue;
      if (chatPreparationFailures.has(item.id)) {
        currentQueue[itemIndex] = { ...item, status: "error", error: chatPreparationFailures.get(item.id) };
        continue;
      }
      const sourceIds = chatSourceSegmentsByItem.get(item.id)?.map((segment) => segment.sourceItemId) || [];
      const representedBy = sourceIds.find((sourceId) => (chatSlicesByItem.get(sourceId)?.length || 0) > 0);
      currentQueue[itemIndex] = {
        ...item,
        status: "done",
        extractionVersion: EXTRACTION_VERSION,
        chatSlices: [],
        chatStreamPageNumbers: [],
        chatSourceSegments: chatSourceSegmentsByItem.get(item.id),
        embeddedSlips: [],
        chatEvidenceLayers: [],
        stitchedIntoItemId: representedBy && representedBy !== item.id ? representedBy : undefined,
        stitchingWarnings: chatStitchWarningsByItem.get(item.id) || [],
        processingWarnings: [
          ...(chatStitchWarningsByItem.get(item.id) || []),
          ...(representedBy ? [`เนื้อหาของไฟล์นี้ถูกรวมในหน้าแชทของ ${currentQueue[chatIndices.find((index) => currentQueue[index].id === representedBy)!]?.file.name || representedBy}`] : []),
        ],
      };
    }

    setStagedQueue(currentQueue);

    // STEP 3 & 4: Deduplication & Reconcile Net Loss (The Net Financial Truth Doctrine)
    const chatCount = currentQueue.reduce((count, item) => count + (!item.isDuplicate && item.category === "CHAT" ? (item.chatSlices?.length ?? 1) : 0), 0);
    const transactionRecords = currentQueue.flatMap((item) => {
      if (item.status !== "done") return [];
      const records = item.category === "CHAT"
        ? (item.embeddedSlips || []).map((record) => ({ id: record.id, isConfirmed: !!record.isConfirmed, amount: record.data.transaction.amount, referenceNo: record.data.transaction.reference_no }))
        : item.data ? [{ id: item.id, isConfirmed: !!item.isConfirmed, amount: item.data.transaction.amount, referenceNo: item.data.transaction.reference_no }] : [];
      return records;
    });
    const summary = summarizeConfirmedSlipRecords(transactionRecords);
    setEvidenceState({
      totalNetLoss: summary.totalAmount,
      slipCount: summary.slipCount,
      chatPageCount: chatCount,
      poiName: targetName || null,
      poiLossSum: summary.totalAmount,
      corroboratedPairsCount: 0,
      duplicateCount: summary.duplicateCount,
      processedAt: new Date().toLocaleString("th-TH"),
    });

    setBatchProgress(null);
    setLoading(false);
    setCurrentStep(2);
    try {
      await saveEvidenceQueueSnapshot(serializeEvidenceQueueSnapshot(currentQueue, updatedManifest));
    } catch (error) {
      setErrorMsg(error instanceof Error ? `บันทึกผลประมวลผลในเครื่องไม่สำเร็จ: ${error.message}` : "บันทึกผลประมวลผลในเครื่องไม่สำเร็จ");
    }

  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await stageIncomingFiles(e.dataTransfer.files);
    }
  };

  // Unified Page Counting (Single Source of Truth for Header Ribbon & Bottom Navigator)
  const totalPages = useMemo(() => {
    return stagedQueue.filter((item) => !item.stitchedIntoItemId).reduce((sum, item) => sum + (item.chatSlices?.length ?? 1), 0) || 1;
  }, [stagedQueue]);

  const currentGlobalPage = useMemo(() => {
    let page = 1;
    for (let i = 0; i < selectedItemIndex; i++) {
      page += stagedQueue[i]?.stitchedIntoItemId ? 0 : stagedQueue[i]?.chatSlices?.length ?? 1;
    }
    return page + selectedSliceIndex;
  }, [stagedQueue, selectedItemIndex, selectedSliceIndex]);

  const goToNextPage = () => {
    const currentItem = stagedQueue[selectedItemIndex];
    const slicesCount = currentItem?.stitchedIntoItemId ? 0 : currentItem?.chatSlices?.length ?? 1;
    if (selectedSliceIndex < slicesCount - 1) {
      setSelectedSliceIndex((prev) => prev + 1);
    } else {
      const nextIdx = stagedQueue.findIndex((item, index) => index > selectedItemIndex && !item.stitchedIntoItemId);
      if (nextIdx < 0) return;
      setSelectedItemIndex(nextIdx);
      setSelectedSliceIndex(0);
      setPreviewImage(stagedQueue[nextIdx].previewUrl);
      if (stagedQueue[nextIdx].category !== "PENDING") setEvidenceMode(stagedQueue[nextIdx].category);
    }
  };

  const goToPrevPage = () => {
    if (selectedSliceIndex > 0) {
      setSelectedSliceIndex((prev) => prev - 1);
    } else {
      const prevIdx = stagedQueue.findLastIndex((item, index) => index < selectedItemIndex && !item.stitchedIntoItemId);
      if (prevIdx < 0) return;
      setSelectedItemIndex(prevIdx);
      const prevSlices = stagedQueue[prevIdx]?.chatSlices?.length ?? 1;
      setSelectedSliceIndex(prevSlices - 1);
      setPreviewImage(stagedQueue[prevIdx].previewUrl);
      if (stagedQueue[prevIdx].category !== "PENDING") setEvidenceMode(stagedQueue[prevIdx].category);
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

    const drawReviewMarker = (
      bounds: { x: number; y: number; width: number; height: number },
      sourceWidth: number,
      sourceHeight: number,
      target: { x: number; y: number; width: number; height: number },
    ) => {
      const rect = mapEvidenceBoundsToCanvas(bounds, { width: sourceWidth, height: sourceHeight }, target);
      if (!rect) return;
      const label = "QR candidate · รอตรวจทาน";
      ctx.save();
      ctx.fillStyle = "rgba(245, 158, 11, 0.14)";
      ctx.strokeStyle = "#d97706";
      ctx.lineWidth = 4;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      ctx.font = "bold 14px sans-serif";
      const labelWidth = ctx.measureText(label).width + 12;
      const labelX = Math.min(Math.max(0, rect.x), a4WidthPx - labelWidth);
      const labelY = Math.max(20, rect.y - 22);
      ctx.fillStyle = "#92400e";
      ctx.fillRect(labelX, labelY - 16, labelWidth, 20);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, labelX + 6, labelY - 2);
      ctx.restore();
    };

    // 1. Background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, a4WidthPx, a4HeightPx);

    // 2. Evidence Ribbon Header (Y = 38 - 115 px, Height = 77px)
    const ribbonTop = 38;
    const ribbonHeight = 77;
    const ribbonLeft = 40;
    const ribbonWidth = a4WidthPx - 80;
    const activeItem = stagedQueue[selectedItemIndex];
    const activeChatHasSlip = activeItem?.category === "CHAT" && (activeItem.embeddedSlips?.length || 0) > 0;

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
      const pageType = resolveEvidencePageType(activeItem?.category, evidenceMode, Boolean(previewImage));
      const modeLabel = "MODE : ";
      const modeValue = resolveHeaderMode(pageType, activeChatHasSlip);

      ctx.textBaseline = "alphabetic";
      ctx.font = "200 17pt 'Sarabun', sans-serif";
      ctx.fillStyle = "#111827";
      ctx.fillText(modeLabel, contentLeft, ribbonTop + 30);
      const modeLblW = ctx.measureText(modeLabel).width;

      ctx.font = "100 17pt 'Sarabun', sans-serif";
      ctx.fillText(modeValue, contentLeft + modeLblW, ribbonTop + 30);

      // Page Number (Right aligned - SSOT synchronized with navigator)
      const pageLabel = "PAGE : ";
      const pageValue = resolveHeaderPageNumber(currentGlobalPage, totalPages, pageType);

      ctx.font = "100 17pt 'Sarabun', sans-serif";
      const pageValW = ctx.measureText(pageValue).width;
      ctx.fillText(pageValue, contentRight - pageValW, ribbonTop + 30);

      ctx.font = "200 17pt 'Sarabun', sans-serif";
      const pageLblW = ctx.measureText(pageLabel).width;
      ctx.fillText(pageLabel, contentRight - pageValW - pageLblW, ribbonTop + 30);

      // Row 2 (Y = ribbonTop + 62): CORROBORATED (Left) | Timestamp (Right)
      const corroborationText = resolveHeaderCorroborated({
        type: pageType,
        itemIndex: currentGlobalPage,
        targetName: pdpaEnabled
          ? maskPersonName(targetName || evidenceState.poiName, true)
          : targetName || evidenceState.poiName,
        amount: evidenceState.totalNetLoss,
        isDuplicate: false,
        chatHasSlip: activeChatHasSlip,
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

    // 3. Evidence Block Drawing
    const isChatMode = activeItem && activeItem.category !== "PENDING"
      ? activeItem.category === "CHAT"
      : evidenceMode === "CHAT";

    if (activeItem && isChatMode && activeItem.chatSlices && activeItem.chatSlices.length > 0) {
      const activeSliceUrl = activeItem.chatSlices[selectedSliceIndex] || activeItem.chatSlices[0];
      const sliceImg = new Image();
      const renderSlice = () => {
        const { chatBlockW, chatBlockH, chatTopX, chatTopY } = FORENSIC_CANVAS_SPEC;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(chatTopX, chatTopY, chatBlockW, chatBlockH);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(sliceImg, chatTopX, chatTopY, chatBlockW, chatBlockH);
        const selectedCandidate = activeItem.embeddedSlips?.find((record) => record.id === selectedSlipRecordId);
        if (selectedCandidate?.candidateBounds) {
          drawReviewMarker(selectedCandidate.candidateBounds, sliceImg.naturalWidth || sliceImg.width,
            sliceImg.naturalHeight || sliceImg.height, { x: chatTopX, y: chatTopY, width: chatBlockW, height: chatBlockH });
        }
        drawFooter();
      };
      sliceImg.onload = renderSlice;
      sliceImg.src = activeSliceUrl;
      if (sliceImg.complete) {
        renderSlice();
      }
    } else if (previewImage) {
      const img = new Image();
      img.src = previewImage;
      img.onload = () => {
        if (isChatMode) {
          const { chatBlockW, chatBlockH, chatTopX, chatTopY } = FORENSIC_CANVAS_SPEC;
          const scale = chatBlockW / img.width;
          const drawW = chatBlockW;
          const drawH = Math.min(img.height * scale, chatBlockH);

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, img.width, drawH / scale, chatTopX, chatTopY, drawW, drawH);
          if (activeItem && activeItem.id === selectedSlipRecordId && activeItem.sourceBounds) {
            drawReviewMarker(activeItem.sourceBounds, img.naturalWidth || img.width, img.naturalHeight || img.height,
              { x: chatTopX, y: chatTopY, width: drawW, height: drawH });
          }
        } else {
          const { slipBlockW, slipBlockH, slipCenterX, slipCenterY } = FORENSIC_CANVAS_SPEC;
          const fit = fitImageToEvidenceBlock(img.width, img.height, {
            x: slipCenterX,
            y: slipCenterY,
            width: slipBlockW,
            height: slipBlockH,
          });

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, fit.x, fit.y, fit.width, fit.height);
          if (activeItem && activeItem.id === selectedSlipRecordId && activeItem.sourceBounds) {
            drawReviewMarker(activeItem.sourceBounds, img.naturalWidth || img.width, img.naturalHeight || img.height,
              { x: fit.x, y: fit.y, width: fit.width, height: fit.height });
          }
        }
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
  }, [evidenceMode, previewImage, evidenceState, centerView, selectedItemIndex, selectedSliceIndex, selectedSlipRecordId, stagedQueue]);

  // Dynamic Cover Sheet Data calculation
  const coverSheetData: CourtCoverSheetData = useMemo(() => {
    return {
      dossier_title: "รายงานสรุปแฟ้มพยานหลักฐานดิจิทัล",
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
          enabled: false,
          pairs_count: 0,
          pages: 1,
        },
        forensic_net: {
          enabled: true,
          duplicates_cut: 0,
          net_loss_amount: evidenceState.totalNetLoss.toLocaleString("th-TH", { minimumFractionDigits: 2 }),
        },
        hash_manifest: {
          enabled: true,
          pages: 1,
        },
        sfx_vault: {
          enabled: true,
          archive_name: "SFX_Preview_Pending_Real_Builder.exe",
          is_password_protected: false,
        },
      },
    };
  }, [caseNumber, evidenceState, targetName, pdpaEnabled]);

  // Step 2 Target Management Handlers
  const addTargetPerson = (raw: string, role = "ผู้รับโอน (Receiver)", amount = 0, count = 1) => {
    const clean = stripThaiTitlePrefix(raw);
    if (!clean) return;

    // Check if already in targetList
    const exists = Boolean(findExactTargetIdentity(targetList, clean, (item) => item.cleanName));
    if (exists) return;

    const newItem: TargetPersonItem = {
      id: `poi-manual-${clean.replace(/\s+/g, "_")}`,
      rawName: raw.trim(),
      cleanName: clean,
      role,
      selected: false,
      totalAmount: amount,
      txCount: count,
    };

    const updated = [...targetList, newItem];
    setTargetListSnapshot(updated);
    if (!targetName || targetList.length === 0) {
      setTargetName(clean);
    }
  };

  const removeTargetPerson = (id: string) => {
    const updated = targetList.filter((t) => t.id !== id);
    setTargetListSnapshot(updated);
    const active = updated.filter((t) => t.selected);
    if (active.length > 0) {
      setTargetName(active[0].cleanName);
    } else {
      setTargetName("");
    }
  };

  const toggleTargetPerson = (id: string) => {
    const updated = targetList.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t));
    setTargetListSnapshot(updated);
    const active = updated.filter((t) => t.selected);
    if (active.length > 0) {
      setTargetName(active[0].cleanName);
    } else {
      setTargetName("");
    }
  };

  // 2.2 Detected Names Dataset (Strict e-Slip & QR Code Extraction Only)
  const detectedNamesList = useMemo(() => {
    const eligibleRecords = slipRecipientSummary.groups.flatMap((group) => group.records);
    return buildDetectedTargetPeople(eligibleRecords);
  }, [slipRecipientSummary.groups]);

  const targetList = mergeDetectedTargetList(detectedNamesList, targetListSnapshot);

  const slipPartyNames = useMemo(() => {
    const names = new Set<string>();
    ledgerRecords.forEach((record) => {
      for (const name of [record.data.sender?.name, record.data.receiver?.name]) {
        const cleanName = stripThaiTitlePrefix(name);
        if (cleanName.split(/\s+/u).filter(Boolean).length >= 2) names.add(cleanName);
      }
    });
    return [...names];
  }, [ledgerRecords]);

  const chatEntityPages = useMemo(() => stagedQueue
      .filter((item) => item.status === "done" && item.category === "CHAT" && !item.stitchedIntoItemId)
      .flatMap((item) => (item.chatEvidenceLayers || []).map((page) => ({
        sourceItemId: item.id,
        fileName: item.file.name,
        pageNumber: page.pageNumber,
        layer1: page.layer1,
        layer2: page.layer2,
        excludedRegions: (item.embeddedSlips || [])
          .filter((slip) => slip.chatPageNumber === page.pageNumber)
          .map((slip) => ({ sourceItemId: slip.sourceItemId, bounds: slip.sourceBounds })),
      }))),
  [stagedQueue]);
  const chatEntityCandidates = useMemo(() => discoverChatEntityOccurrences(chatEntityPages, slipPartyNames), [chatEntityPages, slipPartyNames]);
  const chatEntityDiscoveryDiagnostics = useMemo(
    () => getChatEntityDiscoveryDiagnostics(chatEntityPages, slipPartyNames, chatEntityCandidates),
    [chatEntityPages, slipPartyNames, chatEntityCandidates],
  );

  const selectedTargetItems = targetList.filter((t) => t.selected);
  const selectedTargetNamesKey = selectedTargetItems.map((item) => item.cleanName).join("\u0000");

  const selectedTargetNames = selectedTargetNamesKey ? selectedTargetNamesKey.split("\u0000") : [];
  let poiAmount = 0;
  let foundTargetTransaction = false;

  ledgerRecords.forEach((record) => {
    if (!record.isConfirmed) return;
    const sender = record.data.sender?.name || "";
    const receiver = record.data.receiver?.name || "";
    const matches = selectedTargetNames.some(
      (name) => isExactTargetMatch(sender, name) || isExactTargetMatch(receiver, name),
    );
    const amount = record.data.transaction.amount || 0;
    if (matches && amount > 0) {
      poiAmount += amount;
      foundTargetTransaction = true;
    }
  });
  if (!foundTargetTransaction) poiAmount = 0;

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

  const fileToPngDataUrl = async (file: File) => {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      throw new Error("เตรียมภาพหลักฐานสำหรับ PDF ไม่สำเร็จ");
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.toDataURL("image/png");
  };

  const buildExportPayload = async (items = stagedQueue) => {
    const selectedItemIds = new Set(items.map((item) => item.id));
    return {
    caseNumber,
    generatedAt: new Date().toISOString(),
    exportPasswordSet: Boolean(exportPassword.trim()),
    coverData: coverSheetData,
    evidenceState,
    slipRecords: ledgerRecords.filter((record) => selectedItemIds.has(record.sourceItemId)).map((record) => ({
      source_file: record.source,
      source_sha256: record.sha256,
      chat_page: record.chatPage,
      dossier_page: record.dossierPage,
      source_bounds: record.bounds || null,
      is_confirmed: record.isConfirmed,
      needs_review: record.needsReview,
      data: record.data,
    })),
    manifestEntries: manifestList,
    stagedItems: await Promise.all(items.filter((item) => !item.stitchedIntoItemId).map(async (item) => ({
      fileName: item.file.name,
      category: item.category,
      meta: item.meta,
      data: item.data,
      pages: item.category === "CHAT" && item.chatSlices?.length
        ? item.chatSlices.map((imageData, index) => ({ imageData, label: `หน้าแชท ${index + 1} / ${item.chatSlices!.length}` }))
        : [{ imageData: await fileToPngDataUrl(item.file), label: item.file.name }],
    }))),
    };
  };

  const downloadExport = async (endpoint: string, extension: "pdf" | "exe") => {
    const payload = await buildExportPayload();
    const body = extension === "exe" ? new FormData() : null;
    if (body) {
      body.append("exportPassword", exportPassword.trim());
      body.append("payload", JSON.stringify(payload));
      stagedQueue.forEach((item) => body.append("sourceFiles", item.file, item.file.name));
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: body ? undefined : { "Content-Type": "application/json" },
      body: body || JSON.stringify({ exportPassword: exportPassword.trim(), payload }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(result?.error || `ส่งออก ${extension.toUpperCase()} ไม่สำเร็จ`);
    }
    if (response.headers.get("X-Digital-Evidence-Encrypted") !== String(Boolean(exportPassword.trim()))) {
      throw new Error("สถานะการตั้งรหัสของไฟล์ไม่ตรงกับค่าที่เลือก");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    const disposition = response.headers.get("Content-Disposition");
    const filename = disposition?.match(/filename="([^"]+)"/i)?.[1];
    anchor.download = filename || `Digital_Evidence_${Date.now()}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return blob;
  };

  const indexExportedPdfPages = async (pdfBlob: Blob) => {
    const descriptors = [...new Map(ledgerRecords.map((record) => {
      const key = makePdfPageMapKey(record.source, record.sha256, record.chatPage);
      return [key, {
        key,
        source_file: record.source,
        page_label: record.chatPage === "-" ? record.source : `หน้าแชท ${record.chatPage}`,
      }];
    })).values()];
    const form = new FormData();
    form.append("pdf", pdfBlob, "evidence.pdf");
    form.append("descriptors", JSON.stringify(descriptors));
    form.append("exportPassword", exportPassword.trim());
    const response = await fetch("/api/export/pdf-page-map", { method: "POST", body: form });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(result?.error || "ทำดัชนีหน้า PDF ไม่สำเร็จ");
    }
    const result = await response.json() as {
      mappings: Array<{ key: string; status: string; pdf_pages: number[] }>;
    };
    const pageMap = Object.fromEntries(result.mappings
      .filter((mapping) => mapping.status === "matched" && mapping.pdf_pages.length === 1)
      .map((mapping) => [mapping.key, mapping.pdf_pages[0]]));
    return { pageMap, matched: Object.keys(pageMap).length, total: descriptors.length };
  };

  const scanExportedPdfForSlips = async (pdfBlob: Blob) => {
    const form = new FormData();
    form.append("pdf", pdfBlob, "evidence.pdf");
    form.append("exportPassword", exportPassword.trim());
    const response = await fetch("/api/export/search-slips", { method: "POST", body: form });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(result?.error || "สแกนหน้าสลิปใน PDF ไม่สำเร็จ");
    }
    const result = await response.json() as {
      candidate_count: number;
      review_only: true;
      results: SearchSlipScanCandidate[];
    };
    if (result.review_only !== true || !Array.isArray(result.results)) {
      throw new Error("ผลสแกนสลิปไม่ได้อยู่ในรูปแบบ review-only");
    }
    setSearchSlipScanCandidates(result.results);
    return result;
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  const handleExportEvidenceDiagnosticTrace = () => {
    const report = buildEvidenceDiagnosticTrace(stagedQueue, manifestList);
    const safeCaseNumber = (caseNumber || "case").replace(/[^a-zA-Z0-9\u0E00-\u0E7F-]+/g, "_");
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" }),
      `Digital_Evidence_${safeCaseNumber}_Diagnostic_Trace.json`,
    );
    setSlipIndexStatus(`ส่งออก diagnostic trace ${report.statistics.inputImages} ภาพ · ${report.statistics.candidates} candidates`);
  };

  const indexEvidenceContentPdfPages = async (pdfBlob: Blob) => {
    const descriptorResult = buildEvidenceContentPageDescriptors(ledgerRecords.map((record) => ({
      id: record.id,
      sourceItemId: record.sourceItemId,
      chatPage: record.chatPage,
    })), stagedQueue.map((item) => ({
      id: item.id,
      fileName: item.file.name,
      category: item.category,
      stitchedIntoItemId: item.stitchedIntoItemId,
      chatStreamPageNumbers: item.chatStreamPageNumbers,
      chatSlices: item.chatSlices,
    })));
    if (descriptorResult.descriptors.length === 0) throw new Error("ไม่มีรายการที่ผูกกับหน้าหลักฐานในเล่มเนื้อหาได้");

    const form = new FormData();
    form.append("pdf", pdfBlob, "evidence-content.pdf");
    form.append("descriptors", JSON.stringify(descriptorResult.descriptors));
    form.append("exportPassword", exportPassword.trim());
    const response = await fetch("/api/export/pdf-page-map", { method: "POST", body: form });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(result?.error || "ทำดัชนีหน้าเล่มเนื้อหาไม่สำเร็จ");
    }
    const result = await response.json() as {
      mappings: Array<{ key: string; status: string; pdf_pages: number[] }>;
    };
    const pages = Object.fromEntries(result.mappings
      .filter((mapping) => mapping.status === "matched" && mapping.pdf_pages.length === 1)
      .map((mapping) => [mapping.key, mapping.pdf_pages[0]]));
    return {
      pages,
      unresolvedCount: ledgerRecords.length - Object.keys(pages).length,
    };
  };

  const handleExportPdf = async () => {
    setExportingArtifact("PDF");
    setExportStatus(null);
    setPdfPageMap({});
    setSearchSlipScanCandidates([]);
    setSearchSlipScanStatus({ state: "scanning", message: "กำลังส่งออก PDF..." });
    try {
      const pdfBlob = await downloadExport("/api/export/encrypted-pdf", "pdf");
      let pageStatus = "";
      try {
        const pageIndex = await indexExportedPdfPages(pdfBlob);
        setPdfPageMap(pageIndex.pageMap);
        pageStatus = ` · จับคู่หน้า PDF จาก label ได้ ${pageIndex.matched}/${pageIndex.total} candidate`;
      } catch (indexError) {
        pageStatus = ` · ทำดัชนีหน้า PDF ไม่สำเร็จ: ${indexError instanceof Error ? indexError.message : "ไม่ทราบสาเหตุ"}`;
      }
      try {
        const scan = await scanExportedPdfForSlips(pdfBlob);
        setSearchSlipScanStatus(createSearchSlipScanCompleteStatus(scan.candidate_count));
        pageStatus += ` · สแกน PDF พบ ${scan.candidate_count} หน้าที่เป็น visual slip candidate (ต้องตรวจทาน ไม่ยืนยันอัตโนมัติ)`;
      } catch (scanError) {
        const scanErrorMessage = scanError instanceof Error ? scanError.message : "ไม่ทราบสาเหตุ";
        setSearchSlipScanStatus(createSearchSlipScanErrorStatus(scanErrorMessage));
        pageStatus += ` · สแกนหาหน้าสลิปไม่สำเร็จ: ${scanErrorMessage}`;
      }
      setExportStatus({
        type: "success",
        message: exportPassword.trim()
          ? `ส่งออก PDF เข้ารหัส AES-256 แล้ว ใช้รหัสส่งออกเปิด PDF${pageStatus}`
          : `ส่งออก PDF แล้ว โดย PDF ไม่ได้ตั้งรหัสผ่าน${pageStatus}`,
      });
    } catch (error) {
      const exportError = error instanceof Error ? error.message : "ส่งออก PDF ไม่สำเร็จ";
      setSearchSlipScanStatus(createSearchSlipExportErrorStatus(exportError));
      setExportStatus({ type: "error", message: exportError });
    } finally {
      setExportingArtifact(null);
    }
  };

  const handleExportSlipIndexJson = () => {
    setSlipIndexStatus("กำลังเตรียมสารบัญสลิป JSON...");
    try {
      const slipIndex = buildSlipIndex(ledgerRecords, caseNumber, undefined, pdfPageMap);
      const blob = new Blob([JSON.stringify(slipIndex, null, 2)], { type: "application/json;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeCaseNumber = (caseNumber || "case").replace(/[^a-zA-Z0-9\u0E00-\u0E7F-]+/g, "_");
      anchor.href = objectUrl;
      anchor.download = `Digital_Evidence_${safeCaseNumber}_Slip_Index.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setSlipIndexStatus(`เตรียมไฟล์สารบัญสลิป JSON แล้ว (${slipIndex.transaction_count} รายการ)`);
    } catch (error) {
      setSlipIndexStatus(error instanceof Error ? `เตรียม JSON ไม่สำเร็จ: ${error.message}` : "เตรียมสารบัญสลิป JSON ไม่สำเร็จ");
    }
  };

  const handleExportSlipRecordJson = (record: (typeof ledgerRecords)[number]) => {
    try {
      const artifact = prepareSlipRecordArtifact(record, caseNumber, pdfPageMap);
      const blob = new Blob([artifact.json], { type: "application/json;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = artifact.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setSlipIndexStatus(`เตรียม JSON รายภาพ ${record.source} แล้ว`);
    } catch (error) {
      setSlipIndexStatus(error instanceof Error ? `เตรียม JSON รายภาพไม่สำเร็จ: ${error.message}` : "เตรียม JSON รายภาพไม่สำเร็จ");
    }
  };

  const handleExportNamedCaseGroups = async () => {
    const chatItems = stagedQueue.filter((item) => item.category === "CHAT");
    const plans = buildNamedCaseOutputPlans(chatItems.map((item) => ({ id: item.id, fileName: item.file.name })));
    if (!plans.length) {
      setSlipIndexStatus("ไม่มีภาพแชทในคิวสำหรับส่งออกแยกตามชื่อไฟล์");
      return;
    }

    let pdfCompleted = 0;
    const preparedIndexes: typeof pendingNamedSlipIndexes = [];
    const failures: string[] = [];
    setPendingNamedSlipIndexes([]);
    for (const plan of plans) {
      const items = chatItems.filter((item) => plan.itemIds.includes(item.id));
      try {
        const payload = await buildExportPayload(items);
        const response = await fetch("/api/export/evidence-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exportPassword: exportPassword.trim(), payload }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(result?.error || "ส่งออก PDF กลุ่มไม่สำเร็จ");
        }
        if (response.headers.get("X-Digital-Evidence-Encrypted") !== String(Boolean(exportPassword.trim()))) {
          throw new Error("สถานะรหัสผ่านของ PDF กลุ่มไม่ตรงกับค่าที่เลือก");
        }
        downloadBlob(await response.blob(), `Evidence_Chat_${plan.outputStem}.pdf`);
        pdfCompleted += 1;
        preparedIndexes.push({
          groupLabel: plan.label,
          ...prepareNamedGroupSlipIndex(ledgerRecords, plan, caseNumber),
        });
      } catch (error) {
        failures.push(`${plan.label}: ${error instanceof Error ? error.message : "ส่งออกไม่สำเร็จ"}`);
      }
    }
    setPendingNamedSlipIndexes(preparedIndexes);
    setSlipIndexStatus(`ส่งออก PDF ${pdfCompleted}/${plans.length} กลุ่ม; Slip Index JSON พร้อมดาวน์โหลด ${preparedIndexes.length} กลุ่ม${failures.length ? `; ปัญหา: ${failures.join("; ")}` : ""}`);
  };

  const handleExportSlipIndexMarkdown = () => {
    setSlipIndexStatus("กำลังเตรียมสารบัญสลิป Markdown...");
    try {
      const index = buildSlipIndex(ledgerRecords, caseNumber, undefined, pdfPageMap);
      const blob = new Blob([buildSlipIndexMarkdown(index)], { type: "text/markdown;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeCaseNumber = (caseNumber || "case").replace(/[^a-zA-Z0-9\u0E00-\u0E7F-]+/g, "_");
      anchor.href = objectUrl;
      anchor.download = `Digital_Evidence_${safeCaseNumber}_Slip_Index.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setSlipIndexStatus(`เตรียมไฟล์สารบัญสลิป Markdown แล้ว (${index.transaction_count} รายการ)`);
    } catch (error) {
      setSlipIndexStatus(error instanceof Error ? `เตรียม Markdown ไม่สำเร็จ: ${error.message}` : "เตรียมสารบัญสลิป Markdown ไม่สำเร็จ");
    }
  };

  const handleExportNetReconciliationDossier = () => {
    const dossier = buildNetReconciliationDossier({
      caseNumber,
      generatedAt: new Date().toISOString(),
      occurrences: ledgerRecords.map((record) => ({
        id: record.id,
        source: record.source,
        sha256: record.sha256,
        dossierPage: record.dossierPage,
        isConfirmed: record.isConfirmed,
        amount: record.data.transaction.amount,
        referenceNo: record.data.transaction.reference_no,
      })),
      summary: reviewedDuplicateSummary,
    });
    const safeCaseNumber = (caseNumber || "case").replace(/[^a-zA-Z0-9\u0E00-\u0E7F-]+/g, "_");
    downloadBlob(new Blob([JSON.stringify(dossier, null, 2)], { type: "application/json;charset=utf-8" }), `Digital_Evidence_${safeCaseNumber}_NET_Review.json`);
    setNetDossierStatus(`ส่งออก NET review JSON แล้ว · ${reviewedDuplicateSummary.unresolvedGroupCount} กลุ่มยังไม่วินิจฉัย`);
  };

  const handleExportLedgerXlsx = async () => {
    if (ledgerRecords.length === 0) return;
    setLedgerXlsxStatus("กำลังสร้าง XLSX...");
    try {
      const { downloadFinancialSummaryXlsx } = await import("@/utils/financial-summary-xlsx.mjs");
      const safeCaseNumber = (caseNumber || "012-2569").replace(/[^a-zA-Z0-9\u0E00-\u0E7F-]+/g, "_");
      await downloadFinancialSummaryXlsx(ledgerRecords, `Digital_Evidence_${safeCaseNumber}.xlsx`, {
        caseNumber,
        totalNet: evidenceState.totalNetLoss,
      });
      setLedgerXlsxStatus("สร้าง XLSX แล้ว");
    } catch (error) {
      setLedgerXlsxStatus(error instanceof Error ? `ส่งออกไม่สำเร็จ: ${error.message}` : "ส่งออก XLSX ไม่สำเร็จ");
    }
  };

  const handleExportTargetLedger = async (target: TargetPersonItem) => {
    const records = selectTargetDossierRecords(ledgerRecords, target.cleanName);
    if (records.length === 0) {
      setTargetDossierStatus(`ไม่พบรายการที่ชื่อผู้โอนหรือผู้รับตรงกับ ${target.cleanName}`);
      return;
    }
    try {
      const { downloadTargetLedgerXlsx } = await import("@/utils/only-target-exports.mjs");
      const safeName = target.cleanName.replace(/[^a-zA-Z0-9\u0E00-\u0E7F-]+/g, "_");
      await downloadTargetLedgerXlsx(records, `Digital_Evidence_${safeName}_Ledger.xlsx`, { targetName: target.cleanName, caseNumber });
      setTargetDossierStatus(`สร้าง Excel เฉพาะ ${target.cleanName} แล้ว · ${records.length} รายการ`);
    } catch (error) {
      setTargetDossierStatus(error instanceof Error ? `สร้าง Excel ไม่สำเร็จ: ${error.message}` : "สร้าง Excel เฉพาะเป้าหมายไม่สำเร็จ");
    }
  };

  const resolveTargetDossierImage = async (record: (typeof ledgerRecords)[number]) => {
    if (record.crop.startsWith("data:image/")) return record.crop;
    if (record.crop.startsWith("blob:")) {
      try {
        const blob = await fetch(record.crop).then((response) => {
          if (!response.ok) throw new Error("temporary crop unavailable");
          return response.blob();
        });
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) {
          bitmap.close();
          throw new Error("เตรียมภาพ crop ไม่สำเร็จ");
        }
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return canvas.toDataURL("image/png");
      } catch {
        // Restored sessions can contain expired blob URLs; reconstruct from the preserved source file below.
      }
    }
    const sourceItem = stagedQueue.find((item) => item.id === record.sourceItemId);
    if (!sourceItem) throw new Error(`ไม่พบไฟล์ต้นฉบับ ${record.sourceItemId}`);
    if (sourceItem.category !== "CHAT") return fileToPngDataUrl(sourceItem.file);
    if (record.crossesSourceBoundary || !record.bounds) throw new Error(`ไม่สามารถสร้าง crop จากภาพแชทต้นฉบับได้อย่างปลอดภัย (${record.id})`);

    const bitmap = await createImageBitmap(sourceItem.file);
    const left = Math.max(0, Math.floor(record.bounds.x));
    const top = Math.max(0, Math.floor(record.bounds.y));
    const right = Math.min(bitmap.width, Math.ceil(record.bounds.x + record.bounds.width));
    const bottom = Math.min(bitmap.height, Math.ceil(record.bounds.y + record.bounds.height));
    if (right <= left || bottom <= top) {
      bitmap.close();
      throw new Error(`พิกัด crop อยู่นอกภาพต้นฉบับ (${record.id})`);
    }
    const canvas = document.createElement("canvas");
    canvas.width = right - left;
    canvas.height = bottom - top;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      throw new Error("เตรียมภาพ crop ไม่สำเร็จ");
    }
    context.drawImage(bitmap, left, top, right - left, bottom - top, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas.toDataURL("image/png");
  };

  const handleExportTargetPdf = async (target: TargetPersonItem) => {
    const records = selectTargetDossierRecords(ledgerRecords, target.cleanName);
    if (records.length === 0) {
      setTargetDossierStatus(`ไม่พบรายการที่ชื่อผู้โอนหรือผู้รับตรงกับ ${target.cleanName}`);
      return;
    }
    setTargetDossierStatus(`กำลังสร้าง PDF เฉพาะ ${target.cleanName}...`);
    try {
      const dossierImages = await Promise.all(records.map(({ record }) => resolveTargetDossierImage(record)));
      const payload = {
        caseNumber,
        generatedAt: new Date().toISOString(),
        exportPasswordSet: Boolean(exportPassword.trim()),
        stagedItems: records.map(({ record, direction }, index) => ({
          fileName: `${String(index + 1).padStart(3, "0")}_${record.source}`,
          category: "SLIP",
          data: record.data,
          pages: [{ imageData: dossierImages[index], label: `รายการ ${index + 1} · ${direction} · ${record.data.transaction.date || "ไม่ทราบวันที่"} ${record.data.transaction.time || ""} · ${record.isDuplicate ? "ซ้ำ · " : ""}${record.isConfirmed ? "ยืนยันแล้ว" : "รอตรวจ"}` }],
        })),
      };
      const response = await fetch("/api/export/evidence-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportPassword: exportPassword.trim(), payload }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "ส่งออก PDF ไม่สำเร็จ");
      }
      if (response.headers.get("X-Digital-Evidence-Encrypted") !== String(Boolean(exportPassword.trim()))) {
        throw new Error("สถานะการตั้งรหัสผ่านของ PDF ไม่ตรงกับค่าที่เลือก");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Evidence_Content_${target.cleanName.replace(/[^a-zA-Z0-9\u0E00-\u0E7F-]+/g, "_")}.pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTargetDossierStatus(`สร้าง PDF เฉพาะ ${target.cleanName} แล้ว · ${records.length} ภาพตามลำดับเวลา`);
    } catch (error) {
      setTargetDossierStatus(error instanceof Error ? `สร้าง PDF ไม่สำเร็จ: ${error.message}` : "สร้าง PDF เฉพาะเป้าหมายไม่สำเร็จ");
    }
  };

  const handleExportEvidenceContent = async () => {
    if (ledgerRecords.length === 0) return;
    setExportingArtifact("CONTENT");
    setEvidenceContentStatus("กำลังสร้างเล่มเนื้อหาและตรวจ page markers...");
    setSummaryIndexStatus(null);
    try {
      const payload = await buildExportPayload();
      const response = await fetch("/api/export/evidence-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportPassword: exportPassword.trim(), payload }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "ส่งออกเล่มเนื้อหาไม่สำเร็จ");
      }
      if (response.headers.get("X-Digital-Evidence-Encrypted") !== String(Boolean(exportPassword.trim()))) {
        throw new Error("สถานะการตั้งรหัสของเล่มเนื้อหาไม่ตรงกับค่าที่เลือก");
      }
      const pdfBlob = await response.blob();
      let mapResult: { pages: Record<string, number>; unresolvedCount: number };
      try {
        mapResult = await indexEvidenceContentPdfPages(pdfBlob);
        setEvidenceContentPageMap({ sourceKey: contentVolumeSourceKey, pages: mapResult.pages });
        setEvidenceContentStatus(`สร้างเล่มเนื้อหาแล้ว · map หน้าได้ ${ledgerRecords.length - mapResult.unresolvedCount}/${ledgerRecords.length}`);
      } catch (indexError) {
        setEvidenceContentPageMap({ sourceKey: contentVolumeSourceKey, pages: {} });
        setEvidenceContentStatus(`สร้าง PDF แล้ว แต่ map หน้าไม่สำเร็จ: ${indexError instanceof Error ? indexError.message : "ไม่ทราบสาเหตุ"}`);
      }
      const disposition = response.headers.get("Content-Disposition");
      const fileName = disposition?.match(/filename="([^"]+)"/i)?.[1] || "Evidence_Content.pdf";
      downloadBlob(pdfBlob, fileName);
    } catch (error) {
      setEvidenceContentStatus(error instanceof Error ? error.message : "ส่งออกเล่มเนื้อหาไม่สำเร็จ");
    } finally {
      setExportingArtifact(null);
    }
  };

  const handleExportSummaryIndexPdf = async () => {
    if (!summaryIndexReady) return;
    setExportingArtifact("SUMMARY_INDEX");
    setSummaryIndexStatus("กำลังสร้าง PDF สารบัญ 10 คอลัมน์...");
    try {
      const rows = buildFinancialSummaryIndexRows(ledgerRecords, summaryPhysicalPages);
      const response = await fetch("/api/export/summary-index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseNumber, rows, exportPassword: exportPassword.trim() }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "ส่งออก PDF สารบัญไม่สำเร็จ");
      }
      if (response.headers.get("X-Digital-Evidence-Encrypted") !== String(Boolean(exportPassword.trim()))) {
        throw new Error("สถานะการตั้งรหัส PDF สารบัญไม่ตรงกับค่าที่เลือก");
      }
      const disposition = response.headers.get("Content-Disposition");
      const fileName = disposition?.match(/filename="([^"]+)"/i)?.[1] || "Financial_Index.pdf";
      downloadBlob(await response.blob(), fileName);
      setSummaryIndexStatus("สร้าง PDF สารบัญแยกแล้ว");
    } catch (error) {
      setSummaryIndexStatus(error instanceof Error ? error.message : "ส่งออก PDF สารบัญไม่สำเร็จ");
    } finally {
      setExportingArtifact(null);
    }
  };

  const handleExportSummaryIndexXlsx = async () => {
    if (!summaryIndexReady) return;
    setExportingArtifact("SUMMARY_INDEX");
    setSummaryIndexStatus("กำลังสร้าง XLSX สารบัญ 10 คอลัมน์...");
    try {
      const { downloadFinancialSummaryIndexXlsx } = await import("@/utils/financial-summary-index.mjs");
      const safeCaseNumber = (caseNumber || "012-2569").replace(/[^a-zA-Z0-9\u0E00-\u0E7F-]+/g, "_");
      await downloadFinancialSummaryIndexXlsx(ledgerRecords, `Digital_Evidence_${safeCaseNumber}_Financial_Index.xlsx`, {
        caseNumber,
        physicalPages: summaryPhysicalPages,
      });
      setSummaryIndexStatus("สร้าง XLSX สารบัญแยกแล้ว");
    } catch (error) {
      setSummaryIndexStatus(error instanceof Error ? error.message : "ส่งออก XLSX สารบัญไม่สำเร็จ");
    } finally {
      setExportingArtifact(null);
    }
  };

  const handleExportConsistentReviewPacket = async () => {
    if (chatSlipCorroborationCandidates.length === 0) return;
    setExportingArtifact("CORROBORATION");
    setCorroborationPacketStatus("กำลังจัดชุดคู่หลักฐานรอตรวจทาน...");
    try {
      const chatPages = stagedQueue
        .filter((item) => item.status === "done" && item.category === "CHAT")
        .flatMap((item) => (item.chatSlices || []).map((imageData, index) => ({
          sourceItemId: item.id,
          fileName: item.file.name,
          sha256: item.meta?.sha256 || "",
          pageNumber: item.chatStreamPageNumbers?.[index] ?? index + 1,
          imageData,
        })));
      const packetRecords = await Promise.all(ledgerRecords.map(async (record) => {
        if (record.crop.startsWith("data:image/")) return { ...record, imageData: record.crop };
        const sourceItem = stagedQueue.find((item) => item.id === record.sourceItemId);
        if (!sourceItem) throw new Error(`ไม่พบไฟล์ต้นทางของสลิป ${record.source}`);
        return { ...record, imageData: await fileToPngDataUrl(sourceItem.file) };
      }));
      const payload = buildConsistentReviewPacketPayload({
        caseNumber,
        candidates: chatSlipCorroborationCandidates,
        records: packetRecords,
        chatPages,
      });
      const body = JSON.stringify({ exportPassword: exportPassword.trim(), payload });
      if (new Blob([body]).size > 64 * 1024 * 1024) throw new Error("ข้อมูล review packet เกินขนาด 64 MB");
      const response = await fetch("/api/export/consistent-review-packet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "ส่งออกชุดคู่หลักฐานไม่สำเร็จ");
      }
      if (response.headers.get("X-Digital-Evidence-Encrypted") !== String(Boolean(exportPassword.trim()))) {
        throw new Error("สถานะการตั้งรหัส review packet ไม่ตรงกับค่าที่เลือก");
      }
      const disposition = response.headers.get("Content-Disposition");
      const fileName = disposition?.match(/filename="([^"]+)"/i)?.[1] || "Consistent_Review_Packet.pdf";
      downloadBlob(await response.blob(), fileName);
      setCorroborationPacketStatus(`ส่งออกชุดตรวจทานแล้ว · ${payload.pairs.length} candidate · ทุกคู่ยังรอตรวจ`);
    } catch (error) {
      setCorroborationPacketStatus(error instanceof Error ? error.message : "ส่งออกชุดคู่หลักฐานไม่สำเร็จ");
    } finally {
      setExportingArtifact(null);
    }
  };

  const handleExportSfx = async () => {
    setExportingArtifact("SFX");
    setExportStatus(null);
    try {
      await downloadExport("/api/export/sfx", "exe");
      setExportStatus({
        type: "success",
        message: exportPassword.trim()
          ? "สร้าง SFX แล้ว ใช้รหัสส่งออกเดียวกันกับ SFX และ PDF"
          : "สร้าง SFX แล้ว โดยไม่ได้ตั้งรหัสผ่าน",
      });
    } catch (error) {
      setExportStatus({ type: "error", message: error instanceof Error ? error.message : "สร้าง SFX ไม่สำเร็จ" });
    } finally {
      setExportingArtifact(null);
    }
  };

  const handleCreateDerivedImagePdf = async () => {
    const selected = stagedQueue[selectedItemIndex];
    if (!selected) {
      setExportStatus({ type: "error", message: "เลือกภาพในคิวก่อนสร้าง PDF อนุพันธ์" });
      return;
    }
    setExportingArtifact("DERIVED");
    setExportStatus(null);
    try {
      const form = new FormData();
      form.append("image", selected.file, selected.file.name);
      const response = await fetch("/api/derived-image", { method: "POST", body: form });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "สร้าง PDF อนุพันธ์ไม่สำเร็จ");
      }
      if (response.headers.get("X-Digital-Evidence-Artifact") !== "derived-visualization-only") {
        throw new Error("คำตอบจากเซิร์ฟเวอร์ไม่มีป้ายกำกับภาพอนุพันธ์");
      }
      downloadBlob(await response.blob(), `Derived_${selected.file.name.replace(/[^\w.-]+/g, "_")}.zip`);
      setExportStatus({ type: "success", message: "สร้างชุด PDF อนุพันธ์แล้ว · ต้นฉบับและข้อมูล OCR/บัญชีไม่ได้เปลี่ยน · ห้ามใช้อ้างแทนภาพต้นฉบับ" });
    } catch (error) {
      setExportStatus({ type: "error", message: error instanceof Error ? error.message : "สร้าง PDF อนุพันธ์ไม่สำเร็จ" });
    } finally {
      setExportingArtifact(null);
    }
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
              เครื่องมือรวบรวมและจัดระเบียบแฟ้มพยานหลักฐานดิจิทัล
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
          <span>เลขเรื่องที่:</span>
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
              id="evidence-file-input"
              type="file"
              ref={fileInputRef}
              multiple
              onChange={(e) => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                if (files.length > 0) void stageIncomingFiles(files);
              }}
              accept="image/*"
              className="hidden"
            />

            {/* Drag-and-Drop Dropzone (Staging Buffer Ingestion) */}
            <label
              htmlFor="evidence-file-input"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
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
                    หยอดไฟล์ไม่จำกัดจำนวน
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    PNG, JPG, WEBP (พักรอให้ครบก่อนกดรันทีเดียว)
                  </p>
                  <span
                    className="btn-proportional-compact mt-3 inline-flex items-center justify-center rounded-lg bg-white/5 border border-white/15 text-sky-400 hover:bg-white/10 font-medium"
                  >
                    + เลือกไฟล์เพิ่มลงในบัฟเฟอร์
                  </span>
                </>
              )}
            </label>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-500/15 border border-red-400/40 typo-label text-red-300">
                ⚠️ {errorMsg}
              </div>
            )}
            {queueRestoreNotice && (
              <div role="status" className="p-3 rounded-lg bg-amber-500/10 border border-amber-300/30 typo-label text-amber-100">
                {queueRestoreNotice}
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
                      {stagedQueue.some((item) => item.category === "PENDING") && (
                        <div className="text-[11px] text-sky-300 font-mono mt-0.5">
                          ไฟล์ {stagedQueue.length} รายการ · รอจำแนกเนื้อหาจนกดประมวลผล
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={clearStagingBuffer}
                    type="button"
                    aria-label="ล้างคิว"
                    title="ล้างคิว"
                    className="grid size-9 shrink-0 place-items-center rounded-md border border-red-400/30 bg-red-500/10 text-sm font-medium text-red-300 hover:bg-red-500/20"
                  >
                    ล้าง
                  </button>
                </div>

                <div className="border-t border-white/10 pt-2 space-y-1.5" aria-live="polite">
                  {exactDuplicateGroups.length === 0 ? (
                    <div className="text-[10px] text-emerald-300">ยังไม่พบไฟล์ที่มี SHA-256 ตรงกันในคิว</div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-semibold text-amber-300">
                        พบ {exactDuplicateGroups.length} กลุ่มไฟล์ที่เหมือนกันทุกไบต์ · ยังคงเก็บทุกรายการไว้ในคิว
                      </div>
                      {exactDuplicateGroups.map((group) => (
                        <div key={group.sha256} className="text-[10px] text-amber-100 bg-amber-500/10 border border-amber-400/20 rounded-md px-2 py-1.5">
                          {group.occurrences.map((occurrence, index) => (
                            <React.Fragment key={occurrence.id}>
                              {index > 0 && <span className="text-slate-500"> ↔ </span>}
                              <span className="text-slate-400">#{stagedQueue.findIndex((item) => item.id === occurrence.id) + 1} </span>
                              <span title={occurrence.fileName}>{occurrence.fileName}</span>
                            </React.Fragment>
                          ))}
                          <span className="ml-1 text-slate-400 font-mono">SHA-256 {group.sha256.slice(0, 12)}…</span>
                        </div>
                      ))}
                      <div className="text-[10px] text-slate-400">เลือก ✕ ข้างไฟล์เพื่อเอารายการนั้นออก หรือคงไว้แล้วประมวลผลตามปกติ</div>
                    </div>
                  )}
                </div>

                {stagedQueue.some((item) => item.category === "CHAT") && (
                  <div className="rounded-md border border-sky-400/20 bg-sky-500/5 px-2 py-1.5 text-[10px] text-sky-100" aria-live="polite">
                    <div className="font-semibold text-sky-300">กลุ่มชื่อไฟล์ที่ตรวจพบ</div>
                    {filenamePrefixGroups.map((group) => (
                      <div key={group.prefix?.toLocaleLowerCase() || group.files[0]?.id}>
                        {group.prefix || group.files[0]?.fileName} · {group.files.length} ไฟล์
                      </div>
                    ))}
                    {filenamePrefixGroups.filter((group) => group.prefix).length > 1 && (
                      <div className="mt-1 text-amber-300">พบหลาย prefix แต่แอปยังใช้เลขคดีเดียวกับทั้งคิว กรุณาแยกคิวก่อนประมวลผลหากเป็นคนละคดี</div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleExportNamedCaseGroups()}
                      disabled={loading || stagedQueue.every((item) => item.category !== "CHAT")}
                      className="mt-1.5 rounded border border-sky-400/40 bg-sky-500/10 px-2 py-1 text-[10px] font-semibold text-sky-200 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ส่งออก PDF และเตรียม Slip Index JSON
                    </button>
                    {pendingNamedSlipIndexes.map((artifact) => (
                      <button
                        key={artifact.fileName}
                        type="button"
                        onClick={() => {
                          downloadBlob(
                            new Blob([artifact.json], { type: "application/json;charset=utf-8" }),
                            artifact.fileName,
                          );
                          setPendingNamedSlipIndexes((previous) => previous.filter((item) => item.fileName !== artifact.fileName));
                          setSlipIndexStatus(`ส่งคำขอดาวน์โหลด Slip Index JSON แล้ว: ${artifact.fileName}`);
                        }}
                        className="mt-1.5 rounded border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/20"
                      >
                        ดาวน์โหลด Slip Index JSON · {artifact.groupLabel} ({artifact.transactionCount})
                      </button>
                    ))}
                    {slipIndexStatus && <div className="mt-1 text-slate-300" role="status">{slipIndexStatus}</div>}
                  </div>
                )}

                {/* PHASE 2 EXECUTE BUTTON */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    executeUnifiedBatch();
                  }}
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
                <button
                  type="button"
                  onClick={handleExportEvidenceDiagnosticTrace}
                  disabled={loading || stagedQueue.length === 0}
                  className="w-full rounded-lg border border-sky-400/30 bg-sky-950/40 px-3 py-2 text-[11px] font-semibold text-sky-200 hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ดาวน์โหลด JSON Trace · {stagedQueue.length} ภาพ
                </button>
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
                            {item.file.name}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {item.status === "processing" ? (
                              <span className="text-[10px] text-amber-400 font-mono animate-pulse">
                                🔄 กำลังวิเคราะห์...
                              </span>
                            ) : item.status === "staged" ? (
                              <span className="text-[10px] text-sky-300 font-mono">
                                📦 {item.category === "PENDING" ? "ไฟล์ต้นฉบับ (รอจำแนก/ประมวลผล)" : item.category === "SLIP" ? "สลิป (รอรัน)" : "แชท (รอรัน)"}
                              </span>
                            ) : item.status === "error" ? (
                              <span className="text-[10px] text-red-400 font-mono" title={item.error || "เกิดข้อผิดพลาดในการประมวลผล"}>
                                ⚠️ {item.error || "เกิดข้อผิดพลาดในการประมวลผล"}
                              </span>
                            ) : item.category === "SLIP" ? (
                              <span className="text-[10px] text-emerald-400 font-mono font-bold">
                                🧾 สลิป ✓
                              </span>
                            ) : (
                              <span className="text-[10px] text-sky-400 font-mono">
                                📷 หน้าแชท
                              </span>
                            )}
                            {exactDuplicateOf.has(item.id) && (
                              <span className="text-[10px] text-amber-300 font-mono font-bold">
                                ⚠️ SHA-256 ตรงกับ {exactDuplicateOf.get(item.id)} · ยังไม่ตัดออก
                              </span>
                            )}
                            {item.stitchedIntoItemId && (
                              <span className="text-[10px] text-amber-200 font-mono">
                                รวมหน้าไว้กับ {stagedQueue.find((source) => source.id === item.stitchedIntoItemId)?.file.name || "ไฟล์ต้นทางที่เชื่อมต่อ"}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {(item.status === "done" || item.status === "error") && !item.stitchedIntoItemId && (
                        <div className="ml-1 flex shrink-0 gap-1">
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); void scanSelectedSlipWithAi(item.id); }}
                            disabled={aiScanItemId !== null || loading}
                            title="ส่งภาพนี้ไป Gemini เพื่อหาสลิป; ผลเป็น candidate รอตรวจ ไม่ยืนยันธุรกรรม"
                            className="rounded border border-sky-400/40 px-1.5 py-1 text-[10px] text-sky-200 disabled:opacity-40"
                          >{aiScanItemId === item.id ? "กำลังสกัด" : "Gemini"}</button>
                          <button
                            type="button"
                            onClick={(event) => { event.stopPropagation(); void scanSelectedSlipWithAi(item.id, "slipvision"); }}
                            disabled={aiScanItemId !== null || loading}
                            title="ส่งภาพนี้ผ่าน SlipVision ในเครื่องไป Gemini; ผลเป็น candidate รอตรวจ ไม่ยืนยันธุรกรรม"
                            className="rounded border border-emerald-400/40 px-1.5 py-1 text-[10px] text-emerald-200 disabled:opacity-40"
                          >SlipVision</button>
                        </div>
                      )}

                      {/* Remove item button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeStagedItem(item.id);
                        }}
                        className="text-slate-500 hover:text-red-400 text-xs px-1.5 py-0.5 ml-1 rounded hover:bg-white/5"
                        title="นำรายการนี้ออกจากคิว"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                {aiScanMessage && <div role="status" className="text-[10px] text-amber-200">{aiScanMessage}</div>}
              </div>
            )}

            {/* Category Chips - Displayed when counts exist */}
            {(stagedQueue.length > 0 || evidenceState.chatPageCount > 0 || evidenceState.slipCount > 0) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="glass-nested p-2.5 rounded-lg text-center border-sky-400/40">
                    <div className="text-xs text-slate-400 font-medium">📷 แชท</div>
                    <div className="font-mono text-sm font-bold text-slate-100 mt-0.5">
                      {evidenceState.chatPageCount} หน้า
                    </div>
                </div>
                  <div className="glass-nested p-2.5 rounded-lg text-center border-emerald-400/40">
                    <div className="text-xs text-emerald-400 font-medium">🧾 สลิป</div>
                    <div className="font-mono text-sm font-bold text-emerald-400 mt-0.5">
                      {formatSlipReviewCounts(ledgerReconciliation)}
                    </div>
                  </div>
              </div>
            )}

            {/* =================================================================
                STEP 2: รายชื่อที่ตรวจพบจากหลักฐาน (Auto Detected Persons)
                ================================================================= */}
            <div className="flex flex-col gap-2.5 pt-2 border-t border-white/10 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  ตรวจพบรายชื่อ
                </span>
                <button
                  type="button"
                  onClick={() => setDetectedNamesModalOpen(true)}
                  className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded border border-emerald-500/25 font-semibold transition-colors"
                >
                  บุคคลที่เลือกตรวจรายการ {selectedTargetItems.length} คน
                </button>
              </div>

              <div className="glass-nested p-3 rounded-xl border border-sky-400/20 flex flex-col gap-2">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>สลิปที่ตรวจพบ {slipRecipientSummary.detectedSlipCount} ใบ</span>
                  <span>ผู้รับที่อ่านได้ {slipRecipientSummary.groups.length} คน</span>
                </div>
                {slipRecipientSummary.groups.length > 0 ? (
                  <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                    {slipRecipientSummary.groups.map((group) => (
                      <div key={group.key} className="rounded-lg border border-white/10 bg-black/20">
                        <div className="flex items-start justify-between gap-2 px-2.5 py-2">
                          <input
                            type="checkbox"
                            aria-label={`เลือก ${pdpaEnabled ? maskPersonName(group.name, true) : group.name} เป็นเป้าหมาย`}
                            checked={targetList.some((item) => item.selected && item.cleanName.replace(/\s/g, "") === stripThaiTitlePrefix(group.name).replace(/\s/g, ""))}
                            onChange={() => {
                              const target = targetList.find((item) => item.cleanName.replace(/\s/g, "") === stripThaiTitlePrefix(group.name).replace(/\s/g, ""));
                              if (target) toggleTargetPerson(target.id);
                            }}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-sky-500"
                          />
                          <span className="min-w-0 flex-1 break-words text-xs font-semibold text-slate-100">
                            {pdpaEnabled ? maskPersonName(group.name, true) : group.name}
                            <span className="ml-1.5 whitespace-nowrap text-[10px] font-normal text-slate-400">{group.records.length} สลิป</span>
                          </span>
                          <span className="shrink-0 text-[11px] font-mono font-bold text-emerald-400">
                            {group.amountCount > 0
                              ? `฿${group.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : "ยอดรอตรวจ"}
                          </span>
                        </div>
                        <div className="space-y-1 border-t border-white/10 px-2.5 py-2">
                          {group.records.map((record) => (
                            <div key={record.id} className="text-[10px]">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 text-slate-300">
                                  {record.amount !== null
                                    ? `จำนวนเงิน ฿${record.amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : "อ่านจำนวนเงินไม่ได้"}
                                  {record.missingFields.length > 0 && (
                                    <span className="ml-1 text-amber-300">
                                      {`· อ่านไม่ครบ: ${record.missingFields.join(", ")}`}
                                    </span>
                                  )}
                                </div>
                                <button type="button" onClick={() => openSlipSourcePage(record)} className="shrink-0 text-sky-300 underline">ดูหน้า</button>
                              </div>
                              <div className="mt-0.5 text-[9px] text-slate-500">
                                {record.source} · หน้าแชท {record.chatPage} · หน้าแฟ้ม PDF {record.dossierPage ?? "ไม่มีข้อมูล"}
                                {record.bounds ? ` · ตำแหน่ง ${record.bounds.x}, ${record.bounds.y}` : ""}
                              </div>
                              {record.receiverNameManuallyReviewed && (
                                <div className="mt-1 text-[9px] text-amber-300">
                                  {record.receiverNameOcrConflict ? "แก้ชื่อจากข้อเสนอแล้ว · ผล OCR เดิมยังขัดแย้ง · รอตรวจยืนยัน" : "ผู้ใช้แก้/กรอกชื่อแล้ว · รอตรวจยืนยัน"}
                                </div>
                              )}
                              {record.corroboratedRecipientName && (
                                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300/20 bg-amber-300/5 px-2 py-1.5 text-[10px]">
                                  <span className="min-w-0 text-amber-100">
                                    ข้อเสนอจากบัญชีปลายทางเดียวกัน (occurrence #{record.corroboratedFromOccurrenceId}): <strong>{pdpaEnabled ? maskPersonName(record.corroboratedRecipientName, true) : record.corroboratedRecipientName}</strong> · รอตรวจทาน
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => updateLedgerRecord(record.id, "receiver_name", record.corroboratedRecipientName!)}
                                    className="shrink-0 rounded border border-amber-300/30 px-2 py-1 text-amber-100 hover:bg-amber-300/10"
                                  >ใช้ชื่อเสนอเพื่อตรวจทาน</button>
                                </div>
                              )}
                              {record.data.raw_text?.length ? (
                                <details className="mt-1 text-[9px] text-slate-400">
                                  <summary className="cursor-pointer text-sky-300">หลักฐาน OCR ของ candidate · ข้อความ OCR ทั้งหมดและที่มา</summary>
                                  <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{record.data.raw_text.join("\n")}</pre>
                                  {record.ocrTextBoxes?.length ? (
                                    <div className="mt-1 border-t border-white/10 pt-1 font-mono">
                                      {record.ocrTextBoxes.map((box, boxIndex) => (
                                        <div key={`${record.id}-ocr-${boxIndex}`}>
                                          [{box.classification === "slip_evidence" ? "อยู่ในสลิป" : box.classification === "chat_context" ? "บริบทแชท" : box.classification === "uncertain" ? "ไม่แน่ชัด" : "ไม่มีป้ายกำกับ"}] {box.text} · ({box.bounds.x}, {box.bounds.y}, {box.bounds.width}, {box.bounds.height}) · {Math.round(box.confidence * 100)}% · {box.reason || "ไม่มีเหตุผลกำกับ"}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </details>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : slipRecipientSummary.unassignedRecords.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 bg-black/20 p-3 text-center text-[11px] italic text-slate-400">
                    ยังไม่พบรายการสลิปในข้อมูลที่ประมวลผลแล้ว
                  </div>
                ) : null}

                {slipRecipientSummary.unassignedRecords.length > 0 && (
                  <div className="space-y-1.5 border-t border-amber-400/20 pt-2">
                    <div className="text-[10px] font-semibold text-amber-300">
                      สลิปที่ยังอ่านชื่อผู้รับไม่ได้ ({slipRecipientSummary.unassignedRecords.length})
                    </div>
                    {slipRecipientSummary.unassignedRecords.map((record) => (
                      <div key={record.id} className="rounded-lg border border-amber-400/20 bg-amber-500/5 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-100">
                            {record.receiverNameNeedsReview
                              ? "OCR อ่านชื่อผู้รับซ้ำได้ผลต่างกัน · ต้องตรวจจากภาพ"
                              : "ชื่อผู้รับอ่านไม่ได้"}
                          </span>
                          <span className="shrink-0 font-mono font-bold text-amber-300">
                            {record.amount !== null ? `฿${record.amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "ยอดอ่านไม่ได้"}
                          </span>
                        </div>
                        {record.suggestedRecipientName && (
                          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300/20 bg-amber-300/5 px-2 py-1.5 text-[10px]">
                            <span className="min-w-0 text-amber-100">
                              ข้อเสนอจาก occurrence #{record.suggestedFromOccurrenceId}: <strong>{record.suggestedRecipientName}</strong> · รอตรวจทาน
                            </span>
                            <button
                              type="button"
                              onClick={() => updateLedgerRecord(record.id, "receiver_name", record.suggestedRecipientName!)}
                              className="shrink-0 rounded border border-amber-300/30 px-2 py-1 text-amber-100 hover:bg-amber-300/10"
                            >เติมชื่อเพื่อทบทวน</button>
                          </div>
                        )}
                        <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-slate-300">จำนวนเงิน {record.amount !== null ? `฿${record.amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "อ่านไม่ได้"}</span>
                          <button type="button" onClick={() => openSlipSourcePage(record)} className="shrink-0 text-sky-300 underline">เปิดหน้าพร้อมชี้ตำแหน่ง</button>
                        </div>
                        <div className="mt-0.5 text-[9px] text-slate-500">
                                {record.source} · หน้าแชท {record.chatPage} · หน้าแฟ้ม PDF {record.dossierPage ?? "ไม่มีข้อมูล"}
                          {record.bounds ? ` · ตำแหน่ง ${record.bounds.x}, ${record.bounds.y}` : ""}
                        </div>
                        {record.data.raw_text?.length || record.ocrDiagnosticTrace ? (
                          <details className="mt-1 text-[9px] text-slate-400">
                            <summary className="cursor-pointer text-sky-300">หลักฐาน OCR ของ candidate · ข้อความ OCR ทั้งหมดและที่มา</summary>
                            <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{(record.data.raw_text || []).join("\n")}</pre>
                            {record.ocrTextBoxes?.length ? (
                              <div className="mt-1 border-t border-white/10 pt-1 font-mono">
                                {record.ocrTextBoxes.map((box, boxIndex) => (
                                  <div key={`${record.id}-ocr-${boxIndex}`}>
                                    [{box.classification === "slip_evidence" ? "อยู่ในสลิป" : box.classification === "chat_context" ? "บริบทแชท" : box.classification === "uncertain" ? "ไม่แน่ชัด" : "ไม่มีป้ายกำกับ"}] {box.text} · ({box.bounds.x}, {box.bounds.y}, {box.bounds.width}, {box.bounds.height}) · {Math.round(box.confidence * 100)}% · {box.reason || "ไม่มีเหตุผลกำกับ"}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {record.ocrDiagnosticTrace ? (
                              <div className="mt-2 border-t border-cyan-300/20 pt-2">
                                <div className="font-semibold text-cyan-200">Trace OCR · {record.ocrDiagnosticTrace.sourceDimensions.width}×{record.ocrDiagnosticTrace.sourceDimensions.height}</div>
                                <div>QR {record.ocrDiagnosticTrace.qrBounds.length} · วัตถุ {record.ocrDiagnosticTrace.objectBounds.length} · OCR attempts {record.ocrDiagnosticTrace.attempts.length} · parsed regions {record.ocrDiagnosticTrace.regions.length}</div>
                                {record.ocrDiagnosticTrace.attempts.map((attempt) => (
                                  <div key={`${record.id}-${attempt.id}`} className="mt-1 border-l border-cyan-300/30 pl-2">
                                    {attempt.scope}/{attempt.trigger} · confidence {Math.round(attempt.meanConfidence)}% · {attempt.lines.length} lines
                                    {attempt.lines.filter((line) => /8\s*,?\s*000(?:\.00)?|แปดพัน|จิณห์|ประสาท|ณัฐชัย|สุวิชัย/u.test(line.text)).map((line) => (
                                      <div key={line.id} className="break-words">{line.text} · ({Math.round(line.bounds.x)}, {Math.round(line.bounds.y)}, {Math.round(line.bounds.width)}, {Math.round(line.bounds.height)}) · {Math.round(line.confidence)}%</div>
                                    ))}
                                  </div>
                                ))}
                                {record.ocrDiagnosticTrace.regions.map((region, index) => (
                                  <div key={`${record.id}-region-${index}`} className="mt-1">
                                    Region {index + 1} · {region.acceptedByCandidatePolicy ? "รวมเป็น candidate" : "ถูก policy filter ตัดออก"} · ยอด {region.amount ?? "ไม่พบ"} · ผู้โอน {region.senderName || "ไม่พบ"} · ผู้รับ {region.receiverName || "ไม่พบ"} · {region.reason}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-white/10 pt-2 text-[10px] font-semibold text-slate-300">
                  รายชื่อบุคคลที่เลือกตรวจรายการ
                </div>
                {targetList.length === 0 ? (
                  <div className="p-3 text-center text-slate-400 text-[11px] italic bg-black/20 rounded-lg border border-dashed border-white/10">
                    ยังไม่มีรายชื่อบุคคลที่เลือกหรือเพิ่มด้วยตนเอง
                  </div>
                ) : (
                  <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
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
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-semibold text-slate-100 truncate">
                                {item.cleanName}
                              </div>
                              {item.totalAmount && item.totalAmount > 0 ? (
                                <span className="text-[11px] text-emerald-400 font-mono font-bold shrink-0 ml-2">
                                  ฿{item.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-[10px] text-sky-400 font-mono mt-0.5">
                              ผู้รับโอน
                            </div>
                          </div>
                        </div>

                        <div className="ml-1 flex shrink-0 items-center gap-1">
                          <button type="button" onClick={() => void handleExportTargetLedger(item)} className="rounded px-1.5 py-1 text-[10px] text-emerald-300 hover:bg-emerald-400/10" title={`ส่งออก Excel เฉพาะ ${item.cleanName}`} aria-label={`ส่งออก Excel เฉพาะ ${item.cleanName}`}>XLS</button>
                          <button type="button" onClick={() => void handleExportTargetPdf(item)} className="rounded px-1.5 py-1 text-[10px] text-sky-300 hover:bg-sky-400/10" title={`ส่งออก PDF เฉพาะ ${item.cleanName}`} aria-label={`ส่งออก PDF เฉพาะ ${item.cleanName}`}>PDF</button>
                          <button
                            type="button"
                            onClick={() => removeTargetPerson(item.id)}
                            className="rounded px-1.5 py-1 text-xs text-slate-500 transition-colors hover:bg-white/5 hover:text-red-400"
                            title="นำบุคคลนี้ออกจากรายการ"
                            aria-label={`นำ ${item.cleanName} ออกจากรายการ`}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {targetDossierStatus && <p role="status" className="text-[10px] text-sky-200">{targetDossierStatus}</p>}

                {/* Quick Add Custom Name */}
                <div className="flex items-center gap-1.5 mt-1 border-t border-white/10 pt-2">
                  <input
                    type="text"
                    placeholder="พิมพ์ชื่อเพื่อเพิ่มเอง (เช่น นายวิชัย ใจดี)"
                    className="flex-1 bg-black/30 border border-white/10 rounded-lg px-2.5 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-sky-400/60"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) {
                          addTargetPerson(val);
                          (e.target as HTMLInputElement).value = "";
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                      if (input && input.value.trim()) {
                        addTargetPerson(input.value.trim());
                        input.value = "";
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-sky-600/40 hover:bg-sky-600/70 text-sky-100 text-[10.5px] font-bold border border-sky-400/40 transition-colors"
                  >
                    + เพิ่ม
                  </button>
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
                🗂️ หน้าปกแฟ้มหลักฐาน
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
              <div className="flex flex-col items-center gap-2 h-full justify-center">
                <canvas
                  ref={canvasRef}
                  className="max-h-[calc(100%-36px)] max-w-full rounded shadow-2xl"
                  style={{
                    aspectRatio: "1 / 1.4159",
                    height: "auto",
                    width: "auto",
                  }}
                />

                {/* Multi-Page Controls (SSOT Synchronized with Header Ribbon) */}
                {stagedQueue.length > 0 && totalPages > 1 && (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/90 border border-sky-400/30 text-xs shadow-lg shrink-0">
                    <button
                      type="button"
                      disabled={currentGlobalPage <= 1}
                      onClick={goToPrevPage}
                      className="px-2 py-0.5 rounded text-sky-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent font-bold transition-all"
                    >
                      ◀ ก่อนหน้า
                    </button>
                    <span className="font-mono text-sky-400 font-semibold px-2">
                      {stagedQueue[selectedItemIndex]?.category === "CHAT"
                        ? "หน้าแชท"
                        : stagedQueue[selectedItemIndex]?.category === "SLIP"
                          ? "หน้าสลิป"
                          : "หน้าหลักฐาน"} {currentGlobalPage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={currentGlobalPage >= totalPages}
                      onClick={goToNextPage}
                      className="px-2 py-0.5 rounded text-sky-300 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent font-bold transition-all"
                    >
                      ถัดไป ▶
                    </button>
                  </div>
                )}
                {stagedQueue[selectedItemIndex]?.category === "CHAT"
                  && stagedQueue[selectedItemIndex]?.chatEvidenceLayers?.[selectedSliceIndex] && (
                  <div className="w-full max-w-[807px] shrink-0">
                    <button
                      type="button"
                      aria-expanded={showEvidenceLayers}
                      onClick={() => setShowEvidenceLayers((open) => !open)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded border border-sky-400/30 bg-slate-900/90 text-left text-[11px] text-sky-200"
                    >
                      <span>ชั้นหลักฐาน OCR: วัตถุ {stagedQueue[selectedItemIndex].chatEvidenceLayers![selectedSliceIndex].layer1.length} · ข้อความ {stagedQueue[selectedItemIndex].chatEvidenceLayers![selectedSliceIndex].layer2.length}</span>
                      <span>{showEvidenceLayers ? "ซ่อน" : "ตรวจทาน"}</span>
                    </button>
                    {showEvidenceLayers && (() => {
                      const pageLayers = stagedQueue[selectedItemIndex].chatEvidenceLayers![selectedSliceIndex];
                      return (
                        <div className="mt-1 max-h-44 overflow-y-auto rounded border border-white/10 bg-slate-950/95 p-2 text-[10px] text-slate-200">
                          <p className="mb-2 text-amber-300">{pageLayers.warnings.join(" · ")}</p>
                          {pageLayers.ocrDiagnosticTrace ? (
                            <section className="mb-2 border-t border-cyan-300/20 pt-2" aria-label="Trace OCR ของหน้าต้นฉบับ">
                              <div className="font-semibold text-cyan-200">Trace OCR · source {pageLayers.ocrDiagnosticTrace.sourceDimensions.width}×{pageLayers.ocrDiagnosticTrace.sourceDimensions.height}</div>
                              <div>1 pixels: {pageLayers.ocrDiagnosticTrace.sourceDimensions.width}×{pageLayers.ocrDiagnosticTrace.sourceDimensions.height} · 2 preprocess: ใช้ภาพที่ส่งเข้า OCR ตามขนาด attempt · 3 detect: QR {pageLayers.ocrDiagnosticTrace.qrBounds.length}, objects {pageLayers.ocrDiagnosticTrace.objectBounds.length} · 4 recognize: {pageLayers.ocrDiagnosticTrace.attempts.length} attempts · 5 context: {pageLayers.ocrDiagnosticTrace.regions.length} parsed regions · 6 structure: {pageLayers.ocrDiagnosticTrace.regions.filter((region) => region.acceptedByCandidatePolicy).length} candidate regions</div>
                              <div>QR {pageLayers.ocrDiagnosticTrace.qrBounds.length} · วัตถุ {pageLayers.ocrDiagnosticTrace.objectBounds.length} · attempts {pageLayers.ocrDiagnosticTrace.attempts.length} · regions {pageLayers.ocrDiagnosticTrace.regions.length}</div>
                              {pageLayers.qrScanDiagnostic && (
                                <div data-testid="qr-scan-pixel-diagnostic">QR pixels {pageLayers.qrScanDiagnostic.inputWidth}×{pageLayers.qrScanDiagnostic.inputHeight} · fingerprint {pageLayers.qrScanDiagnostic.pixelFingerprint} · production scale {pageLayers.qrScanDiagnostic.productionUpscale} · enhancement {pageLayers.qrScanDiagnostic.enhancement?.attempted ? `${pageLayers.qrScanDiagnostic.enhancement.decoded ? "decoded" : "miss"} (${pageLayers.qrScanDiagnostic.enhancement.stages.join(" → ")})` : "not attempted"} · {pageLayers.qrScanDiagnostic.scans.map((scan) => `${scan.decoder}${scan.region ? ` tile(${scan.region.x},${scan.region.y},${scan.region.width}×${scan.region.height})@` : ""} ${scan.scale}x:${scan.decoded ? "decoded" : "miss"}`).join(", ")}</div>
                              )}
                              {pageLayers.ocrDiagnosticTrace.contourAudit && (
                                <details className="mt-1 rounded border border-amber-300/20 bg-black/20 p-1" open>
                                  <summary className="cursor-pointer text-amber-200">Contour audit · gray {pageLayers.ocrDiagnosticTrace.contourAudit.grayscale.totalContours}/{pageLayers.ocrDiagnosticTrace.contourAudit.grayscale.keptCount} kept · color {pageLayers.ocrDiagnosticTrace.contourAudit.color.totalContours}/{pageLayers.ocrDiagnosticTrace.contourAudit.color.keptCount} kept · merged {pageLayers.ocrDiagnosticTrace.contourAudit.mergedColorCount} · added {pageLayers.ocrDiagnosticTrace.contourAudit.colorOnlyCount}</summary>
                                  <div>Kernel {pageLayers.ocrDiagnosticTrace.contourAudit.morphologyKernel.width}×{pageLayers.ocrDiagnosticTrace.contourAudit.morphologyKernel.height} · adaptive block {pageLayers.ocrDiagnosticTrace.contourAudit.adaptiveThresholdBlockSize} · final objects {pageLayers.ocrDiagnosticTrace.contourAudit.finalCandidateCount}</div>
                                  {(["grayscale", "color"] as const).map((maskName) => {
                                    const audit = pageLayers.ocrDiagnosticTrace!.contourAudit![maskName];
                                    return (
                                      <div key={`contour-audit-${maskName}`} className="mt-1">
                                        <div>{maskName} rejects: {Object.entries(audit.rejectedByReason).map(([reason, count]) => `${reason}=${count}`).join(" · ") || "none"}</div>
                                        {audit.rejectedSamples.map((sample, index) => (
                                          <div key={`${maskName}-rejected-${index}`} className="text-amber-100/80">
                                            {maskName} rejected ({sample.bounds.x},{sample.bounds.y} {sample.bounds.width}×{sample.bounds.height}) · area {sample.pageAreaRatio} page · OCR line {sample.relatedLineIndex ?? "none"} · {sample.reason}
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  })}
                                  {pageLayers.ocrDiagnosticTrace.maskPreviews && (
                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                      {(["grayscale", "color"] as const).map((maskName) => {
                                        const src = pageLayers.ocrDiagnosticTrace!.maskPreviews?.[maskName];
                                        return src ? <figure key={`mask-preview-${maskName}`}><figcaption>{maskName} closed mask</figcaption><img src={src} alt={`${maskName} OpenCV contour mask`} className="max-h-44 max-w-full border border-white/20 object-contain" /></figure> : null;
                                      })}
                                    </div>
                                  )}
                                </details>
                              )}
                              {(pageLayers.ocrDiagnosticTrace.parserRejectionReasons?.length
                                ? pageLayers.ocrDiagnosticTrace.parserRejectionReasons
                                : explainSlipOcrRegionRejection({
                                    lines: pageLayers.ocrDiagnosticTrace.attempts.filter((attempt) => attempt.scope === "full_page").at(-1)?.lines || [],
                                    qrCount: pageLayers.ocrDiagnosticTrace.qrBounds.length,
                                    regionCount: pageLayers.ocrDiagnosticTrace.regions.length,
                                  })).map((reason, index) => (
                                <div key={`parser-rejection-${index}`} className="mt-1 text-amber-200">Parser decision: {reason}</div>
                              ))}
                              {pageLayers.ocrDiagnosticTrace.attempts.map((attempt) => (
                                <div key={attempt.id} className="mt-1 border-l border-cyan-300/30 pl-2">
                                  {attempt.scope}/{attempt.trigger} · confidence {Math.round(attempt.meanConfidence)}% · {attempt.lines.length} lines
                                  {attempt.lines.map((line) => (
                                    <div key={line.id} className="break-words text-slate-100">{line.text} · ({Math.round(line.bounds.x)}, {Math.round(line.bounds.y)}, {Math.round(line.bounds.width)}, {Math.round(line.bounds.height)}) · {Math.round(line.confidence)}%</div>
                                  ))}
                                </div>
                              ))}
                              {pageLayers.ocrDiagnosticTrace.regions.map((region, index) => (
                                <div key={`trace-region-${index}`} className="mt-1">Region {index + 1} · {region.acceptedByCandidatePolicy ? "included" : "filtered"} · amount {region.amount ?? "missing"} · sender {region.senderName || "missing"} · receiver {region.receiverName || "missing"} · {region.reason}</div>
                              ))}
                            </section>
                          ) : <p className="text-amber-200">หน้านี้ไม่มี trace OCR (อาจไม่มี QR candidate หรือ OCR หยุดก่อนสร้าง trace)</p>}
                          <div role="group" aria-label="เลือกชั้นหลักฐาน" className="mb-2 flex gap-1">
                            <button
                              type="button"
                              aria-pressed={evidenceLayerView === "LAYER_1"}
                              onClick={() => setEvidenceLayerView("LAYER_1")}
                              className={`flex-1 rounded border px-2 py-1 text-left ${evidenceLayerView === "LAYER_1" ? "border-sky-400/50 bg-sky-500/15 text-sky-100" : "border-white/10 text-slate-400"}`}
                            >
                              Layer 1 · วัตถุ {pageLayers.layer1.length}
                            </button>
                            <button
                              type="button"
                              aria-pressed={evidenceLayerView === "LAYER_2"}
                              onClick={() => setEvidenceLayerView("LAYER_2")}
                              className={`flex-1 rounded border px-2 py-1 text-left ${evidenceLayerView === "LAYER_2" ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100" : "border-white/10 text-slate-400"}`}
                            >
                              Layer 2 · OCR {pageLayers.layer2.length}
                            </button>
                          </div>
                          {evidenceLayerView === "LAYER_2" ? (
                            <div>
                              <div className="mb-1 font-semibold text-emerald-300">Layer 2 · OCR glyph/word boxes · ตรวจทาน</div>
                              {(() => {
                                const renderedSourceLines = new Set<string>();
                                return pageLayers.layer2.map((line, index) => {
                                  const reviewItem = formatLayer2ReviewItem(line);
                                  const sourceLineKey = reviewItem.sourceLineText === undefined
                                    ? null
                                    : `${line.groupId}-${line.sourceLineIndex ?? reviewItem.sourceLineText}`;
                                  const showSourceLine = sourceLineKey !== null && !renderedSourceLines.has(sourceLineKey);
                                  if (sourceLineKey) renderedSourceLines.add(sourceLineKey);
                                  return (
                                    <div key={`${line.groupId}-${line.unit}-${index}`} className="border-t border-white/10 py-1.5">
                                      <div className="font-semibold text-emerald-200">{reviewItem.label}</div>
                                      <div className="break-words text-slate-100">{reviewItem.text}</div>
                                      {showSourceLine && <div className="break-words text-amber-200">ข้อความ OCR ทั้งบรรทัด: {reviewItem.sourceLineText}</div>}
                                      <div className="font-mono text-slate-400">{reviewItem.boundsLabel} · {reviewItem.streamBoundsLabel}</div>
                                      {line.sourceReferences.map((source, sourceIndex) => (
                                        <div key={`${source.sourceItemId}-${sourceIndex}`} className="font-mono text-slate-500">
                                          {source.fileName} · SHA-256 {source.sha256.slice(0, 12)}… · ต้นฉบับ {source.bounds.x},{source.bounds.y} {source.bounds.width}×{source.bounds.height}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                });
                              })()}
                              {pageLayers.layer2.length === 0 && <p className="text-slate-400">หน้านี้ไม่มี OCR glyph/word boxes</p>}
                            </div>
                          ) : (
                            <div>
                              <div className="mb-1 font-semibold text-sky-300">Layer 1 · object / message candidates · ตรวจทาน</div>
                              {pageLayers.layer1.map((object) => {
                                const linkedGroups = [object.id, object.relatedTextGroupId].filter((id): id is string => Boolean(id));
                                return (
                                  <div key={object.id} className="border-t border-white/10 py-1.5">
                                    <div className="font-semibold text-sky-300">{object.kind} · {Math.round(object.confidence * 100)}% · ตรวจทาน</div>
                                    {object.label && <div className="text-amber-200">{object.label}</div>}
                                    {object.objectTypeCandidate && <div className="text-slate-400">Semantic heuristic · {object.objectTypeCandidate} · {object.semanticRationale || "จัดประเภทจากตำแหน่งและลักษณะกรอบ"}</div>}
                                    {object.detectionMethod && <div className="text-slate-500">วิธีตรวจจับ: {object.detectionMethod}{object.supportingDetectionMethods?.length ? ` + ${object.supportingDetectionMethods.filter((method) => method !== object.detectionMethod).join(" + ")}` : ""} · mask foreground {object.foregroundRatio === undefined ? "-" : `${(object.foregroundRatio * 100).toFixed(1)}%`}</div>}
                                    <div className="font-mono text-slate-400">กรอบหน้า: {object.bounds.x},{object.bounds.y} {object.bounds.width}×{object.bounds.height}</div>
                                    <div>{pageLayers.layer2.filter((line) => linkedGroups.includes(line.groupId)).map((line) => line.text).join(" / ") || "ไม่มีข้อความ OCR ในกรอบนี้"}</div>
                                    {object.sourceReferences.map((source) => (
                                      <div key={`${source.sourceItemId}-${source.bounds.x}-${source.bounds.y}`} className="font-mono text-slate-500">
                                        {source.fileName} · OCR เวลาเหตุการณ์ {source.eventTime || "ไม่มี"} · EXIF {source.captureTime || "ไม่มี"} · SHA-256 {source.sha256.slice(0, 12)}… · ต้นฉบับ {source.bounds.x},{source.bounds.y}
                                        {source.sourceTrim && ` · ตัด UI บน/ล่าง ${source.sourceTrim.top}/${source.sourceTrim.bottom}px (${source.sourceTrim.topMethod}: ${source.sourceTrim.topEvidence || "-"} / ${source.sourceTrim.bottomMethod}: ${source.sourceTrim.bottomEvidence || "-"})`}
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                              {pageLayers.layer1.length === 0 && <p className="text-slate-400">หน้านี้ไม่มีข้อความที่ OCR สร้างกรอบได้</p>}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
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
              03 สรุปข้อมูลตรวจสอบ
            </h2>
            <span className="badge-proportional glass-badge text-emerald-400 font-mono">
              LEDGER REVIEW
            </span>
          </div>

          <div className="panel-scroll-body thai-clearance-stack pr-1 flex flex-col gap-3">
            {/* =================================================================
                LAYER 1: 4 KPI CARDS (2x2 Grid)
                1. ยอดเงินรวมที่ตรวจพบ
                2. ยอดรายการของบุคคลที่เกี่ยวข้อง
                3. แชทและสลิปที่สัมพันธ์
                4. สรุปหน้าที่ซ้ำกันทั้ง
                ================================================================= */}
            <div className="grid grid-cols-2 gap-2">
              {/* Card 1: ยอดเงินรวมที่ตรวจพบ */}
              <div className="glass-card p-3 rounded-xl flex flex-col justify-between border border-white/10 hover:border-emerald-400/40 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-300">
                    1. ยอดรวมรายการที่ยืนยัน (ก่อนตรวจ Ref ซ้ำ)
                  </span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]"></span>
                </div>
                <div className="font-mono text-base font-bold text-emerald-400 mt-1 truncate">
                  {amountDisplay}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                  <span>ยืนยัน {evidenceState.slipCount} / พบ {ledgerReconciliation.detectedCount}</span>
                  <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.5 rounded border border-emerald-500/20">
                    GROSS
                  </span>
                </div>
              </div>

              {/* Card 2: ยอดรายการของบุคคลที่เกี่ยวข้อง */}
              <div className="glass-card p-3 rounded-xl flex flex-col justify-between border border-white/10 hover:border-sky-400/40 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-300">
                    2. ยอดรายการของบุคคลที่เกี่ยวข้อง
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
                    3. สัญญาณแชท–สลิป
                  </span>
                  <span className="w-2 h-2 rounded-full bg-teal-400 shadow-[0_0_8px_#2dd4bf]"></span>
                </div>
                <div className="font-mono text-base font-bold text-teal-300 mt-1">
                  {chatSlipCorroborationCandidates.length} candidate
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                  <span>OCR พบ · รอตรวจ ไม่ยืนยันอัตโนมัติ</span>
                  <span className="text-[9px] font-mono text-teal-400 bg-teal-500/10 px-1 py-0.5 rounded border border-teal-500/20">
                    PAIRS
                  </span>
                </div>
              </div>

              {/* Card 4: 4. สรุปหน้าที่ซ้ำกันทั้ง */}
              <div className="glass-card p-3 rounded-xl flex flex-col justify-between border border-white/10 hover:border-amber-400/40 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-300">
                    4. Ref ID ตรงกัน
                  </span>
                  <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]"></span>
                </div>
                <div className="font-mono text-base font-bold text-amber-400 mt-1">
                  {evidenceState.duplicateCount} จุด
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                    <span>เลขอ้างอิงตรงกัน · ไม่ตัดยอดอัตโนมัติ</span>
                  <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 px-1 py-0.5 rounded border border-amber-500/20">
                    REF CHECK
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
                  : "อัปเดตข้อกฎหมายได้เมื่อผู้ใช้ต้องการอัปเดตเอง"}
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
                  13 คอลัมน์ ↗
                </span>
              </button>

              <button
                onClick={() => setLinkageModalOpen(true)}
                className="btn-proportional-primary glass-button w-full justify-between items-center text-xs py-2 px-3 rounded-lg border border-emerald-400/30 hover:border-emerald-400/60 bg-emerald-950/25 hover:bg-emerald-900/35 transition-all shadow-sm text-left group"
                title="แสดงข้อเสนอการเชื่อมโยงจาก OCR ระหว่างหน้าแชทกับรายการสลิป เพื่อให้ตรวจทาน"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm shrink-0 group-hover:scale-110 transition-transform">🔗</span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-emerald-300 truncate">ตรวจสอบความเชื่อมโยง</span>
                    <span className="text-[9.5px] text-slate-400 leading-tight truncate">
                      (ข้อเสนอจาก OCR · รอตรวจทานก่อนยืนยัน)
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/20 px-1.5 py-0.5 rounded border border-emerald-400/30 shrink-0 ml-1">
                  Linkage ↗
                </span>
              </button>
            </div>

            {/* =================================================================
                LAYER 4: เครื่องมือจัดทำเอกสารประกอบหลักฐาน (SSOT Aligned)
                ================================================================= */}
            <div className="glass-nested p-3 rounded-xl flex flex-col gap-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                เครื่องมือจัดทำเอกสารประกอบหลักฐาน
              </span>
              <button
                onClick={() => setCenterView("COVER_PAGE")}
                className="btn-proportional-primary glass-button glass-button-cyan w-full min-w-0 justify-start whitespace-normal break-words text-[11px] leading-tight py-2"
              >
                🗂️ หน้าปกแฟ้มหลักฐาน (Cover Page)
              </button>
              <button
                onClick={() => setCenterView("HASH_MANIFEST")}
                className="btn-proportional-primary glass-button w-full min-w-0 justify-start whitespace-normal break-words text-[11px] leading-tight py-2"
              >
                บัญชีคุมลายนิ้วมือดิจิทัล
              </button>
              <button
                onClick={() => setCenterView("EXECUTIVE_SUMMARY")}
                className="btn-proportional-primary glass-button w-full min-w-0 justify-start whitespace-normal break-words text-[11px] leading-tight py-2"
              >
                สรุปข้อมูลและเส้นทางการเงิน
              </button>
              <button
                onClick={() => setLegalContextModalOpen(true)}
                className="btn-proportional-primary glass-button w-full min-w-0 justify-start whitespace-normal break-words text-[11px] leading-tight py-2 border-indigo-400/30 hover:border-indigo-400/60 bg-indigo-950/20 text-indigo-200 hover:text-white transition-all"
              >
                📜 รายการกฎหมายที่อาจเกี่ยวข้อง (เบื้องต้น)
              </button>
              <button
                onClick={() => setFullBookOpen(true)}
                className="btn-proportional-primary glass-button glass-button-cyan w-full min-w-0 justify-start whitespace-normal break-words text-[11px] leading-tight py-2"
              >
                📚 รวมเล่มเอกสารประกอบหลักฐาน (Master PDF)
              </button>
            </div>

            {/* =================================================================
                LAYER 5: รหัสผ่านร่วมสำหรับ PDF และ SFX
                ================================================================= */}
            <div className="glass-nested p-3 rounded-xl thai-clearance-stack">
              <div className="flex items-center justify-between">
                <span className="typo-label min-w-0 whitespace-nowrap font-bold text-slate-200 text-[10px]">
                  🔑 รหัสผ่าน PDF และ SFX
                </span>
                {exportPassword.trim() ? (
                  <span className="text-[10px] text-amber-300 font-mono font-semibold flex items-center gap-1 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                    PASSWORD SET
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-400 font-mono font-semibold flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
                    NO PASSWORD SET
                  </span>
                )}
              </div>
              <input
                type="password"
                placeholder="รหัสเดียวสำหรับ PDF และ SFX (เว้นว่าง = ไม่ตั้งรหัส)"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
                className="input-proportional glass-input font-mono text-xs py-1.5"
              />
              <div className="text-[10px] text-slate-400 leading-tight">
                {exportPassword.trim() ? (
                  <span className="text-amber-300">
                    PDF และ SFX ที่ส่งออกจะใช้รหัสนี้ร่วมกัน
                  </span>
                ) : (
                  <span>
                    ถ้าเว้นว่าง ไฟล์ PDF และ SFX จะไม่ตั้งรหัสผ่าน
                  </span>
                )}
              </div>
            </div>

            {/* =================================================================
                LAYER 6: 2 ปุ่มเพิ่มเติม
                - PDF และ SFX สร้างผ่านตัวส่งออกจริง
                ================================================================= */}
            <div className="flex flex-col gap-2 pt-1 pb-1">
              <button
                type="button"
                onClick={() => void handleCreateDerivedImagePdf()}
                disabled={exportingArtifact !== null || !stagedQueue[selectedItemIndex]}
                title="สร้าง PDF เพื่อการดูภาพเท่านั้น ไม่ใช่ภาพต้นฉบับหรือ OCR evidence"
                className="w-full py-2 px-3.5 rounded-lg font-bold text-[11px] flex items-center justify-center gap-2 border border-amber-400/30 bg-amber-950/30 text-amber-200 hover:bg-amber-900/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden="true">✨</span>
                <span>{exportingArtifact === "DERIVED" ? "กำลังสร้างภาพอนุพันธ์..." : `สร้าง PDF ภาพอนุพันธ์จากไฟล์ที่เลือก${stagedQueue[selectedItemIndex] ? ` · ${stagedQueue[selectedItemIndex].file.name}` : ""}`}</span>
              </button>
              <button
                onClick={handleExportPdf}
                disabled={exportingArtifact !== null}
                className="w-full py-2.5 px-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md bg-gradient-to-r from-emerald-600 to-sky-600 text-white hover:from-emerald-500 hover:to-sky-500 hover:scale-[1.01] border border-white/20 active:scale-[0.99] group"
              >
                <span className="text-base group-hover:scale-110 transition-transform">📥</span>
                <span className="leading-tight">{exportingArtifact === "PDF" ? "กำลังสร้าง PDF..." : "PDF"}</span>
              </button>

              <button
                onClick={() => setSfxModalOpen(true)}
                disabled={exportingArtifact !== null}
                className="w-full py-2.5 px-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 text-sky-200 hover:text-white hover:border-sky-400/60 hover:scale-[1.01] border border-blue-500/40 active:scale-[0.99] group"
              >
                <span className="text-base group-hover:scale-110 transition-transform">📦</span>
                <span className="leading-tight">SFX</span>
              </button>
            </div>
            {exportStatus && (
              <div role="status" className={`text-[10px] leading-relaxed px-2 ${exportStatus.type === "error" ? "text-rose-300" : "text-emerald-300"}`}>
                {exportStatus.message}
              </div>
            )}
            {searchSlipScanStatus.state !== "idle" && (
              <section
                role="status"
                aria-label="ผลการค้นหาสลิปใน PDF"
                className={`rounded-lg border px-2.5 py-2 text-[10px] ${
                  searchSlipScanStatus.state === "error"
                    ? "border-rose-400/30 bg-rose-950/30 text-rose-200"
                    : searchSlipScanStatus.state === "complete"
                      ? "border-emerald-400/25 bg-emerald-950/20 text-emerald-200"
                      : "border-sky-400/25 bg-sky-950/20 text-sky-200"
                }`}
              >
                <p>{searchSlipScanStatus.message}</p>
                {searchSlipScanStatus.state === "complete" && searchSlipScanCandidates.length > 0 && (
                  <>
                    <p className="mt-1 text-slate-400">OCR candidate เป็นข้อมูลรอตรวจทาน ไม่ยืนยันธุรกรรมและไม่รวมยอด</p>
                    <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1 text-slate-200">
                      {searchSlipScanCandidates.map((candidate) => (
                        <li key={candidate.occurrence_id} className="rounded border border-white/10 bg-black/20 p-2">
                          <p className="font-semibold text-sky-200">
                            PDF หน้า {candidate.pages.join(", ")} · ฿{candidate.amount || "ไม่พบยอด"}
                          </p>
                          <p className="mt-0.5 text-slate-300">
                            {candidate.datetime || "ไม่พบวันเวลา"} · {candidate.sender_bank || "ไม่พบธนาคาร"} · Ref {candidate.ref_id || "ไม่พบ"}
                          </p>
                          <p className="mt-0.5">ผู้โอน: {candidate.sender_name || "ไม่พบ/รอตรวจทาน"}</p>
                          <p>ผู้รับ: {candidate.receiver_name || "ไม่พบ/รอตรวจทาน"} · {candidate.receiver_bank || "ไม่พบธนาคาร"}</p>
                          {candidate.memo && candidate.memo !== "-" && <p className="mt-0.5 text-slate-400">บันทึก: {candidate.memo}</p>}
                          {candidate.repeated_ref && (
                            <p className="mt-1 text-amber-300">Ref ซ้ำ แต่เก็บ occurrence นี้แยกไว้ตรวจทาน ({candidate.occurrence_id})</p>
                          )}
                          <p className="mt-1 text-amber-200">{candidate.review_status}</p>
                          <details className="mt-1.5">
                            <summary className="cursor-pointer text-sky-300">อ่านข้อความ OCR ต้นทาง</summary>
                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-[9px] text-slate-300">
                              {candidate.raw_text || "ไม่มีข้อความ OCR ที่บันทึกไว้"}
                            </pre>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
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
                    <span className="text-xs text-slate-400">ผู้รับโอนที่ตรวจพบ (ปลายทาง)</span>
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
                  ตรวจข้อมูลแล้ว พร้อมจัดเก็บในแฟ้มหลักฐาน
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
                    ✓ ยืนยันข้อมูลในรายการตรวจ
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
        <ModeProvider>
          <MasterDossierFullBook
            coverData={coverSheetData}
            evidenceState={evidenceState}
            extractedSlip={extractedData}
            previewImage={previewImage}
            stagedItems={stagedQueue}
            manifestEntries={manifestList}
            caseNumber={caseNumber}
            suspectName={targetName}
            exportPassword={exportPassword}
            onClose={() => setFullBookOpen(false)}
          />
        </ModeProvider>
      )}

      {/* =====================================================================
          โมดูลที่ 2: ตารางสรุปรายการหลักฐาน (13 คอลัมน์ แนวนอน)
          ===================================================================== */}
      {ledgerModalOpen && (
        <div className="absolute inset-0 glass-modal-backdrop z-50 flex items-center justify-center p-4">
          <div className="glass-modal w-full max-w-[calc(100vw-2rem)] max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border border-sky-400/30">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-sky-950/40">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">📋</span>
                <div>
                  <h3 className="font-bold text-sm text-slate-100">
                    ตารางสรุปรายการทางการเงินที่ตรวจพบ (13 คอลัมน์)
                  </h3>
                  <span className="text-[11px] text-sky-400 font-mono">
                    เลขอ้างอิงเรื่อง: {caseNumber || "012/2569"} | บุคคลที่เกี่ยวข้อง: {targetName || "ยังไม่มีข้อมูล"}
                  </span>
                  <span className="block text-[10px] text-amber-200">
                    สัญญาณซ้ำเพื่อทบทวน: {duplicateAuditMatrix.summary.duplicateOccurrenceCount}/{duplicateAuditMatrix.summary.totalOccurrenceCount} รายการ · ไม่พบสัญญาณ {duplicateAuditMatrix.summary.withoutDuplicateSignalCount} · หน้าที่เกี่ยวข้อง {duplicateAuditMatrix.summary.affectedPageCount}
                    {duplicateAuditMatrix.summary.affectedPages.length > 0 ? ` (${duplicateAuditMatrix.summary.affectedPages.join(", ")})` : " · ไม่ใช่ข้อยืนยันว่าไม่มีรายการซ้ำ"}
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
              {reviewedDuplicateSummary.groups.length > 0 && (
                <section aria-label="กลุ่มรหัสอ้างอิงซ้ำเพื่อทบทวน" className="mb-3 rounded border border-amber-400/30 bg-amber-950/20 p-3">
                  <h4 className="text-xs font-bold text-amber-200">กลุ่ม Ref ID ซ้ำในรายการที่ยืนยันแล้ว · ต้องตรวจหลักฐานก่อนสรุป</h4>
                  <div className="mt-2 space-y-2">
                    {reviewedDuplicateSummary.groups.map((group) => {
                      const selectedMasterId = duplicateMasterSelections[group.referenceNo] || "";
                      const selectedMaster = ledgerRecords.find((record) => record.id === group.masterOccurrenceId);
                      const savedDecision = duplicateReferenceResolutions[group.referenceNo];
                      const statusText = group.disposition === "duplicate"
                        ? `ผู้ตรวจระบุว่าสำเนา · master: ${selectedMaster?.source || "ไม่พบรายการ"} · หักเฉพาะ NET ฿ ${group.excludedAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`
                        : group.disposition === "distinct"
                          ? "ผู้ตรวจยืนยันว่าเป็นคนละธุรกรรม · ไม่หักยอด"
                          : "ยังไม่วินิจฉัยหรือสมาชิกกลุ่มเปลี่ยน · ไม่หักยอด";
                      return (
                        <div key={group.referenceNo} className="rounded border border-white/10 bg-slate-950/40 p-2 text-[11px] text-slate-200">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-mono">{group.referenceNo}</span>
                            <span>{group.occurrenceCount} occurrences · Gross ฿ {group.grossAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                            <span className={group.disposition === "unresolved" ? "text-amber-200" : "text-emerald-300"}>{statusText}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {group.occurrenceIds.map((id, index) => {
                              const occurrence = ledgerRecords.find((record) => record.id === id);
                              return occurrence ? (
                                <a key={id} href={occurrence.crop} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                                  หลักฐาน {index + 1}: {occurrence.source} · แชท {occurrence.chatPage} · PDF {occurrence.dossierPage ?? "ยังไม่มี"}
                                </a>
                              ) : null;
                            })}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-2 text-slate-300">
                              เลือกรายการต้นฉบับ
                              <select
                                aria-label={`เลือกรายการต้นฉบับสำหรับ Ref ${group.referenceNo}`}
                                value={selectedMasterId}
                                onChange={(event) => setDuplicateMasterSelections((current) => ({ ...current, [group.referenceNo]: event.target.value }))}
                                className="min-w-48 rounded border border-white/20 bg-slate-900 px-2 py-1 text-slate-100"
                              >
                                <option value="">เลือกจากหลักฐานในกลุ่ม</option>
                                {group.occurrenceIds.map((id, index) => {
                                  const occurrence = ledgerRecords.find((record) => record.id === id);
                                  return occurrence ? <option key={id} value={id}>{index + 1} · {occurrence.source} · ฿ {(occurrence.data.transaction.amount || 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</option> : null;
                                })}
                              </select>
                            </label>
                            <button
                              type="button"
                              aria-label={`ยืนยันรายการอื่นเป็นสำเนาสำหรับ Ref ${group.referenceNo}`}
                              disabled={!selectedMasterId}
                              onClick={() => saveDuplicateReferenceResolution(group.referenceNo, {
                                disposition: "duplicate",
                                masterOccurrenceId: selectedMasterId,
                                occurrenceIds: [...group.occurrenceIds],
                              })}
                              className="rounded border border-amber-300/30 bg-amber-950/50 px-2 py-1 text-amber-100 hover:bg-amber-900/60 disabled:cursor-not-allowed disabled:opacity-40"
                            >ยืนยันสำเนาและหักเฉพาะ NET</button>
                            <button
                              type="button"
                              aria-label={`ยืนยันว่าเป็นคนละธุรกรรมสำหรับ Ref ${group.referenceNo}`}
                              onClick={() => saveDuplicateReferenceResolution(group.referenceNo, {
                                disposition: "distinct",
                                occurrenceIds: [...group.occurrenceIds],
                              })}
                              className="rounded border border-emerald-300/30 bg-emerald-950/40 px-2 py-1 text-emerald-100 hover:bg-emerald-900/50"
                            >ยืนยันคนละธุรกรรม</button>
                            {savedDecision && (
                              <button type="button" onClick={() => clearDuplicateReferenceResolution(group.referenceNo)} className="rounded px-2 py-1 text-slate-300 hover:bg-white/10">
                                ล้างคำวินิจฉัย
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              {ledgerRecords.length === 0 ? (
                <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                  <span className="text-3xl">📭</span>
                  <span className="font-bold text-sm text-slate-300">
                    ยังไม่มีรายการสลิปที่ผ่านการถอดรหัสในระบบ (Pure Zero State)
                  </span>
                  <span className="text-xs text-slate-500">
                    กรุณาหยอดไฟล์สลิปเข้า Staging Buffer แล้วกดเริ่มประมวลผล เพื่อพ่นข้อมูลลง 13 คอลัมน์อัตโนมัติ
                  </span>
                </div>
              ) : (
                <table className="w-full min-w-[2100px] text-[11px] border-collapse text-left font-sans">
                  <thead>
                    <tr className="bg-sky-950/60 text-sky-300 font-bold border-b border-sky-500/30 font-mono">
                      <th className="p-2 text-center w-10">ลำดับ</th>
                      <th className="p-2">หน้าแชท</th>
                      <th className="p-2" title="ลำดับหน้าในแฟ้ม PDF; หน้าปก สรุปผู้บริหาร และตารางบัญชีอยู่ก่อนหน้าหลักฐาน">หน้าแฟ้ม PDF</th>
                      <th className="p-2">ภาพ/พิกัดอ้างอิง</th>
                      <th className="p-2">วันที่-เวลา</th>
                      <th className="p-2">ธนาคาร</th>
                      <th className="p-2">รหัสอ้างอิงธุรกรรม (Ref ID)</th>
                      <th className="p-2">ชื่อผู้โอน (ต้นทาง)</th>
                      <th className="p-2">เลขที่บัญชีต้นทาง</th>
                      <th className="p-2">ชื่อผู้รับโอน (ปลายทาง)</th>
                      <th className="p-2">เลขที่บัญชีปลายทาง</th>
                      <th className="p-2 text-right">จำนวนเงิน (บาท)</th>
                      <th className="p-2 text-center min-w-64">สถานะการตรวจพิสูจน์</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {ledgerRecords.map((record, idx) => {
                        const d = record.data;
                        const sourceItem = stagedQueue.find((item) => item.id === record.sourceItemId);
                        const referenceMatches = referenceMatchOf.get(record.id) || [];
                        const duplicateAudit = duplicateAuditOf.get(record.id);
                        const isDup = referenceMatches.length > 0;
                        return (
                          <tr
                            key={record.id}
                            className={`hover:bg-white/5 transition-colors ${
                              isDup ? "bg-amber-500/10 text-amber-200" : "text-slate-200"
                            }`}
                          >
                            <td className="p-2 text-center font-mono">{idx + 1}</td>
                            <td className="p-2 font-mono">{record.chatPage}</td>
                            <td className="p-2 font-mono">{record.dossierPage ? `${record.dossierPage} (แฟ้ม PDF)` : "ดูรายการหลักฐาน"}</td>
                            <td className="p-2">
                              <a href={record.crop} target="_blank" rel="noreferrer" className="text-sky-300 underline" title={record.source}>
                                {record.source} · {record.bounds ? `${record.bounds.x},${record.bounds.y}` : "ต้นฉบับ"}
                              </a>
                              <button
                                type="button"
                                onClick={() => handleExportSlipRecordJson(record)}
                                disabled={pdpaEnabled}
                                title={pdpaEnabled ? "ปิด PDPA Shield ก่อนส่งออกข้อมูลรายภาพ" : `ดาวน์โหลด metadata JSON ของ ${record.source}`}
                                className="ml-2 rounded border border-sky-400/30 px-1.5 py-0.5 text-[9px] text-sky-200 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                JSON
                              </button>
                            </td>
                            <td className="p-2 font-mono whitespace-nowrap">
                              {d.transaction.date || "-"} {d.transaction.time || ""}
                            </td>
                            <td className="p-2 font-semibold text-sky-400 whitespace-nowrap">{[d.sender.bank, d.receiver.bank].filter(Boolean).join(" → ") || d.bank.name || "ต้องตรวจ"}</td>
                            <td className="p-2 font-mono text-[10px] break-all">
                              <input aria-label={`รหัสอ้างอิงรายการ ${idx + 1}`} className="w-32 bg-slate-900/70 border border-white/15 rounded px-1 py-0.5" value={d.transaction.reference_no || ""} onChange={(event) => updateLedgerRecord(record.id, "reference_no", event.target.value)} placeholder="รอตรวจ/กรอก" />
                            </td>
                            <td className="p-2">
                              {pdpaEnabled ? (d.sender.name ? maskPersonName(d.sender.name, true) : "-") : (
                                <input aria-label={`ชื่อผู้โอนรายการ ${idx + 1}`} className="w-36 bg-slate-900/70 border border-white/15 rounded px-1 py-0.5" value={d.sender.name || ""} onChange={(event) => updateLedgerRecord(record.id, "sender_name", event.target.value)} placeholder="OCR ยังไม่พบชื่อ" />
                              )}
                              {d.sender.name && <span className="block text-[9px] text-amber-300">{d.reviewed_fields?.includes("sender_name") ? "กรอก/แก้ไขแล้ว · รอตรวจ" : record.aiProposedFields?.includes("all") || record.aiProposedFields?.includes("sender.name") ? `${d.warnings.some((warning) => warning.includes("SlipVision")) ? "SlipVision" : "Gemini"} candidate · รอตรวจชื่อจากภาพ` : `รอตรวจ · OCR ${Math.round(d.confidence.sender_name * 100)}%`}</span>}
                            </td>
                            <td className="p-2 font-mono text-[10px]">
                              {pdpaEnabled ? maskAccountNumber(d.sender.account_no) : (
                                <input aria-label={`บัญชีต้นทางรายการ ${idx + 1}`} className="w-28 bg-slate-900/70 border border-white/15 rounded px-1 py-0.5" value={d.sender.account_no || ""} onChange={(event) => updateLedgerRecord(record.id, "sender_account", event.target.value)} placeholder="ไม่พบ/กรอก" />
                              )}
                            </td>
                            <td className="p-2 font-semibold">
                              {pdpaEnabled ? (
                                <div className="text-slate-300">{d.receiver.name ? maskPersonName(d.receiver.name, true) : "-"}<span className="block text-[9px] text-slate-500">ปิดการปกปิดเพื่อแก้ไข</span></div>
                              ) : (
                                <input aria-label={`ชื่อผู้รับรายการ ${idx + 1}`} className="w-36 bg-slate-900/70 border border-white/15 rounded px-1 py-0.5" value={d.receiver.name || ""} onChange={(event) => updateLedgerRecord(record.id, "receiver_name", event.target.value)} placeholder="OCR ยังไม่พบชื่อ" />
                              )}
                              {d.receiver.name && <span className="mt-0.5 block text-[9px] text-amber-300">{record.isConfirmed ? "ผู้ใช้ยืนยัน" : d.reviewed_fields?.includes("receiver_name") ? "กรอก/แก้ไขแล้ว · รอตรวจ" : record.aiProposedFields?.includes("all") || record.aiProposedFields?.includes("receiver.name") ? `${d.warnings.some((warning) => warning.includes("SlipVision")) ? "SlipVision" : "Gemini"} candidate · รอตรวจชื่อจากภาพ` : d.confidence.receiver_name > 0 ? `รอตรวจ · OCR ${Math.round(d.confidence.receiver_name * 100)}%` : "กรอก/แก้ไขแล้ว · รอตรวจ"}</span>}
                            </td>
                            <td className="p-2 font-mono text-[10px]">
                              {pdpaEnabled ? maskAccountNumber(d.receiver.account_no) : (
                                <input aria-label={`บัญชีปลายทางรายการ ${idx + 1}`} className="w-28 bg-slate-900/70 border border-white/15 rounded px-1 py-0.5" value={d.receiver.account_no || ""} onChange={(event) => updateLedgerRecord(record.id, "receiver_account", event.target.value)} placeholder="ไม่พบ/กรอก" />
                              )}
                            </td>
                            <td className="p-2 text-right font-mono font-bold text-emerald-400">
                              <input aria-label={`จำนวนเงินรายการ ${idx + 1}`} type="number" min="0" step="0.01" className="w-24 bg-slate-900/70 border border-white/15 rounded px-1 py-0.5 text-right" value={d.transaction.amount ?? ""} onChange={(event) => updateLedgerRecord(record.id, "amount", event.target.value)} placeholder="กรอกยอด" />
                            </td>
                            <td className="p-2 text-center min-w-64">
                              {duplicateAudit && (
                                <div className="mb-1 rounded border border-amber-400/30 bg-amber-500/10 p-1 text-left text-[9px] text-amber-200">
                                  <strong>{duplicateAudit.status === "ambiguous" ? "พบ master ได้หลายรายการ · ต้องตรวจเอง" : "พบสัญญาณซ้ำ · ตรวจทานเท่านั้น"}</strong>
                                  <span className="block">วิธีพบ: {[...new Set(duplicateAudit.masterCandidates.flatMap((candidate) => candidate.reasons))].join(" · ")}</span>
                                  <span className="block">หน้า: {duplicateAudit.locations.join(" · ") || "ไม่ระบุ"}</span>
                                  {duplicateAudit.masterCandidates.map((candidate) => {
                                    const master = ledgerRecords.find((item) => item.id === candidate.occurrenceId);
                                    return master ? (
                                      <a key={`${record.id}-audit-${candidate.occurrenceId}`} href={master.crop} target="_blank" rel="noreferrer" className="block text-sky-300 underline">
                                  {duplicateAudit.masterCandidates.length > 1 ? "ผู้สมัคร master" : "master"}: {candidate.source} · แชท {candidate.chatPage} · PDF {candidate.dossierPage ?? "ยังไม่มี"}
                                      </a>
                                    ) : null;
                                  })}
                                </div>
                              )}
                              {isDup && (
                                <span className="block px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-400/40">
                                  Ref ID ตรงกัน · ตรวจความสัมพันธ์
                                </span>
                              )}
                              {record.isConfirmed ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                                  ผู้ใช้ยืนยัน
                                </span>
                              ) : (
                                <span className="text-amber-300">รอตรวจและยืนยัน</span>
                              )}
                              {record.needsReview && record.isConfirmed && <span className="block text-[9px] text-amber-300">ยังมีช่องข้อมูลว่าง</span>}
                              {d.warnings.some((warning) => warning.includes("Gemini") || warning.includes("SlipVision")) && <span className="block text-[9px] text-amber-300">AI เสนอข้อมูล · ยังไม่ยืนยัน</span>}
                              {d.warnings.filter((warning) => warning.includes("AI ขัดกัน")).map((warning) => <span key={warning} className="block text-[9px] text-amber-200">{warning}</span>)}
                              <button type="button" className="mt-1 text-[10px] text-sky-300 underline" onClick={() => setLedgerRecordConfirmed(record.id, !record.isConfirmed)}>
                                {record.isConfirmed ? "ยกเลิกการยืนยัน" : "ยืนยันรายการ"}
                              </button>
                              {referenceMatches.map((match, matchIndex) => (
                                <a key={`${record.id}-ref-match-${matchIndex}`} href={match.crop} target="_blank" rel="noreferrer" className="mt-1 block text-[9px] text-sky-300 underline">
                                  เปิดหลักฐานที่ Ref ID ตรงกัน: {match.source} · แชท {match.chatPage} · PDF {match.dossierPage ?? "ยังไม่มี"}
                                </a>
                              ))}
                              {(similarImageOf.get(record.id) || []).map((match, matchIndex) => (
                                <a key={`${record.id}-image-match-${matchIndex}`} href={match.crop} target="_blank" rel="noreferrer" className="mt-1 block text-[9px] text-amber-300 underline">
                                  ภาพคล้าย โปรดตรวจ (เกณฑ์ชั่วคราว, pHash {match.distance}/64): {match.source} · แชท {match.chatPage} · PDF {match.dossierPage ?? "ยังไม่มี"}
                                </a>
                              ))}
                              <span className="mt-1 block text-[9px] text-slate-400">
                                {perceptualHashes.has(record.id) ? (similarImageOf.has(record.id) ? "เป็นสัญญาณภาพคล้ายที่ข้อมูลธุรกรรมไม่ขัดกันเท่านั้น · ไม่ยืนยัน/ไม่ตัดยอด" : "ไม่พบคู่ภาพที่ผ่านการคัดด้วย Ref/วันเวลา · ไม่ใช่ข้อยืนยันว่าไม่ซ้ำ") : "ความคล้ายภาพ: กำลังประเมินในเครื่อง หรือยังประเมินไม่ได้"}
                              </span>
                              {sourceItem?.category === "SLIP" && <TyphoonOcrReview file={sourceItem.file} current={d} />}
                              {sourceItem?.category === "CHAT" && <span className="mt-2 block text-[9px] text-slate-500">Typhoon OCR ปิดไว้สำหรับภาพแชท เพื่อลดการส่งข้อความส่วนอื่นออกนอกเครื่อง</span>}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-950/80 font-bold border-t border-white/20 text-slate-100">
                      <td colSpan={11} className="p-2.5 text-right font-mono text-xs">
                        ยอดรวมรายการที่ยืนยัน (Gross; ยังไม่หัก Ref ซ้ำ):
                      </td>
                      <td className="p-2.5 text-right font-mono text-emerald-400 text-sm">
                        {amountDisplay}
                      </td>
                      <td className="p-2.5 text-center font-mono text-[10px] text-sky-300">
                        <span className="block">Ref ซ้ำ {ledgerReconciliation.duplicateCount} จุด · รอตรวจ ฿ {ledgerReconciliation.potentialDuplicateAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                        <span className="block text-slate-400">ยอดสุทธิจำลอง ฿ {ledgerReconciliation.provisionalNetAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} · ไม่ได้หักจากยอดจริง</span>
                        <span className="block text-emerald-300">NET หลังคำวินิจฉัยผู้ตรวจ ฿ {reviewedDuplicateSummary.reviewedNetAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} · กลุ่มรอตรวจ {reviewedDuplicateSummary.unresolvedGroupCount}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex flex-col gap-3 bg-black/40">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-400">
                  จัดทำข้อมูลประกอบการตรวจสอบตาม พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ และ ISO/IEC 27037
                </span>
                <div className="flex flex-wrap justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleExportSlipIndexMarkdown}
                  disabled={ledgerRecords.length === 0}
                  className="btn-proportional-compact rounded-lg bg-sky-700/50 border border-sky-400/40 text-sky-100 hover:bg-sky-700/70 text-xs px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  ดาวน์โหลด Markdown 13 คอลัมน์
                </button>
                <button
                  type="button"
                  onClick={handleExportNetReconciliationDossier}
                  disabled={ledgerRecords.length === 0}
                  className="btn-proportional-compact rounded-lg bg-amber-800/50 border border-amber-300/40 text-amber-100 hover:bg-amber-800/70 text-xs px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  ส่งออก NET Review JSON
                </button>
                <button
                  type="button"
                  onClick={handleExportSlipIndexJson}
                  disabled={ledgerRecords.length === 0}
                  className="btn-proportional-compact rounded-lg bg-sky-700/50 border border-sky-400/40 text-sky-100 hover:bg-sky-700/70 text-xs px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  ดาวน์โหลดสารบัญสลิป JSON
                </button>
                <button
                  type="button"
                  onClick={handleExportLedgerXlsx}
                  disabled={ledgerRecords.length === 0 || ledgerXlsxStatus === "กำลังสร้าง XLSX..."}
                  className="btn-proportional-compact rounded-lg bg-emerald-700/50 border border-emerald-400/40 text-emerald-100 hover:bg-emerald-700/70 text-xs px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  {ledgerXlsxStatus === "กำลังสร้าง XLSX..." ? "กำลังสร้าง XLSX..." : "ดาวน์โหลด XLSX 13 คอลัมน์"}
                </button>
                <button
                  onClick={() => window.print()}
                  className="btn-proportional-compact rounded-lg bg-sky-600/30 border border-sky-400/40 text-sky-200 hover:bg-sky-600/50 text-xs px-3 py-1.5 font-bold"
                >
                  🖨️ พิมพ์ตาราง 13 คอลัมน์
                </button>
                <button
                  onClick={() => setLedgerModalOpen(false)}
                  className="btn-proportional-compact rounded-lg bg-white/10 text-slate-200 hover:bg-white/15 text-xs px-3 py-1.5"
                >
                  ปิดหน้าต่าง
                </button>
                </div>
              </div>
              <div className="border-t border-white/10 pt-3 flex flex-wrap items-center gap-2">
                <span className="mr-auto text-[10px] text-slate-400">
                  เอกสารแยก: เล่มภาพหลักฐาน → สารบัญการเงิน 10 คอลัมน์ (อ้างเลขหน้าจริงในเล่มภาพ)
                </span>
                <button
                  type="button"
                  onClick={handleExportEvidenceContent}
                  disabled={ledgerRecords.length === 0 || exportingArtifact !== null}
                  className="btn-proportional-compact rounded-lg bg-indigo-700/50 border border-indigo-400/40 text-indigo-100 hover:bg-indigo-700/70 text-xs px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  {exportingArtifact === "CONTENT" ? "กำลังสร้างเล่มภาพ..." : "ส่งออกเล่มภาพหลักฐานแยก"}
                </button>
                <button
                  type="button"
                  onClick={handleExportSummaryIndexPdf}
                  disabled={!summaryIndexReady || exportingArtifact !== null}
                  title={summaryIndexReady ? "สร้าง PDF สารบัญ 10 คอลัมน์" : "ส่งออกเล่มภาพก่อน เพื่อทำแผนที่หน้าอ้างอิงจริง"}
                  className="btn-proportional-compact rounded-lg bg-cyan-700/50 border border-cyan-400/40 text-cyan-100 hover:bg-cyan-700/70 text-xs px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  {exportingArtifact === "SUMMARY_INDEX" ? "กำลังสร้างสารบัญ..." : "PDF สารบัญ 10 คอลัมน์"}
                </button>
                <button
                  type="button"
                  onClick={handleExportSummaryIndexXlsx}
                  disabled={!summaryIndexReady || exportingArtifact !== null}
                  title={summaryIndexReady ? "สร้าง XLSX สารบัญ 10 คอลัมน์" : "ส่งออกเล่มภาพก่อน เพื่อทำแผนที่หน้าอ้างอิงจริง"}
                  className="btn-proportional-compact rounded-lg bg-emerald-700/50 border border-emerald-400/40 text-emerald-100 hover:bg-emerald-700/70 text-xs px-3 py-1.5 font-bold disabled:opacity-40"
                >
                  XLSX สารบัญ 10 คอลัมน์
                </button>
              </div>
              {netDossierStatus && <div role="status" className="text-right text-[10px] text-amber-200">{netDossierStatus}</div>}
              {evidenceContentStatus && <div role="status" className="text-right text-[10px] text-indigo-200">{evidenceContentStatus}</div>}
              {summaryIndexStatus && <div role="status" className="text-right text-[10px] text-cyan-200">{summaryIndexStatus}</div>}
              {!summaryIndexReady && ledgerRecords.length > 0 && (
                <div className="text-right text-[10px] text-slate-500">สารบัญแยกจะเปิดใช้เมื่อเลขหน้าจริงของทุกรายการ map ได้จากเล่มภาพหลักฐาน</div>
              )}
            </div>
            {ledgerXlsxStatus && <div role="status" className="px-4 pb-2 text-right text-[10px] text-emerald-300">{ledgerXlsxStatus}</div>}
            {slipIndexStatus && <div role="status" className="px-4 pb-2 text-right text-[10px] text-sky-300">{slipIndexStatus}</div>}
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
                    ข้อเสนอการเชื่อมโยงแชทกับสลิปจาก OCR
                  </h3>
                  <span className="text-[11px] text-emerald-400 font-mono">
                    แสดง candidate จาก Ref, ยอด/คำโอน หรือยอด/ข้อความกู้ยืมที่ต้องตรวจทาน
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
                  <span className="text-[10px] text-slate-400 uppercase font-mono">ข้อเสนอจับคู่จาก OCR</span>
                  <div className="text-lg font-bold font-mono text-emerald-400 mt-0.5">
                    {chatSlipCorroborationCandidates.length} candidate
                  </div>
                  <span className="text-[10px] text-slate-300">ยังไม่ถือเป็นคู่ที่ยืนยัน</span>
                </div>
                <div className="glass-nested p-3 rounded-lg border border-sky-400/30 bg-sky-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">หน้าแชทที่พบสลิปฝัง</span>
                  <div className="text-lg font-bold font-mono text-sky-400 mt-0.5">
                    {chatPagesWithEmbeddedSlips} หน้า
                  </div>
                  <span className="text-[10px] text-slate-300">Dicut_Chat Quiet Zone Block</span>
                </div>
                <div className="glass-nested p-3 rounded-lg border border-amber-400/30 bg-amber-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">สัญญาณ Ref ID ตรงกัน</span>
                  <div className="text-lg font-bold font-mono text-amber-400 mt-0.5">
                    {evidenceState.duplicateCount} รายการ
                  </div>
                  <span className="text-[10px] text-slate-300">เก็บทุกรายการไว้ให้ตรวจ ไม่มีการตัดยอดอัตโนมัติ</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400/30 bg-amber-950/20 p-3">
                <p className="text-[10px] text-amber-100">PDF นี้เป็นชุดคู่หลักฐานสำหรับตรวจทาน ไม่ใช่การยืนยันความสัมพันธ์</p>
                <button
                  type="button"
                  onClick={() => void handleExportConsistentReviewPacket()}
                  disabled={chatSlipCorroborationCandidates.length === 0 || exportingArtifact !== null}
                  className="btn-secondary text-xs"
                >
                  {exportingArtifact === "CORROBORATION" ? "กำลังสร้างชุดตรวจทาน..." : `ส่งออกชุดคู่หลักฐานรอตรวจ (${chatSlipCorroborationCandidates.length})`}
                </button>
                {corroborationPacketStatus && <span role="status" className="w-full text-[10px] text-sky-200">{corroborationPacketStatus}</span>}
              </div>

              {/* Linkage Pair Table */}
              <div className="border border-white/10 rounded-xl overflow-hidden mt-1">
                {buildProcessingWarningEntries(stagedQueue).length > 0 && (
                  <div className="border-b border-amber-400/30 bg-amber-950/30 p-3 text-xs text-amber-200 space-y-1">
                    {buildProcessingWarningEntries(stagedQueue).map(({ id, warning }) => (
                      <p key={id}>{warning}</p>
                    ))}
                  </div>
                )}
                <table className="w-full text-xs border-collapse text-left">
                  <thead>
                    <tr className="bg-slate-900/80 text-emerald-300 font-bold border-b border-white/10 font-mono text-[11px]">
                      <th className="p-2.5 text-center w-12">คู่ที่</th>
                      <th className="p-2.5">หน้าแชท / OCR group</th>
                      <th className="p-2.5">ข้อมูลผู้รับจากรายการ</th>
                      <th className="p-2.5">ลำดับของสลิปใน PDF</th>
                      <th className="p-2.5 text-right">ยอดเงินตรวจคู่ (บาท)</th>
                      <th className="p-2.5 text-center">ฐานสัญญาณ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[11px]">
                    {chatSlipCorroborationCandidates.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400">
                          ยังไม่พบ OCR ในหน้าแชทที่ตรงกับเลขอ้างอิง หรือยอดเงินพร้อมคำบ่งชี้การโอน
                        </td>
                      </tr>
                    ) : (
                      chatSlipCorroborationCandidates.map((candidate, idx) => {
                          const record = ledgerRecords.find((item) => item.id === candidate.slipId);
                          if (!record) return null;
                          const slipPageRef = record.dossierPage ?? "ยังไม่มีหน้าในแฟ้ม PDF";
                          const amt = record.data.transaction.amount || 0;
                          const chatSource = candidate.chatSourceItemId
                            ? stagedQueue.find((item) => item.id === candidate.chatSourceItemId)
                            : undefined;
                          const chatSliceIndex = chatSource && typeof candidate.chatPageNumber === "number"
                            ? chatSource.chatStreamPageNumbers?.indexOf(candidate.chatPageNumber) ?? -1
                            : -1;
                          const chatImage = chatSliceIndex >= 0 ? chatSource?.chatSlices?.[chatSliceIndex] : undefined;
                          return (
                            <React.Fragment key={`${record.id}-${candidate.chatSourceItemId || "unknown"}-${candidate.chatPageNumber}-${candidate.groupId}-${idx}`}>
                            <tr className="hover:bg-white/5 transition-colors text-slate-200">
                              <td className="p-2.5 text-center font-mono font-bold text-sky-400">
                                #{idx + 1}
                              </td>
                              <td className="p-2.5 font-mono">
                                <span className="bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded border border-sky-500/30">
                                  หน้า {candidate.chatPageNumber} · {candidate.groupId}
                                </span>
                              </td>
                              <td className="p-2.5 max-w-[220px] truncate text-slate-300">
                                หลักฐานรายการของ {record.data.receiver.name || "ไม่ระบุผู้รับ"}
                              </td>
                              <td className="p-2.5 font-mono">
                                <span className="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                                  หน้าแฟ้ม PDF {slipPageRef}
                                </span>
                              </td>
                              <td className="p-2.5 text-right font-mono font-bold text-emerald-400">
                                ฿ {amt.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                              </td>
                              <td className="p-2.5 text-center">
                                <span className="px-2 py-0.5 rounded font-mono text-[9.5px] font-bold bg-amber-500/20 text-amber-200 border border-amber-400/40">
                                  รอตรวจ · {getCorroborationBasisLabel(candidate)}
                                </span>
                              </td>
                            </tr>
                            <tr className="bg-slate-950/40">
                              <td colSpan={6} className="p-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  <figure className="min-w-0 border border-sky-400/20 rounded-md p-2">
                                    <figcaption className="mb-2 text-[10px] text-sky-200">ภาพแชท · หน้า {candidate.chatPageNumber}{chatSource ? ` · ${chatSource.file.name}` : ""}</figcaption>
                                    {chatImage ? (
                                      <img src={chatImage} alt={`หลักฐานแชท หน้า ${candidate.chatPageNumber}`} className="w-full h-64 object-contain bg-black/40 rounded" />
                                    ) : (
                                      <div className="h-64 grid place-items-center text-[10px] text-slate-400">ไม่พบภาพหน้าแชทต้นทางสำหรับ candidate นี้</div>
                                    )}
                                  </figure>
                                  <figure className="min-w-0 border border-emerald-400/20 rounded-md p-2">
                                    <figcaption className="mb-2 text-[10px] text-emerald-200">สลิปต้นฉบับ · หน้าแฟ้ม PDF {slipPageRef} · {record.source}</figcaption>
                                    <img src={record.crop} alt={`สลิปหลักฐาน ${record.source}`} className="w-full h-64 object-contain bg-black/40 rounded" />
                                  </figure>
                                </div>
                                <p className="mt-2 text-[9px] text-amber-200">ภาพคู่สำหรับตรวจทานเท่านั้น · candidate นี้ยังไม่ใช่การยืนยันความสัมพันธ์</p>
                              </td>
                            </tr>
                            </React.Fragment>
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
                ระบบเสนอ candidate จาก OCR เท่านั้น; ผู้ตรวจต้องเทียบภาพต้นฉบับก่อนยืนยันความเชื่อมโยง
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
                    แพ็กเกจ SFX (.exe)
                  </h3>
                  <span className="text-[11px] text-sky-400 font-mono">
                    WinRAR SFX builder
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
                  🔐 การป้องกันแพ็กเกจส่งออก
                </span>
                <p className="text-slate-300 leading-relaxed text-[11.5px]">
                  ระบบสร้าง PDF รายงานและแพ็กเกจ SFX พร้อม SHA-256 ใน manifest ก่อนดาวน์โหลด
                </p>
              </div>

              {/* Shared password status; the editable password field is in the export panel. */}
              <div className="thai-clearance-stack">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-200">
                    รหัสผ่านร่วมสำหรับ PDF และ SFX:
                  </label>
                  {exportPassword.trim() ? (
                    <span className="text-[10px] font-mono text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded border border-amber-400/40 font-semibold">
                      PASSWORD SET
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-400 bg-white/10 px-2 py-0.5 rounded border border-white/15">
                      NO PASSWORD SET
                    </span>
                  )}
                </div>
                <div className="text-[10.5px] mt-1">
                  {exportPassword.trim() ? (
                    <span className="text-amber-300">
                      เมื่อตั้งรหัส ระบบจะใช้ค่าเดียวกันกับการแตก SFX และเปิด PDF ภายใน
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      เว้นว่างไว้: PDF และ SFX จะไม่บังคับรหัสผ่าน
                    </span>
                  )}
                </div>
              </div>

              {exportStatus && (
                <div role="status" className={`rounded-lg px-3 py-2 text-[11px] ${exportStatus.type === "error" ? "bg-rose-950/40 text-rose-300" : "bg-emerald-950/30 text-emerald-300"}`}>
                  {exportStatus.message}
                </div>
              )}

              {/* Manifest Package Items */}
              <div className="thai-clearance-stack">
                <label className="font-bold text-slate-200">
                  ไฟล์ที่จะบรรจุใน SFX:
                </label>
                <div className="p-3 rounded-lg bg-black/40 border border-white/10 space-y-1.5 font-mono text-[11px] text-slate-300 mt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>1. Digital_Evidence_Report.pdf</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>2. manifest.json (รายการและ SHA-256 ของไฟล์ในแพ็กเกจ)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                    <span>3. README.txt</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400">✓</span>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 mt-1">รวมไฟล์ต้นฉบับที่อัปโหลดทุกไฟล์ พร้อมภาพหลักฐานใน PDF ฉบับเต็ม</div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex items-center justify-between bg-black/40">
              <span className="text-[11px] text-slate-400 font-mono">
                เอาต์พุต: Digital_Evidence_Case_{caseNumber || "012-2569"}.exe
              </span>
              <div className="flex gap-2.5">
                <button
                  onClick={handleExportSfx}
                  disabled={exportingArtifact !== null}
                  className="btn-proportional-primary glass-button glass-button-cyan text-xs font-bold px-4 py-2"
                >
                  {exportingArtifact === "SFX" ? "กำลังสร้าง SFX..." : "สร้างและดาวน์โหลด SFX จริง"}
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
          โมดูลที่ 5: รายการกฎหมายที่อาจเกี่ยวข้อง (แพ่ง / อาญา)
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
                    รวบรวมบทกฎหมายที่อาจเกี่ยวข้องเพื่อประกอบการพิจารณา
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                      LEGAL REFERENCES · HUMAN REVIEW
                    </span>
                  </h3>
                  <span className="text-[11px] text-indigo-300 font-mono">
                    ข้อมูลประกอบการตรวจสอบเบื้องต้นตาม ISO/IEC 27037 และ พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ ไม่ใช่คำวินิจฉัย
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
                      รายการอ้างอิงที่รวบรวม
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                      TOTAL DETECTED
                    </span>
                  </div>
                  <div className="text-2xl font-bold font-mono text-indigo-300 mt-1">
                    {courtEvidenceMapping.length} <span className="text-xs font-normal text-slate-400">จุดที่ควรตรวจต่อ</span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1">
                    จำนวนรายการอ้างอิงจากข้อมูลที่นำเข้า ไม่ใช่ข้อสรุปทางกฎหมาย
                  </span>
                </div>

                {/* Card 2: CIVIL PROVISIONS */}
                <div className="glass-nested p-3.5 rounded-xl border border-sky-500/30 bg-sky-950/25 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                    บทกฎหมายแพ่งที่อาจเกี่ยวข้อง
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-400/30">
                      CIVIL PROVISIONS
                    </span>
                  </div>
                  <div className="text-2xl font-bold font-mono text-sky-300 mt-1">
                    {civilCount} <span className="text-xs font-normal text-slate-400">รายการอ้างอิง</span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1">
                    ยอดเงินที่รวบรวมได้ {amountDisplay}; ต้องตรวจสอบข้อเท็จจริงและเงื่อนไขเพิ่มเติม
                  </span>
                </div>

                {/* Card 3: CRIMINAL PROVISIONS */}
                <div className="glass-nested p-3.5 rounded-xl border border-rose-500/30 bg-rose-950/25 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                    บทกฎหมายอาญาที่อาจเกี่ยวข้อง
                    </span>
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-400/30">
                      CRIMINAL PROVISIONS
                    </span>
                  </div>
                  <div className="text-2xl font-bold font-mono text-rose-400 mt-1">
                    {criminalCount} <span className="text-xs font-normal text-slate-400">รายการอ้างอิง</span>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1">
                    รายการกฎหมายที่รวบรวมไว้เพื่อให้ผู้ตรวจพิจารณาบริบท
                  </span>
                </div>
              </div>

              {/* ===============================================================
                  ส่วนที่ ๒: รายการบทกฎหมายที่อาจเกี่ยวข้อง (LEGAL REFERENCES)
                  =============================================================== */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* ฝั่งที่ ๑: บทกฎหมายอาญาที่อาจเกี่ยวข้อง */}
                <div className="p-4 rounded-xl bg-slate-900/70 border border-red-500/35 flex flex-col gap-2.5 shadow-lg">
                  <div className="flex items-center justify-between pb-1 border-b border-red-500/20">
                    <span className="font-bold text-red-400 text-sm flex items-center gap-1.5">
                      ⚖️ 1. บทกฎหมายอาญาที่อาจเกี่ยวข้อง (Criminal Law References)
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-500/20 text-red-300 border border-red-500/30">
                      LEGAL REFERENCES
                    </span>
                  </div>

                  <div className="space-y-2 mt-1">
                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col gap-1">
                      <span className="font-bold text-red-300 text-[11.5px]">
                        • ประเด็นตามประมวลกฎหมายอาญา มาตรา 341, 343 ที่อาจต้องตรวจสอบ
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

                {/* ฝั่งที่ ๒: บทกฎหมายแพ่งที่อาจเกี่ยวข้อง */}
                <div className="p-4 rounded-xl bg-slate-900/70 border border-sky-500/35 flex flex-col gap-2.5 shadow-lg">
                  <div className="flex items-center justify-between pb-1 border-b border-sky-500/20">
                    <span className="font-bold text-sky-400 text-sm flex items-center gap-1.5">
                      📑 2. บทกฎหมายแพ่งที่อาจเกี่ยวข้อง (Civil Law References)
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                      LEGAL REFERENCES
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
                  ส่วนที่ ๓: ตารางเชื่อมโยงข้อมูลและเอกสารอ้างอิง (EVIDENCE REFERENCE MAPPING)
                  =============================================================== */}
              <div className="flex flex-col gap-3 p-4 rounded-xl bg-slate-900/60 border border-white/10">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-sm text-slate-200 flex items-center gap-2">
                      📋 ตารางเชื่อมโยงข้อมูลและเอกสารอ้างอิง ๔ คอลัมน์ (Evidence Reference Mapping)
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      ตารางเชื่อมโยงข้อความที่ตรวจพบกับหน้า PDF และบทกฎหมายที่ควรพิจารณา
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
                        <th className="py-2.5 px-3 min-w-[260px]">๒. ข้อความหรือบริบทที่ตรวจพบ</th>
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

                            {/* Column 2: ข้อความหรือบริบทที่ตรวจพบ */}
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
                    รายการนี้เป็นข้อมูลประกอบการตรวจสอบเบื้องต้น ไม่ใช่การยืนยันว่าเข้าข่ายกฎหมาย ไม่ใช่คำวินิจฉัยชี้ขาด และไม่ใช่คำปรึกษาทางกฎหมาย ผู้ใช้ควรตรวจบริบทและหลักฐานต้นฉบับร่วมกับผู้เชี่ยวชาญ
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 bg-black/50 shrink-0">
              <span className="text-[11px] text-slate-400 font-mono">
                เอกสารประกอบการตรวจสอบเบื้องต้น · ข้อมูลกฎหมายใช้เพื่อประกอบการพิจารณา ไม่ใช่คำวินิจฉัย
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
          โมดูลที่ 6: แสดงรายชื่อทั้งหมดที่ตรวจพบจากหลักฐาน (Detected Names Modal 2.2)
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
                    รายชื่อบุคคลและบัญชีที่ตรวจพบจากไฟล์นำเข้า (All Detected Entities)
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
                  <span className="text-[10px] text-slate-400">ผู้รับโอน (Receiver Only)</span>
                </div>

                <div className="glass-nested p-3 rounded-xl border border-emerald-400/30 bg-emerald-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">บุคคลที่เลือกตรวจรายการ</span>
                  <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
                    {selectedTargetItems.length}/{targetList.length} <span className="text-xs font-normal text-slate-400">คน</span>
                  </div>
                  <span className="text-[10px] text-slate-400">ใช้คำนวณยอดเงินของรายการที่เลือก</span>
                </div>

                <div className="glass-nested p-3 rounded-xl border border-indigo-400/30 bg-indigo-950/20">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">ยอดรายการที่เชื่อมโยงกับบุคคลนี้</span>
                  <div className="text-xl font-bold font-mono text-indigo-300 mt-0.5">
                    ฿ {poiAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </div>
                  <span className="text-[10px] text-slate-400">คำนวณจากรายชื่อที่เลือกตรวจรายการ</span>
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
                      <th className="py-2.5 px-3 min-w-[150px]">ธนาคาร / เลขบัญชี</th>
                      <th className="py-2.5 px-3 text-right font-mono">ยอดรวมที่พบ</th>
                      <th className="py-2.5 px-3 w-32 text-center">การกระทำ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-[11.5px]">
                    {detectedNamesList.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-400 italic">
                          ยังไม่พบรายชื่อในพยานหลักฐาน (นำเข้าไฟล์สลิปเพื่อสกัดรายชื่ออัตโนมัติ)
                        </td>
                      </tr>
                    ) : (
                      detectedNamesList.map((item, idx) => {
                      const isAlreadyTarget = Boolean(findExactTargetIdentity(targetList, item.cleanName, (target) => target.cleanName));
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
                                ✓ อยู่ในรายการที่เลือก
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => addTargetPerson(item.rawName, item.role, item.totalAmount, item.txCount)}
                                className="btn-proportional-compact text-[10.5px] font-bold px-2.5 py-1 rounded-lg bg-sky-600/40 hover:bg-sky-600/70 text-sky-100 border border-sky-400/50 shadow-sm transition-all"
                              >
                                + เพิ่มในรายการที่เลือก
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </table>
              </div>

              <section className="rounded-xl border border-amber-400/25 bg-amber-950/10 p-3">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                  <div>
                    <h4 className="font-bold text-amber-200">ชื่อ/หน่วยงานจาก OCR แชท · รอตรวจทาน</h4>
                    <p className="mt-1 text-[10px] text-slate-400">เป็น candidate จากข้อความที่มีคำนำหน้าหรือป้ายชื่อชัดเจน ไม่ถือเป็นการยืนยันตัวบุคคล</p>
                    <p className="mt-1 text-[10px] text-slate-500" data-testid="chat-entity-discovery-diagnostics">
                      {chatEntityDiscoveryDiagnostics.chatPageCount === 0
                        ? "ยังไม่มีหน้าแชทที่ผ่านการประมวลผล"
                        : chatEntityDiscoveryDiagnostics.layer2UnitCount === 0
                          ? "มีหน้าแชทแล้ว แต่ไม่มีหน่วย OCR Layer 2"
                        : `OCR Layer 2 ${chatEntityDiscoveryDiagnostics.layer2UnitCount} หน่วย · ${chatEntityDiscoveryDiagnostics.textGroupCount} กลุ่มข้อความ · เข้าเกณฑ์ชื่อ ${chatEntityDiscoveryDiagnostics.groupsWithNameCandidate} กลุ่ม · ไม่เข้าเกณฑ์ ${chatEntityDiscoveryDiagnostics.groupsWithoutNameCandidate} กลุ่ม · ตัดกลุ่มในกรอบสลิป ${chatEntityDiscoveryDiagnostics.excludedSlipGroupCount} กลุ่ม`}
                    </p>
                  </div>
                  <span className="font-mono text-amber-200">{chatEntityCandidates.length} รายการ</span>
                </div>
                {chatEntityCandidates.length === 0 ? (
                  <p className="py-4 text-center text-slate-400">ยังไม่พบชื่อจาก OCR แชทที่เข้าเกณฑ์ candidate</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {chatEntityCandidates.map((candidate) => {
                      const alreadyTarget = Boolean(findExactTargetIdentity(targetList, candidate.cleanName, (target) => target.cleanName));
                      const slipOccurrences = ledgerRecords.filter((record) =>
                        isExactTargetMatch(candidate.cleanName, record.data.sender?.name)
                        || isExactTargetMatch(candidate.cleanName, record.data.receiver?.name),
                      ).length;
                      return (
                        <div key={candidate.id} className="grid gap-2 border-b border-white/5 py-2 last:border-0 md:grid-cols-[minmax(0,1fr)_auto]">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-100">{candidate.rawName}</span>
                              <span className="font-mono text-sky-300">{candidate.cleanName}</span>
                              <span className="rounded border border-amber-400/20 px-1.5 py-0.5 text-[9px] text-amber-200">{candidate.entityType} · ตรวจทาน</span>
                              <span className="text-[10px] text-slate-400">แชท {candidate.occurrences.length} จุด · สลิปที่ชื่อตรง {slipOccurrences} รายการ</span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2">
                              {candidate.occurrences.map((occurrence, index) => (
                                <button
                                  key={`${occurrence.sourceItemId}-${occurrence.pageNumber}-${occurrence.groupId}-${index}`}
                                  type="button"
                                  onClick={() => openSlipSourcePage({ sourceItemId: occurrence.sourceItemId, chatPage: String(occurrence.pageNumber) })}
                                  className="text-[10px] text-sky-300 underline underline-offset-2"
                                  title={occurrence.evidenceText}
                                >
                                  ดู {occurrence.fileName || "ไฟล์แชท"} · หน้า {occurrence.pageNumber} · OCR {Math.round(occurrence.confidence * 100)}%
                                </button>
                              ))}
                            </div>
                          </div>
                          {alreadyTarget ? (
                            <span className="self-start text-[10px] text-emerald-300">อยู่ในรายการเป้าหมายแล้ว</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => addTargetPerson(candidate.rawName, candidate.entityType === "PERSON" ? "บุคคลจาก OCR แชท (รอตรวจ)" : "นิติบุคคลจาก OCR แชท (รอตรวจ)", 0, candidate.occurrences.length)}
                              className="btn-proportional-compact self-start rounded border border-sky-400/40 px-2 py-1 text-[10px] text-sky-200 hover:bg-sky-500/15"
                            >
                              + เพิ่มเป็นเป้าหมาย
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 flex items-center justify-between bg-black/50 shrink-0">
              <span className="text-[11px] text-slate-400 font-mono">
                กฎเหล็ก: &quot;ไม่สนว่าจะมีคำนำหน้าว่าอะไร ชื่อตรง นามสกุลตรง นั้นคือถูก (Zero-Prefix Matching)&quot;
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
