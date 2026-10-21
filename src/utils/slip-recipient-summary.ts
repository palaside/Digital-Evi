import { removeThaiTitlePrefix } from "./recipient-name-normalization.mjs";
import type { SlipOcrDiagnosticTrace, SlipOcrTraceBounds } from "../types/slip-ocr-trace";

export interface DetectedSlipRecipientRecord {
  id: string;
  sourceItemId: string;
  sha256?: string;
  isConfirmed: boolean;
  chatPage: string;
  dossierPage: number | null;
  source: string;
  crop: string;
  bounds?: { x: number; y: number; width: number; height: number };
  ocrTextBoxes?: Array<{
    text: string;
    confidence: number;
    bounds: { x: number; y: number; width: number; height: number };
    classification?: "slip_evidence" | "chat_context" | "uncertain";
    reason?: string;
    supportsFields?: string[];
  }>;
  ocrDiagnosticTrace?: SlipOcrDiagnosticTrace;
  data: {
    receiver?: { name?: string | null; account_no?: string | null; bank?: string | null };
    confidence?: { receiver_name?: number | null };
    reviewed_fields?: string[];
    transaction?: { amount?: number | null };
    raw_text?: string[];
    warnings?: string[];
  };
}

export interface SlipRecipientSummaryRecord extends DetectedSlipRecipientRecord {
  amount: number | null;
  missingFields: string[];
  suggestedRecipientName?: string;
  suggestedFromOccurrenceId?: string;
  corroboratedRecipientName?: string;
  corroboratedFromOccurrenceId?: string;
  receiverNameNeedsReview: boolean;
  receiverNameOcrConflict: boolean;
  receiverNameManuallyReviewed: boolean;
}

export interface SlipRecipientGroup {
  key: string;
  name: string;
  totalAmount: number;
  amountCount: number;
  records: SlipRecipientSummaryRecord[];
}

export function summarizeDetectedSlipRecipients(records: DetectedSlipRecipientRecord[]) {
  const groups = new Map<string, SlipRecipientGroup>();
  const unassignedRecords: SlipRecipientSummaryRecord[] = [];

  const evidenceNameCandidates = new Map<string, Map<string, { name: string; occurrenceId: string }>>();
  const accountNameCandidates = new Map<string, Map<string, { name: string; occurrenceId: string; confidence: number }>>();
  for (const record of records) {
    if (hasUnresolvedRecipientNameRetryConflict(record) || hasManuallyReviewedRecipientName(record)) continue;
    const name = removeThaiTitlePrefix(record.data.receiver?.name).replace(/\s+/g, " ").trim();
    const evidenceKey = getExactEvidenceKey(record);
    if (!name) continue;
    const key = name.replace(/\s/g, "");
    if (evidenceKey) {
      const candidates: Map<string, { name: string; occurrenceId: string }> = evidenceNameCandidates.get(evidenceKey) ?? new Map();
      if (!candidates.has(key)) candidates.set(key, { name, occurrenceId: record.id });
      evidenceNameCandidates.set(evidenceKey, candidates);
    }

    const accountKey = getMaskedAccountKey(record.data.receiver?.account_no);
    if (!accountKey) continue;
    const accountCandidates = accountNameCandidates.get(accountKey) ?? new Map();
    accountCandidates.set(key, {
      name,
      occurrenceId: record.id,
      confidence: record.data.confidence?.receiver_name ?? 0,
    });
    accountNameCandidates.set(accountKey, accountCandidates);
  }

  for (const record of records) {
    const receiverNameOcrConflict = hasRecipientNameRetryConflict(record);
    const receiverNameManuallyReviewed = hasManuallyReviewedRecipientName(record);
    const receiverNameNeedsReview = (receiverNameOcrConflict && !receiverNameManuallyReviewed)
      || (receiverNameManuallyReviewed && !record.isConfirmed);
    const extractedName = (hasUnresolvedRecipientNameRetryConflict(record) ? "" : removeThaiTitlePrefix(record.data.receiver?.name))
      .replace(/\s+/g, " ")
      .trim();
    const evidenceCandidates = getExactEvidenceKey(record)
      ? evidenceNameCandidates.get(getExactEvidenceKey(record)!)
      : undefined;
    const accountCandidates = accountNameCandidates.get(getMaskedAccountKey(record.data.receiver?.account_no) ?? "");
    const suggestedName = !extractedName
      ? evidenceCandidates?.size === 1
        ? Array.from(evidenceCandidates.values())[0]
        : accountCandidates?.size === 1
          ? Array.from(accountCandidates.values())[0]
          : undefined
      : undefined;
    const corroboratingNames = new Map<string, { name: string; occurrenceId: string }>();
    if (extractedName && accountCandidates) {
      const currentKey = extractedName.replace(/\s/g, "");
      const currentConfidence = record.data.confidence?.receiver_name ?? 0;
      for (const [candidateKey, candidate] of accountCandidates) {
        if (candidateKey !== currentKey && candidate.occurrenceId !== record.id
          && candidate.confidence >= currentConfidence + 0.05) {
          corroboratingNames.set(candidateKey, candidate);
        }
      }
    }
    const corroboratedName = corroboratingNames.size === 1 ? Array.from(corroboratingNames.values())[0] : undefined;
    const name = extractedName;
    const key = name.replace(/\s/g, "");
    const rawAmount = record.data.transaction?.amount;
    const amount = typeof rawAmount === "number" && Number.isFinite(rawAmount) && rawAmount >= 0
      ? rawAmount
      : null;
    const missingFields = [
      ...(extractedName ? [] : ["ชื่อผู้รับ"]),
      ...(amount === null ? ["จำนวนเงิน"] : []),
    ];
    const summaryRecord: SlipRecipientSummaryRecord = {
      ...record,
      amount,
      missingFields,
      receiverNameNeedsReview,
      receiverNameOcrConflict,
      receiverNameManuallyReviewed,
      ...(corroboratedName ? {
        corroboratedRecipientName: corroboratedName.name,
        corroboratedFromOccurrenceId: corroboratedName.occurrenceId,
      } : {}),
      ...(!extractedName && suggestedName ? {
        suggestedRecipientName: suggestedName.name,
        suggestedFromOccurrenceId: suggestedName.occurrenceId,
      } : {}),
    };

    if (!key) {
      unassignedRecords.push(summaryRecord);
      continue;
    }

    const group = groups.get(key) ?? {
      key,
      name,
      totalAmount: 0,
      amountCount: 0,
      records: [],
    };
    group.records.push(summaryRecord);
    if (amount !== null) {
      group.totalAmount += amount;
      group.amountCount += 1;
    }
    groups.set(key, group);
  }

  return {
    groups: Array.from(groups.values()),
    unassignedRecords,
    detectedSlipCount: records.length,
  };
}

function hasRecipientNameRetryConflict(record: DetectedSlipRecipientRecord): boolean {
  return record.data.warnings?.some((warning) => warning.includes("OCR ตรวจชื่อผู้รับซ้ำแล้วได้ผลต่างกัน")) ?? false;
}

function hasManuallyReviewedRecipientName(record: DetectedSlipRecipientRecord): boolean {
  return !!record.data.receiver?.name?.trim() && record.data.reviewed_fields?.includes("receiver_name") === true;
}

function hasUnresolvedRecipientNameRetryConflict(record: DetectedSlipRecipientRecord): boolean {
  return hasRecipientNameRetryConflict(record)
    && !hasManuallyReviewedRecipientName(record)
    && !hasSlipSupportedRecipientName(record);
}

function hasSlipSupportedRecipientName(record: DetectedSlipRecipientRecord): boolean {
  const name = normalizeOcrName(record.data.receiver?.name);
  const attempts = record.ocrDiagnosticTrace?.attempts;
  if (!name || !attempts) return false;

  return (record.ocrTextBoxes ?? []).some((box) => {
    if (box.classification !== "slip_evidence" || !box.supportsFields?.includes("receiver_name")
      || normalizeOcrName(box.text) !== name || box.confidence < 0.9) return false;

    const matchingLine = (scope: "qr_crop" | "full_page") => attempts
      .filter((attempt) => attempt.scope === scope && attempt.trigger === "initial")
      .flatMap((attempt) => attempt.lines)
      .find((line) => normalizeOcrName(line.text) === name && line.confidence >= 90
        && overlapsSameTextBox(box.bounds, line.bounds));
    const cropLine = matchingLine("qr_crop");
    const pageLine = matchingLine("full_page");
    if (!cropLine || !pageLine) return false;

    const supportedConfidence = Math.min(box.confidence * 100, cropLine.confidence, pageLine.confidence);
    return !attempts.some((attempt) => attempt.scope === "recipient_retry" && attempt.lines.some((line) =>
      overlapsSameTextBox(box.bounds, line.bounds)
      && normalizeOcrName(line.text) !== name
      && line.confidence >= supportedConfidence));
  });
}

function normalizeOcrName(value?: string | null): string {
  return removeThaiTitlePrefix(value).replace(/\s+/gu, "").trim();
}

function overlapsSameTextBox(a: SlipOcrTraceBounds, b: SlipOcrTraceBounds): boolean {
  const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const smallerArea = Math.min(a.width * a.height, b.width * b.height);
  return smallerArea > 0 && overlapWidth * overlapHeight / smallerArea >= 0.75;
}

function getMaskedAccountKey(value?: string | null): string | null {
  if (!value) return null;
  const account = value.match(/[xX]{2,}(?:-[xX\d]+){2,}/)?.[0];
  return account ? account.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;
}

function getExactEvidenceKey(record: DetectedSlipRecipientRecord): string | null {
  if (!record.sha256 || !record.bounds) return null;
  const page = record.chatPage.split("/")[0]?.trim();
  if (!page || page === "-") return null;
  const { x, y, width, height } = record.bounds;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return JSON.stringify([record.sha256, page, x, y, width, height]);
}
