export function shouldBuildChatEvidenceLayers(jobKind) {
  return jobKind === "CHAT";
}

function isHighConfidenceStructuredSlipRegion(region) {
  if (!(typeof region.amount === "number" && Number.isFinite(region.amount) && region.amount > 0)
    || region.amountConfidence < 0.85
    || typeof region.bankName !== "string"
    || !region.bankName.trim()
    || region.bankConfidence < 0.8
    || typeof region.referenceNo !== "string"
    || region.referenceNo.replace(/[^\p{L}\p{N}]/gu, "").length < 10
    || region.referenceConfidence < 0.8
    || typeof region.date !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/u.test(region.date)
    || region.dateConfidence < 0.8
    || typeof region.time !== "string"
    || !/^\d{2}:\d{2}$/u.test(region.time)
    || region.timeConfidence < 0.8
    || typeof region.rawText !== "string") return false;

  const normalized = region.rawText.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
  return /โอนเงิน.{0,8}(?:เร็จ|เรือ)|โอน.{0,8}ส[ํำ]าเร็จ|transfer.{0,12}success/u.test(normalized)
    && /(?:รหัส|เลขที่)อ้างอ.{0,2}ง|reference|transactionid/u.test(normalized);
}

function isStrongPartialSlipRegion(region) {
  if (!(typeof region.amount === "number" && Number.isFinite(region.amount) && region.amount > 0)
    || typeof region.referenceNo !== "string"
    || region.referenceNo.replace(/[^\p{L}\p{N}]/gu, "").length < 14
    || region.referenceConfidence < 0.8
    || typeof region.rawText !== "string") return false;

  const normalized = region.rawText.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase();
  const hasReferenceCue = /(?:รหัส|เลขที่)อ้างอ.{0,2}ง|reference|transactionid/u.test(normalized);
  const hasSuccessCue = /โอนเงิน.{0,8}(?:เร็จ|เรือ)|โอน.{0,8}ส[ํำ]าเร็จ|transfer.{0,12}success/u.test(normalized);
  if (!hasReferenceCue) return false;
  if (hasSuccessCue) return true;

  const hasLabeledBahtAmount = /(?:[จขอ][ํำ]านวน(?:เง[ิี]?น|เว[ิี]น)|ยอดเงิน|amount)/u.test(normalized)
    && /(?:บาท|thb|฿)/u.test(normalized);
  if (!hasLabeledBahtAmount) return false;
  if (region.amountConfidence >= 0.7) {
    const hasBankContext = typeof region.bankName === "string"
      && !!region.bankName.trim()
      && region.bankConfidence >= 0.75;
    const hasDateTimeContext = typeof region.date === "string"
      && /^\d{4}-\d{2}-\d{2}$/u.test(region.date)
      && typeof region.time === "string"
      && /^\d{2}:\d{2}$/u.test(region.time);
    return hasBankContext || hasDateTimeContext;
  }

  // A low-confidence grouped OCR line needs multiple independent fields before it can enter review.
  const hasBankContext = typeof region.bankName === "string"
    && !!region.bankName.trim()
    && region.bankConfidence >= 0.8;
  const hasDateTimeContext = typeof region.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/u.test(region.date)
    && region.dateConfidence >= 0.8
    && typeof region.time === "string"
    && /^\d{2}:\d{2}$/u.test(region.time)
    && region.timeConfidence >= 0.8;
  if (!hasBankContext || !hasDateTimeContext) return false;
  return true;
}

function hasStrongOverlap(region, bounds, minimumRatio) {
  const overlapWidth = Math.max(0, Math.min(region.x1, bounds.x + bounds.width) - Math.max(region.x0, bounds.x));
  const overlapHeight = Math.max(0, Math.min(region.y1, bounds.y + bounds.height) - Math.max(region.y0, bounds.y));
  const regionArea = Math.max(1, (region.x1 - region.x0) * (region.y1 - region.y0));
  return overlapWidth * overlapHeight / regionArea >= minimumRatio;
}

/**
 * @template {{ bounds: { x0: number; y0: number; x1: number; y1: number } }} T
 * @param {T[]} regions
 * @param {{ jobKind: "CHAT" | "SLIP"; visualCandidates?: Array<{ objectTypeCandidate?: string; bounds: { x: number; y: number; width: number; height: number } }>; qrCandidates?: Array<{ bounds: { x: number; y: number; width: number; height: number } }> }} options
 * @returns {T[]}
 */
export function filterTextOnlySlipRegionsForJob(regions, {
  jobKind,
  visualCandidates = [],
  qrCandidates = [],
}) {
  if (jobKind !== "CHAT") return regions;

  return regions.filter((region) => {
    const { x0, y0, x1, y1 } = region.bounds;
    const hasQrAnchor = qrCandidates.some(({ bounds }) => {
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      return centerX >= x0 && centerX <= x1 && centerY >= y0 && centerY <= y1;
    });
    if (hasQrAnchor) return true;

    const hasSlipLikeOcr = isHighConfidenceStructuredSlipRegion(region) || isStrongPartialSlipRegion(region);
    if (!hasSlipLikeOcr) return false;
    const regionArea = Math.max(1, (x1 - x0) * (y1 - y0));
    return visualCandidates.some(({ objectTypeCandidate, bounds }) => {
      const overlapWidth = Math.max(0, Math.min(x1, bounds.x + bounds.width) - Math.max(x0, bounds.x));
      const overlapHeight = Math.max(0, Math.min(y1, bounds.y + bounds.height) - Math.max(y0, bounds.y));
      const overlapRatio = overlapWidth * overlapHeight / regionArea;
      if (/^image(?:_|$)/u.test(objectTypeCandidate || "")) return overlapRatio >= 0.5;
      return objectTypeCandidate === "text_bubble_candidate"
        && overlapRatio >= 0.75
        && bounds.width >= 150
        && bounds.height >= bounds.width * 1.15
        && bounds.height <= bounds.width * 2.5
        && region.amountConfidence >= 0.7
        && !!(region.senderAccount || region.receiverAccount);
    });
  });
}
