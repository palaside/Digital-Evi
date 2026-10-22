import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceContentPageDescriptors } from "../evidence-content-page-descriptors.mjs";

test("builds exact PDF marker descriptors for standalone slips and stitched chat page numbers", () => {
  const result = buildEvidenceContentPageDescriptors([
    { id: "slip-record", sourceItemId: "slip-item", chatPage: "-" },
    { id: "chat-record", sourceItemId: "stitched-child", chatPage: "7 / 10" },
  ], [
    { id: "slip-item", fileName: "slip.png", category: "SLIP" },
    { id: "stitched-owner", fileName: "chat-a.png", category: "CHAT", chatStreamPageNumbers: [1, 4, 7], chatSlices: ["a", "b", "c"] },
    { id: "stitched-child", fileName: "chat-b.png", category: "CHAT", stitchedIntoItemId: "stitched-owner" },
  ]);

  assert.deepEqual(result, {
    descriptors: [
      { key: "slip-record", source_file: "slip.png", page_label: "slip.png" },
      { key: "chat-record", source_file: "chat-a.png", page_label: "หน้าแชท 3 / 3" },
    ],
    unmappedRecordIds: [],
  });
});

test("does not guess page labels when a chat source page is absent from the exported stream", () => {
  const result = buildEvidenceContentPageDescriptors([
    { id: "chat-record", sourceItemId: "chat", chatPage: "8 / 9" },
  ], [{ id: "chat", fileName: "chat.png", category: "CHAT", chatStreamPageNumbers: [1, 2], chatSlices: ["a", "b"] }]);

  assert.deepEqual(result, { descriptors: [], unmappedRecordIds: ["chat-record"] });
});

test("assigns occurrence indexes to repeated standalone filenames in export order", () => {
  const result = buildEvidenceContentPageDescriptors([
    { id: "first-slip", sourceItemId: "slip-1", chatPage: "-" },
    { id: "second-slip", sourceItemId: "slip-2", chatPage: "-" },
  ], [
    { id: "slip-1", fileName: "same.png", category: "SLIP" },
    { id: "slip-2", fileName: "same.png", category: "SLIP" },
  ]);

  assert.deepEqual(result.descriptors, [
    { key: "first-slip", source_file: "same.png", page_label: "same.png", occurrence_index: 0 },
    { key: "second-slip", source_file: "same.png", page_label: "same.png", occurrence_index: 1 },
  ]);
});

test("maps a global hybrid chat page to its source-local PDF marker", () => {
  const result = buildEvidenceContentPageDescriptors([
    { id: "hybrid-slip", sourceItemId: "chat-77", chatPage: "3 / 3" },
  ], [
    { id: "chat-73", fileName: "chatv3 (73).jpg", category: "CHAT", chatStreamPageNumbers: [1, 2], chatSlices: ["first", "second"] },
    { id: "chat-77", fileName: "chatv3 (77).jpg", category: "CHAT", chatStreamPageNumbers: [3], chatSlices: ["slip"] },
  ]);

  assert.deepEqual(result, {
    descriptors: [{ key: "hybrid-slip", source_file: "chatv3 (77).jpg", page_label: "หน้าแชท 1 / 1" }],
    unmappedRecordIds: [],
  });
});
