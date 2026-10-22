export function reconcilePageOcrNamesIntoQrCandidates(qrCandidates, pageCandidates) {
  return qrCandidates.map((qrCandidate) => {
    const matches = pageCandidates.filter((pageCandidate) => isSameSlipEvidence(qrCandidate, pageCandidate));
    if (matches.length !== 1) return qrCandidate;

    const pageCandidate = matches[0];
    const pageName = pageCandidate.data?.receiver?.name?.trim();
    const qrName = qrCandidate.data?.receiver?.name?.trim();
    if (!pageName || !qrName || normalizeName(pageName) === normalizeName(qrName)) return qrCandidate;

    const cropConfidence = qrCandidate.data.confidence?.receiver_name ?? 0;
    const pageConfidence = pageCandidate.data.confidence?.receiver_name ?? 0;
    const usePageName = pageConfidence >= cropConfidence + 0.05;
    const pageNameBoxes = pageCandidate.ocrTextBoxes?.filter((box) => box.supportsFields?.includes("receiver_name")) ?? [];
    return {
      ...qrCandidate,
      data: {
        ...qrCandidate.data,
        receiver: { ...qrCandidate.data.receiver, name: usePageName ? pageName : qrName },
        confidence: {
          ...qrCandidate.data.confidence,
          receiver_name: usePageName ? pageConfidence : cropConfidence,
        },
        raw_text: [...new Set([...(qrCandidate.data.raw_text ?? []), ...(pageCandidate.data.raw_text ?? [])])],
        warnings: [...new Set([
          ...(qrCandidate.data.warnings ?? []),
          "OCR ตรวจชื่อผู้รับซ้ำแล้วได้ผลต่างกัน ต้องตรวจจากภาพต้นฉบับ",
          usePageName
            ? "ชื่อผู้รับใน candidate ใช้ผล OCR เต็มหน้าที่จับคู่กับสลิปเดียวกันด้วยกรอบและข้อมูลรายการ"
            : "ชื่อผู้รับใน candidate คงผล OCR กรอบสลิปที่ความมั่นใจสูงกว่า OCR เต็มหน้า; ต้องตรวจจากภาพ",
        ])],
      },
      ...(usePageName && pageNameBoxes.length ? {
        ocrTextBoxes: [
          ...(qrCandidate.ocrTextBoxes ?? []).filter((box) => !box.supportsFields?.includes("receiver_name")),
          ...pageNameBoxes,
        ],
      } : {}),
    };
  });
}

function isSameSlipEvidence(left, right) {
  const overlap = intersectionOverSmallerArea(left.bounds, right.bounds);
  if (overlap < 0.5) return false;

  const leftData = left.data ?? {};
  const rightData = right.data ?? {};
  const leftAmount = leftData.transaction?.amount;
  const rightAmount = rightData.transaction?.amount;
  if (typeof leftAmount !== "number" || leftAmount <= 0 || leftAmount !== rightAmount) return false;

  const leftDate = leftData.transaction?.date;
  const rightDate = rightData.transaction?.date;
  if (leftDate && rightDate && leftDate !== rightDate) return false;

  const sameReference = leftData.transaction?.reference_no && rightData.transaction?.reference_no
    && normalizeIdentifier(leftData.transaction.reference_no) === normalizeIdentifier(rightData.transaction.reference_no);
  const sameReceiverAccount = leftData.receiver?.account_no && rightData.receiver?.account_no
    && normalizeIdentifier(leftData.receiver.account_no) === normalizeIdentifier(rightData.receiver.account_no);
  return Boolean(sameReference || sameReceiverAccount);
}

function intersectionOverSmallerArea(left, right) {
  if (!left || !right) return 0;
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const intersection = width * height;
  const smaller = Math.min(left.width * left.height, right.width * right.height);
  return smaller > 0 ? intersection / smaller : 0;
}

function normalizeIdentifier(value) {
  return String(value).replace(/[^\p{L}\p{N}]/gu, "").toLocaleLowerCase();
}

function normalizeName(value) {
  return String(value).replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}
