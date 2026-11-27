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
    "Click any passage on the left, then edit it on the right. Text inside tables is not supported yet.",
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
  "externalEdit.scaled":
    "The new text was wider than the original block, so the font size was reduced automatically.",
  "externalEdit.shifted": "The content below has been moved down.",

  // ── Reasons a block is not editable (suffix = backend code) ─
  "externalEdit.reason.pdf_block_not_found": "This block no longer exists. Refresh and try again.",
  "externalEdit.reason.pdf_block_not_editable":
    "This block is not plain text (text inside tables, images or layout elements).",
  "externalEdit.reason.pdf_block_rotated":
    "This block is rotated or skewed; only horizontal text is supported.",
  "externalEdit.reason.pdf_block_missing_glyphs":
    "The font of this block has no glyphs for the new text.",
  "externalEdit.reason.pdf_page_rotated": "This page is rotated, which is not supported yet.",
  "externalEdit.reason.pdf_erase_failed":
    "The old glyphs could not be located inside the file, so the edit was aborted to avoid damaging the page.",
  "externalEdit.reason.pdf_edit_verify_failed":
    "The post-edit self-check failed (content below may have been overwritten), so nothing was saved.",
  "externalEdit.reason.pdf_parse_failed":
    "This PDF could not be parsed, so its text cannot be located.",
  "externalEdit.reason.pdf_encrypted": "This PDF is encrypted.",
  "externalEdit.reason.pdf_form_fields":
    "This PDF contains fillable form fields, which are not supported yet.",
  "externalEdit.reason.pdf_no_text_layer":
    "This PDF has no text layer (it is a scan or a pure image).",
  "externalEdit.reason.pdf_outlined_text":
    "The text of this PDF has been outlined into shapes, so it cannot be edited.",
  "externalEdit.reason.pdf_unsupported":
    "This PDF uses a format that is outside the supported range.",
  "externalEdit.reason.docx_text_in_table":
    "This passage is inside a table; editing it could break the table layout.",
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
  "externalEdit.revisions.sameFile": "Same content as current",
  "externalEdit.revisions.restore": "Restore this version",
  "externalEdit.revisions.restoreFailed": "Restore failed",
  "externalEdit.revisions.restored":
    "This version has been restored as a new version. Older versions are never deleted.",
  "externalEdit.revisions.source.upload": "Upload",
  "externalEdit.revisions.source.edit": "Edit",
  "externalEdit.revisions.source.restore": "Restore",
  "externalEdit.revisions.source.unknown": "Other",

  // ── Detail modal (T10) ───────────────────────────────────
  "externalEdit.detail.hint":
    "The original is always kept: editing saves a new version and never removes an older one.",

  // ── Original viewer toolbar (T10: pdf.js canvas + own toolbar) ─
  "externalEdit.original.loading": "Rendering the original pages…",
  "externalEdit.original.failed": "The original could not be rendered",
  "externalEdit.original.page": "Page {page} / {total}",
  "externalEdit.original.prev": "Previous page",
  "externalEdit.original.next": "Next page",
  "externalEdit.original.zoomIn": "Zoom in",
  "externalEdit.original.zoomOut": "Zoom out",
  "externalEdit.original.fitWidth": "Fit width",
  "externalEdit.original.zoom": "{percent}%",
  "externalEdit.original.scanHint":
    "This scan has no text layer: the page is shown as is, and in dark mode it is only dimmed, not inverted.",
  "externalEdit.original.darkHint":
    "In dark mode pages of text are inverted; photos inside the original keep their colours.",

  // ── Multi-format preview (T10: DOCX / TXT / MD / .doc) ───
  "externalEdit.preview.docxFooter":
    "Structural preview: rebuilt from Word paragraphs. Fonts, columns and charts will differ from the original.",
  "externalEdit.preview.markdownFooter":
    "Light preview: only headings, lists and bold are rendered.",
  "externalEdit.preview.textFooter":
    "The text is shown in a monospace font, keeping line breaks and spaces.",
  "externalEdit.preview.docHint":
    "Legacy .doc files cannot be previewed here. Open the file in Word, save it as .docx and upload it again.",
  "externalEdit.preview.empty": "This file has no paragraphs to show.",
  "externalEdit.preview.failed": "No previewable paragraphs could be read from this file",

  // ── Block-list editing (T11) ─────────────────────────────
  "externalEdit.blocks.count": "{editable} of {total} passages are editable",
  "externalEdit.block.roleTitle": "Heading",
  "externalEdit.block.roleBody": "Body",
  "externalEdit.block.locked": "Locked",
  "externalEdit.panel.original": "Original",
  "externalEdit.panel.newText": "Change to",
  "externalEdit.panel.origChars": "{count} characters originally",
  "externalEdit.panel.tooWide": "May be wider than the original block",
  "externalEdit.reset": "Reset",
  "externalEdit.success.title": "Version {version} created · {chars} characters",
  "externalEdit.success.titleNoVersion": "New version created · {chars} characters",
  "externalEdit.success.hint": "The original is untouched; the change lives in the new version.",
  "externalEdit.success.viewOriginal": "View the updated original",
  "externalEdit.success.viewText": "View the text",

  // ── Version history: preview / diff / confirmation (T12) ──
  "externalEdit.revisions.preview": "Preview",
  "externalEdit.revisions.previewHint":
    "The preview shows the original of that version and does not change the current one.",
  "externalEdit.revisions.previewCurrentHint":
    "The current version is the one on the Original tab.",
  "externalEdit.revisions.previewUnsupported":
    "This version can only be viewed after downloading it (non-PDF history is not previewed in the app).",
  "externalEdit.revisions.diff": "{delta} vs previous",
  "externalEdit.revisions.first": "First version",
  "externalEdit.revisions.confirmTitle": "Restore this version?",
  "externalEdit.revisions.confirmBody":
    "Its content is saved as a new version and becomes the current one. No version is ever deleted.",
  "externalEdit.revisions.confirmOk": "Restore",
  "externalEdit.revisions.confirmCancel": "Cancel",
  "externalEdit.revisions.compare": "Compare",
  "externalEdit.revisions.compareHint":
    "See the text of this version side by side with the current one.",

  // ── Original vs new comparison (T12) ──────────────────────
  "externalEdit.compare.left": "This version · {time}",
  "externalEdit.compare.right": "Current version",
  "externalEdit.compare.added": "{count} line(s) added",
  "externalEdit.compare.removed": "{count} line(s) removed",
  "externalEdit.compare.same": "Both versions have the same text",
  "externalEdit.compare.loading": "Loading the text of this version…",
  "externalEdit.compare.failed": "Could not load the text of this version",
  "externalEdit.compare.noText":
    "This version has no extracted text, so a line-by-line comparison is not possible; try the original preview.",
  "externalEdit.compare.tooLarge":
    "The text is too long (more than {limit} lines on one side), so the line-by-line comparison was skipped; use the original preview or restore directly.",
  "externalEdit.compare.restoreHint":
    "Restoring writes a new version; no earlier version is deleted.",

  // ── Viewing a past version (T12: text and preview follow it) ─
  "externalEdit.versionView.notice":
    "Viewing a past version ({time}). The current version is unchanged.",
  "externalEdit.versionView.noticeNoTime":
    "Viewing a past version. The current version is unchanged.",
  "externalEdit.versionView.back": "Back to current version",
  "externalEdit.versionView.textLoading": "Loading the text of this version…",
  "externalEdit.versionView.textFailed": "Could not load the text of this version",
  "externalEdit.versionView.noText": "This version has no extracted text.",

  // ── Edit page: original column (T11) ──────────────────────
  "externalEdit.blockPreview.title": "Original (current passage)",
  "externalEdit.blockPreview.page": "Page {page}",
  "externalEdit.blockPreview.textFoot":
    "This format has no page geometry, so only this passage is outlined here.",
};

export default externalEdit;
