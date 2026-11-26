// SPDX-License-Identifier: Apache-2.0
/**
 * English copy for in-app editing and version history of an external resume (issue #5).
 *
 * Key set and placeholders mirror `zh-CN.externalEdit.ts` one to one; the suffix of
 * `externalEdit.reason.*` and `externalEdit.revisions.source.*` is the backend protocol
 * value, so those keys are never renamed on this side.
 */

const externalEdit = {
  // ── Tabs ───────────────────────────────────────────────────
  "externalEdit.tab.edit": "Edit",
  "externalEdit.tab.revisions": "Version history",

  // ── Loading the edit units / capability probe ──────────────
  "externalEdit.blocksLoading": "Checking what can be edited in this file…",
  "externalEdit.blocksFailed": "Could not read the editable units of this file",
  "externalEdit.blocksFailedHint":
    "The network or the service may be temporarily unavailable. The original file is untouched, so you can retry.",
  // 404 gets its own wording: the original file really is gone, and saying
  // "the original file is untouched" there would contradict itself.
  "externalEdit.blocksMissingTitle": "The original file is no longer on this machine",
  "externalEdit.blocksMissingHint":
    "The original file of this resume is gone from this machine (it may have been moved or deleted), so it cannot be edited here. Upload this resume again, or open Version history and download a version that still works.",
  "externalEdit.blocksEmpty": "No editable text was found in this file",
  "externalEdit.unsupported.title": "This file cannot be edited in the app",
  "externalEdit.unsupported.hint":
    "Scanned files, PDFs with outlined (vectorised) text, encrypted PDFs and PDFs with form fields cannot be edited here. Download the original, edit it with a local tool, then upload it again.",
  "externalEdit.download": "Download original",
  "externalEdit.blockWarnings": "Read these notes before editing",
  "externalEdit.previewLoading": "Rendering the original pages…",
  "externalEdit.previewFailed": "The original pages could not be rendered",

  // ── Left side: selection ───────────────────────────────────
  "externalEdit.hint.pdf":
    "The original page is on the left. Click the passage you want to change (dashed blocks cannot be edited; the reason is listed below). Then press Apply on the right.",
  "externalEdit.hint.docx":
    "The passages are listed here. Click one to edit it on the right. Text inside tables is not supported yet.",
  "externalEdit.hint.text": "The whole document is one editable unit. Edit it on the right.",
  "externalEdit.hint.pick": "Click a passage on the left first, then edit it on the right.",
  "externalEdit.block.label": "Page {page} · passage {index}",
  "externalEdit.block.labelNoPage": "Passage {index}",
  "externalEdit.block.empty": "(this passage has no text)",
  "externalEdit.notEditableTitle": "This block cannot be edited",
  "externalEdit.notEditableList": "These blocks cannot be edited (the reason is shown)",

  // ── Right side: form ──────────────────────────────────────
  "externalEdit.textarea.label": "New text",
  "externalEdit.textarea.placeholder": "Press Apply to save the change as a new version",
  "externalEdit.chars": "{count} characters",
  "externalEdit.fontSize": "{size} pt type",
  "externalEdit.apply": "Apply",
  "externalEdit.unchanged": "No change yet",
  "externalEdit.emptyText": "The text cannot be empty. To remove this passage, use a local tool.",
  "externalEdit.applyFailed": "The change was not applied",
  "externalEdit.keepFormatHint":
    "PDF editing overwrites the text in place: the system Chinese font is used instead of the original one, the block re-wraps to its original width, and the page count and everything else stay the same.",
  "externalEdit.overflow.title": "The new text is taller and overlaps the content below",
  "externalEdit.overflow.body":
    "This passage went from {before} lines to {after} lines and grew by {delta} pt. Shorten it, or move the content below down.",
  "externalEdit.shift.action": "Move the content below down by {delta} pt",
  "externalEdit.scaled": "The new text was wider than the original block, so the font size was reduced automatically.",
  "externalEdit.shifted": "The content below has been moved down.",

  // ── Reasons a block is not editable (suffix = backend code) ─
  "externalEdit.reason.pdf_block_not_found": "This block no longer exists. Refresh and try again.",
  "externalEdit.reason.pdf_block_not_editable":
    "This block is not plain text (text inside tables, images or layout elements).",
  "externalEdit.reason.pdf_block_rotated": "This block is rotated or skewed; only horizontal text is supported.",
  "externalEdit.reason.pdf_block_missing_glyphs": "The font of this block has no glyphs for the new text.",
  "externalEdit.reason.pdf_page_rotated": "This page is rotated, which is not supported yet.",
  "externalEdit.reason.pdf_erase_failed":
    "The old glyphs could not be located inside the file, so the edit was aborted to avoid damaging the page.",
  "externalEdit.reason.pdf_edit_verify_failed":
    "The post-edit self-check failed (content below may have been overwritten), so nothing was saved.",
  "externalEdit.reason.pdf_parse_failed": "This PDF could not be parsed, so its text cannot be located.",
  "externalEdit.reason.pdf_encrypted": "This PDF is encrypted.",
  "externalEdit.reason.pdf_form_fields": "This PDF contains fillable form fields, which are not supported yet.",
  "externalEdit.reason.pdf_no_text_layer": "This PDF has no text layer (it is a scan or a pure image).",
  "externalEdit.reason.pdf_outlined_text": "The text of this PDF has been outlined into shapes, so it cannot be edited.",
  "externalEdit.reason.pdf_unsupported": "This PDF uses a format that is outside the supported range.",
  "externalEdit.reason.docx_text_in_table": "This passage is inside a table; editing it could break the table layout.",
  "externalEdit.reason.docx_paragraph_not_editable":
    "This passage has no editable text (image, blank paragraph or field code).",
  "externalEdit.reason.edit_unsupported_kind": "This file type cannot be edited in the app.",
  "externalEdit.reason.unknown": "This block cannot be edited in the app.",

  // ── Version history ──────────────────────────────────────
  "externalEdit.revisions.loading": "Loading version history…",
  "externalEdit.revisions.failed": "Could not load the version history",
  "externalEdit.revisions.empty": "No earlier versions: this file only has its current version.",
  "externalEdit.revisions.chars": "{count} characters",
  "externalEdit.revisions.hasText": "Text extracted",
  "externalEdit.revisions.noText": "No text extracted",
  "externalEdit.revisions.current": "Current version",
  "externalEdit.revisions.restore": "Restore this version",
  "externalEdit.revisions.restoreFailed": "Restore failed",
  "externalEdit.revisions.restored":
    "This version has been restored as a new version. Older versions are never deleted.",
  "externalEdit.revisions.source.upload": "Upload",
  "externalEdit.revisions.source.edit": "Edit",
  "externalEdit.revisions.source.restore": "Restore",
  "externalEdit.revisions.source.unknown": "Other",
};

export default externalEdit;
