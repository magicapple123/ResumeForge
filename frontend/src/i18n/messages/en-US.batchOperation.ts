// SPDX-License-Identifier: Apache-2.0
/** Settings "Batch operations": two independent parameter sets (generation / export), saved on change. */
const batchOperation = {
  "batchOperation.title": "Batch operations",
  "batchOperation.group.hint":
    "Two independent parameter sets; changes are saved automatically and apply immediately",
  "batchOperation.loadFailed": "Could not read the batch operation parameters",
  "batchOperation.generation.title": "Bulk resume generation",
  "batchOperation.generation.intro":
    "Used by the Job board's bulk AI resume generation: one resume per job. Changes are saved automatically and apply immediately.",
  "batchOperation.export.title": "Bulk resume export",
  "batchOperation.export.intro":
    "Used by the Resume center's bulk export: packs the selected resumes into one zip with this layout. Changes are saved automatically and apply immediately.",
  "batchOperation.status.pending": "Change any field to enable this set",
  "batchOperation.status.saving": "Saving…",
  "batchOperation.status.saved": "Saved automatically",
  "batchOperation.status.error": "Save failed; it will retry on the next change",
  "batchOperation.field.template": "Template",
  "batchOperation.field.fontScale": "Font size",
  "batchOperation.field.pageLimit": "Page limit",
  "batchOperation.field.language": "Resume language",
  "batchOperation.field.exportFormat": "Export format",
  "batchOperation.field.enhance": "AI polish",
  "batchOperation.field.enhancementLevel": "Polish strength",
  "batchOperation.field.customInstruction": "Extra requirements",
  "batchOperation.field.customInstructionPlaceholder":
    "For example: highlight backend performance work; avoid filler like “responsible for”",
  "batchOperation.field.optional": "optional",
  "batchOperation.hint.layout":
    "Template, font size and page limit apply only to this card's action.",
  "batchOperation.guard.title": "Finish batch settings first",
  "batchOperation.guard.body.generation":
    "The bulk generation parameters are not enabled yet. Open Settings → Appearance & interaction → Batch operations and visit this card; any change is saved automatically. You can also accept the defaults and try again.",
  "batchOperation.guard.body.export":
    "The bulk export parameters are not enabled yet. Open Settings → Appearance & interaction → Batch operations and visit this card; any change is saved automatically. You can also accept the defaults and try again.",
  "batchOperation.guard.go": "Open settings",
  "batchOperation.export.running": "Exporting…",
  "batchOperation.export.done": "Exported {count} resumes",
  "batchOperation.export.skipped": "Exported {exported}, skipped {skipped}: {detail}",
  "batchOperation.export.failed": "Bulk export failed",
  "batchOperation.pageLimit.unit": "pages",
  "batchOperation.language.zh": "Chinese",
  "batchOperation.language.en": "English",
  "batchOperation.format.pdf": "PDF",
  "batchOperation.format.docx": "Word (docx)",
  "batchOperation.format.html": "HTML",
  "batchOperation.format.md": "Markdown",
  "batchOperation.enhance.off": "No polish",
  "batchOperation.enhance.light": "Light polish",
  "batchOperation.enhance.balanced": "Balanced polish",
  "batchOperation.enhance.strong": "Deep polish",
} as const;

export default batchOperation;
