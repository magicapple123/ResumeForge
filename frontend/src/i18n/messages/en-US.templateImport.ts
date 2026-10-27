// SPDX-License-Identifier: Apache-2.0
/**
 * "Import a reference template" dialog: upload, recognition, fine-tuning and saving.
 *
 * Two spots are intentionally left in the legacy CJK baseline: the `source_names.join("、")`
 * value is persisted as `source_name` and shown back for a long time (the separator is part
 * of the stored format), and the separators between `evidence` / `warnings` items are pure
 * presentation, so they moved to the `separator.*` keys.
 */
const templateImport = {
  "templateImport.title.import": "Import a reference template",
  "templateImport.title.edit": "Fine-tune the imported template",
  "templateImport.action.analyze": "Recognize and preview",
  "templateImport.action.saveAsMine": "Save as my template",
  "templateImport.intro":
    "Upload a resume screenshot or document you want to copy the look of. The result goes to the editor first and is only saved after you confirm it; existing templates are never overwritten.",
  "templateImport.upload.text": "Click to choose, or drag files in",
  "templateImport.upload.hint":
    "Up to {count} PNG / JPG / WEBP images or PDF / DOCX files, {single} MB each and {total} MB in total",
  "templateImport.field.name": "Template name (optional - the model names it)",
  "templateImport.placeholder.name": "e.g. Deep blue minimal",
  "templateImport.aria.name": "Template name",
  "templateImport.draft.recognized": "Initial recognition finished",
  "templateImport.draft.evidenceTitle": "Recognition basis",
  "templateImport.draft.noEvidence": "The model returned no explainable basis",
  "templateImport.draft.exportNote":
    "HTML preview and HTML export use the full styling; PDF / Word apply the generic parameters such as colour, font size, line height and margins, but cannot fully reproduce custom two-column layouts, label images or arbitrary CSS. Check the exported file.",
  "templateImport.aria.confidence": "Recognition confidence",
  "templateImport.draft.confidenceTitle": "Recognition confidence:",
  "templateImport.draft.noConfidence": "Not provided by the model",
  "templateImport.draft.previewFailedTitle": "Preview failed",
  "templateImport.draft.previewTitle": "Imported template preview",
  "templateImport.draft.previewing": "Generating the preview…",
  "templateImport.model.title": "Recognition needs a configured model",
  "templateImport.model.body":
    "The reference images are sent to the model you configured; mask real names, phone numbers or emails first. PDF / DOCX source text stays on this machine - only locally generated, redacted structure statistics are sent. The result is previewed and fine-tuned before it is saved as a template.",
  "templateImport.separator.item": "; ",
  "templateImport.separator.period": ". ",
  "templateImport.toast.needFile": "Choose a reference template file first",
  "templateImport.toast.analyzed":
    "Recognition finished - check the preview on the right, fine-tune it, then save",
  "templateImport.toast.saved": 'Saved the template "{name}"',
  "templateImport.error.previewFailed": "Could not render the preview",
  "templateImport.error.importFailed": "Import failed, try again later",
  "templateImport.error.fileTooLarge": "A file cannot exceed {size} MB - compress it and try again",
  "templateImport.error.totalTooLarge": "Reference template files cannot exceed {size} MB in total",
} as const;

export default templateImport;
