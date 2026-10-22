export function buildEvidenceContentPageDescriptors(records, stagedItems) {
  const itemsById = new Map(stagedItems.map((item) => [item.id, item]));
  const descriptors = [];
  const unmappedRecordIds = [];

  const labelsFor = (candidate) => candidate.category === "CHAT" && candidate.chatSlices?.length
    ? candidate.chatSlices.map((_, index) => `หน้าแชท ${index + 1} / ${candidate.chatSlices.length}`)
    : [candidate.fileName];

  for (const record of records) {
    let item = itemsById.get(record.sourceItemId);
    if (item?.stitchedIntoItemId) item = itemsById.get(item.stitchedIntoItemId);
    if (!item?.fileName) {
      unmappedRecordIds.push(record.id);
      continue;
    }

    let pageLabel = item.fileName;
    if (record.chatPage !== "-") {
      const pageNumber = Number.parseInt(String(record.chatPage).split("/")[0].trim(), 10);
      const pageIndex = Number.isInteger(pageNumber) ? item.chatStreamPageNumbers?.indexOf(pageNumber) ?? -1 : -1;
      const pageCount = item.chatSlices?.length ?? 0;
      if (pageIndex < 0 || pageCount < 1) {
        unmappedRecordIds.push(record.id);
        continue;
      }
      pageLabel = `หน้าแชท ${pageIndex + 1} / ${pageCount}`;
    }

    let occurrenceIndex = 0;
    let matchingOccurrences = 0;
    let selectedOccurrenceIndex = -1;
    for (const candidate of stagedItems) {
      if (candidate.stitchedIntoItemId) continue;
      for (const candidateLabel of labelsFor(candidate)) {
        if (candidate.fileName !== item.fileName || candidateLabel !== pageLabel) continue;
        if (candidate.id === item.id) selectedOccurrenceIndex = occurrenceIndex;
        occurrenceIndex += 1;
        matchingOccurrences += 1;
      }
    }
    if (selectedOccurrenceIndex < 0) {
      unmappedRecordIds.push(record.id);
      continue;
    }

    const descriptor = {
      key: record.id,
      source_file: item.fileName,
      page_label: pageLabel,
    };
    if (matchingOccurrences > 1) descriptor.occurrence_index = selectedOccurrenceIndex;
    descriptors.push(descriptor);
  }

  return { descriptors, unmappedRecordIds };
}
