function stripMaskPreview(trace) {
  if (!trace) return null;
  const { maskPreviews, ...diagnostic } = trace;
  return { ...diagnostic, maskPreviewsOmitted: Boolean(maskPreviews) };
}

function candidateTrace(candidate, source) {
  if (!candidate) return null;
  const record = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "cropDataUrl" && key !== "ocrDiagnosticTrace"));
  return {
    ...record,
    source,
    ocrDiagnosticTrace: stripMaskPreview(candidate.ocrDiagnosticTrace),
  };
}

function getCandidates(item) {
  if (item.category === "SLIP") {
    return item.data ? [candidateTrace({
      id: item.id,
      data: item.data,
      sourceBounds: item.sourceBounds,
      ocrTextBoxes: item.ocrTextBoxes,
      ocrDiagnosticTrace: item.ocrDiagnosticTrace,
      qrScanDiagnostic: item.qrScanDiagnostic,
      isConfirmed: item.isConfirmed,
      needsReview: !item.isConfirmed,
    }, { fileName: item.file?.name, sha256: item.meta?.sha256 })] : [];
  }
  return (item.embeddedSlips || []).map((candidate) => candidateTrace(candidate, {
    fileName: candidate.sourceFileName || item.file?.name,
    sha256: candidate.sourceSha256 || item.meta?.sha256,
    sourceReferences: candidate.sourceReferences || [],
    chatPageNumber: candidate.chatPageNumber,
    dossierPageNumber: candidate.dossierPageNumber,
  }));
}

function flattenDiagnostics(item) {
  const pages = item.chatEvidenceLayers || [];
  const traces = [
    item.ocrDiagnosticTrace,
    ...pages.map((page) => page.ocrDiagnosticTrace),
    ...(item.embeddedSlips || []).map((candidate) => candidate.ocrDiagnosticTrace),
  ].filter(Boolean);
  const qrScans = [
    item.qrScanDiagnostic,
    ...pages.map((page) => page.qrScanDiagnostic),
  ].filter(Boolean);
  return { traces, qrScans };
}

export function buildEvidenceDiagnosticTrace(stagedQueue, manifestList, generatedAt = new Date().toISOString()) {
  const items = stagedQueue.map((item) => {
    const { traces, qrScans } = flattenDiagnostics(item);
    const productionScans = qrScans.flatMap((scan) => scan.productionScans || []);
    const diagnosticScans = qrScans.flatMap((scan) => scan.scans || []);
    return {
      id: item.id,
      source: {
        fileName: item.meta?.file_name || item.file?.name || null,
        mimeType: item.meta?.mime_type || item.file?.type || null,
        sizeBytes: item.meta?.size_bytes ?? item.file?.size ?? null,
        sha256: item.meta?.sha256 || null,
      },
      category: item.category,
      detectedType: item.detectType || null,
      status: item.status,
      isDuplicate: Boolean(item.isDuplicate),
      duplicateOf: item.duplicateOfRef || null,
      extractionVersion: item.extractionVersion ?? null,
      error: item.error || null,
      warnings: item.processingWarnings || [],
      qrScanDiagnostics: qrScans,
      ocrDiagnosticTrace: stripMaskPreview(item.ocrDiagnosticTrace),
      chatPages: (item.chatEvidenceLayers || []).map((page) => ({
        ...page,
        ocrDiagnosticTrace: stripMaskPreview(page.ocrDiagnosticTrace),
      })),
      candidates: getCandidates(item),
      diagnosticCounts: {
        qrScanAttempts: productionScans.length + diagnosticScans.length,
        qrDecodedScans: productionScans.filter((attempt) => attempt.outcome === "decoded").length
          + diagnosticScans.filter((attempt) => attempt.decoded).length,
        qrProductionScanAttempts: productionScans.length,
        qrDiagnosticProbeAttempts: diagnosticScans.length,
        qrInputsObserved: qrScans.filter((scan) => Array.isArray(scan.productionScans)).length,
        qrInputsDecoded: qrScans.filter((scan) => Array.isArray(scan.productionScans) && scan.candidateCount > 0).length,
        qrDecoderErrors: productionScans.filter((attempt) => attempt.outcome === "error").length,
        qrLegacyDiagnosticInputs: qrScans.filter((scan) => !Array.isArray(scan.productionScans)).length,
        qrBounds: traces.reduce((sum, trace) => sum + (trace.qrBounds?.length || 0), 0),
        ocrAttempts: traces.reduce((sum, trace) => sum + (trace.attempts?.length || 0), 0),
        parsedRegions: traces.reduce((sum, trace) => sum + (trace.regions?.length || 0), 0),
        acceptedRegions: traces.reduce((sum, trace) => sum + (trace.regions || []).filter((region) => region.acceptedByCandidatePolicy).length, 0),
      },
    };
  });
  const candidates = items.flatMap((item) => item.candidates);
  const fieldCount = (getValue) => candidates.filter((candidate) => getValue(candidate.data)).length;
  const categoryCounts = Object.fromEntries(["CHAT", "SLIP", "PENDING"].map((category) => [
    category,
    items.filter((item) => item.category === category).length,
  ]));
  const statusCounts = Object.fromEntries(["done", "error", "staged", "processing"].map((status) => [
    status,
    items.filter((item) => item.status === status).length,
  ]));

  return {
    schema: "digital-evidence.extraction-diagnostic-trace.v1",
    generatedAt,
    extractionVersion: items.find((item) => item.extractionVersion !== null)?.extractionVersion ?? null,
    statistics: {
      inputImages: items.length,
      categoryCounts,
      statusCounts,
      duplicateOccurrences: items.filter((item) => item.isDuplicate).length,
      candidates: candidates.length,
      candidatesConfirmed: candidates.filter((candidate) => candidate.isConfirmed).length,
      candidatesNeedsReview: candidates.filter((candidate) => candidate.needsReview).length,
      amountPresent: fieldCount((data) => data?.transaction?.amount != null),
      referencePresent: fieldCount((data) => Boolean(data?.transaction?.reference_no)),
      senderNamePresent: fieldCount((data) => Boolean(data?.sender?.name)),
      receiverNamePresent: fieldCount((data) => Boolean(data?.receiver?.name)),
      qrScanAttempts: items.reduce((sum, item) => sum + item.diagnosticCounts.qrScanAttempts, 0),
      qrDecodedScans: items.reduce((sum, item) => sum + item.diagnosticCounts.qrDecodedScans, 0),
      qrProductionScanAttempts: items.reduce((sum, item) => sum + item.diagnosticCounts.qrProductionScanAttempts, 0),
      qrDiagnosticProbeAttempts: items.reduce((sum, item) => sum + item.diagnosticCounts.qrDiagnosticProbeAttempts, 0),
      qrInputsObserved: items.reduce((sum, item) => sum + item.diagnosticCounts.qrInputsObserved, 0),
      qrInputsDecoded: items.reduce((sum, item) => sum + item.diagnosticCounts.qrInputsDecoded, 0),
      qrDecoderErrors: items.reduce((sum, item) => sum + item.diagnosticCounts.qrDecoderErrors, 0),
      qrLegacyDiagnosticInputs: items.reduce((sum, item) => sum + item.diagnosticCounts.qrLegacyDiagnosticInputs, 0),
      ocrAttempts: items.reduce((sum, item) => sum + item.diagnosticCounts.ocrAttempts, 0),
      parsedRegions: items.reduce((sum, item) => sum + item.diagnosticCounts.parsedRegions, 0),
      acceptedRegions: items.reduce((sum, item) => sum + item.diagnosticCounts.acceptedRegions, 0),
      processingErrors: items.filter((item) => item.status === "error" || item.error).length,
    },
    manifestList,
    items,
  };
}
