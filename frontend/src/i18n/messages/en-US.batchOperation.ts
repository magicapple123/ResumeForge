// SPDX-License-Identifier: Apache-2.0
/** Settings "Batch operations": two independent parameter sets (generation / export), saved on change. */
const batchOperation = {
  "batchOperation.title": "Batch operations",
  "batchOperation.group.hint":
    "Two independent parameter sets; changes are saved automatically and apply immediately",
  "batchOperation.loadFailed": "Could not read the batch operation parameters",
  "batchOperation.generation.title": "Bulk resume generation",
  "batchOperation.generation.intro":
    "Defaults for the Job board's bulk AI resume generation: one resume per job. Starting a bulk run opens a card where you can change this batch only; changes here are the defaults for next time.",
  "batchOperation.export.title": "Bulk resume export",
  "batchOperation.export.intro":
    "Defaults for the Resume center's bulk export: packs the selected resumes into one zip with this layout. Starting a bulk export opens a card where you can change this batch only; changes here are the defaults for next time.",
  "batchOperation.status.pending": "Change any field to enable this set",
  "batchOperation.status.saving": "Saving…",
  "batchOperation.status.saved": "Saved automatically",
  "batchOperation.status.error": "Save failed; it will retry on the next change",
  "batchOperation.field.template": "Template",
  "batchOperation.field.fontScale": "Font size",
  "batchOperation.field.pageLimit": "Page limit",
  "batchOperation.field.language": "Field language",
  "batchOperation.field.exportFormat": "Export format",
  "batchOperation.field.enhance": "AI polish",
  "batchOperation.field.enhancementLevel": "Polish strength",
  "batchOperation.field.customInstruction": "Extra requirements",
  "batchOperation.field.customInstructionPlaceholder":
    "For example: highlight backend performance work; avoid filler like “responsible for”",
  "batchOperation.field.optional": "optional",
  "batchOperation.hint.layout":
    "Template, font size and page limit apply only to this card's action.",
  "batchOperation.modal.title.generation": "Bulk generate · this batch",
  "batchOperation.modal.title.export": "Bulk export · this batch",
  "batchOperation.modal.count.generation": "Generates one resume for each of the {count} jobs",
  "batchOperation.modal.count.export": "Exports {count} resumes",
  "batchOperation.modal.start.generation": "Start generating",
  "batchOperation.modal.start.export": "Start exporting",
  "batchOperation.modal.defaults": "Defaults are in use; start now or adjust first",
  "batchOperation.modal.exportLimit": "Up to {limit} at a time; please export in batches",
  "batchOperation.modal.scope":
    "Changes here apply to this batch only and do not touch the saved defaults.",
  "batchOperation.floating.running.resume": "Generating resumes {done}/{total} · current: {title}",
  "batchOperation.floating.running.analysis": "Analyzing jobs {done}/{total} · current: {title}",
  "batchOperation.floating.view": "View",
  "batchOperation.floating.stop": "Stop",
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
