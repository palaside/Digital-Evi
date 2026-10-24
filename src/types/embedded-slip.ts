import type { SlipExtraction } from "@/schemas/slip.schema";
import type { SlipOcrDiagnosticTrace } from "@/types/slip-ocr-trace";

export interface EmbeddedSlipRecord {
  id: string;
  extractionVersion?: number;
  sourceItemId: string;
  sourceFileName: string;
  data: SlipExtraction;
  candidateBounds?: { x: number; y: number; width: number; height: number };
  sourceBounds: { x: number; y: number; width: number; height: number };
  sourceSha256?: string;
  sourceReferences?: Array<{
    sourceItemId: string;
    fileName: string;
    sha256: string;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  crossesSourceBoundary?: boolean;
  cropDataUrl: string;
  ocrTextBoxes?: Array<{
    text: string;
    confidence: number;
    bounds: { x: number; y: number; width: number; height: number };
    classification?: "slip_evidence" | "chat_context" | "uncertain";
    reason?: string;
    supportsFields?: string[];
  }>;
  ocrDiagnosticTrace?: SlipOcrDiagnosticTrace;
  chatPageNumber: number;
  chatPageCount: number;
  dossierPageNumber: number;
  isDuplicate: boolean;
  isConfirmed?: boolean;
  duplicateOfRef?: string;
  needsReview: boolean;
  aiProposedFields?: string[];
}

export interface ChatEvidenceLayerPage {
  pageNumber: number;
  ocrDiagnosticTrace?: SlipOcrDiagnosticTrace;
  qrScanDiagnostic?: {
    inputWidth: number;
    inputHeight: number;
    pixelFingerprint: string;
    productionUpscale: number;
    candidateCount?: number;
    productionScans?: Array<{
      decoder: "jsQR" | "ZXing";
      width: number;
      height: number;
      scale: number;
      stage: "original" | "upscaled" | "enhanced" | "enhanced-upscaled";
      candidateIndex: number;
      outcome: "decoded" | "not_found" | "invalid_symbol" | "error";
      elapsedMs: number;
      errorName?: string;
      errorMessage?: string;
    }>;
    diagnosticError?: string;
    enhancement?: { attempted: boolean; decoded: boolean; stages: string[] };
    scans: Array<{ scale: number; decoder: "jsQR" | "ZXing" | "jsQR-nearest" | "ZXing-nearest" | "jsQR-roi-nearest" | "ZXing-roi-nearest" | "jsQR-roi-otsu" | "jsQR-full-otsu" | "ZXing-full-otsu" | "jsQR-grid-otsu" | "ZXing-grid-otsu"; decoded: boolean; region?: { x: number; y: number; width: number; height: number } }>;
  };
  layer1: Array<{
    id: string;
    kind: "text_message_candidate" | "visual_region_candidate" | "timestamp_marker_candidate";
    label?: string;
    bounds: { x: number; y: number; width: number; height: number };
    confidence: number;
    needsReview: true;
    detectionMethod: "ocr_line_cluster" | "opencv_adaptive_mask_contour" | "opencv_hsv_lab_color_mask_contour" | "ocr_timestamp_line_pattern";
    supportingDetectionMethods?: string[];
    objectTypeCandidate?: string;
    semanticMethod?: "heuristic" | "model";
    semanticRationale?: string;
    foregroundRatio?: number;
    relatedTextGroupId?: string | null;
    streamBounds: { x: number; y: number; width: number; height: number };
    sourceReferences: Array<{ sourceItemId: string; fileName: string; sha256: string; captureTime?: string | null; eventTime?: string | null; sourceTrim?: { top: number; bottom: number; topMethod: string; bottomMethod: string; topEvidence?: string | null; bottomEvidence?: string | null }; bounds: { x: number; y: number; width: number; height: number } }>;
  }>;
  layer2: Array<{
    groupId: string;
    unit: "glyph" | "word" | "line";
    wordIndex?: number;
    sourceLineText?: string;
    sourceLineIndex?: number;
    text: string;
    confidence: number;
    bounds: { x: number; y: number; width: number; height: number };
    streamBounds: { x: number; y: number; width: number; height: number };
    sourceReferences: Array<{ sourceItemId: string; fileName: string; sha256: string; captureTime?: string | null; bounds: { x: number; y: number; width: number; height: number } }>;
  }>;
  warnings: string[];
}
