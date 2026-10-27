// SPDX-License-Identifier: Apache-2.0
/**
 * Closing batch of small display strings: CSV batch-import limits and failure
 * fallbacks, per-dataset import issues, the screen-reader labels of the section
 * reorder test harness, web form recognition prompts, and the settings skills
 * load fallback.
 *
 * These strings are read when called (during render or in event handlers) by
 * `useCsvFileBatch` / `datasetImportFeedback` / `profileReorderHarness.testkit` /
 * `useWebformParse` / `useSettingsSkills`; module scope only holds keys. Clause separators
 * are keys too: Chinese joins clauses with a full-width semicolon while English needs a
 * half-width one plus a space.
 */
const featuresMisc = {
  "featuresMisc.csvBatch.tooManyFiles": "Up to 10 CSV files at a time",
  "featuresMisc.csvBatch.tooManyRows":
    "More than 2000 rows in total; split the import into batches",
  "featuresMisc.csvBatch.parseFailed": "Could not parse the CSV file",
  "featuresMisc.csvBatch.commitFailed": "Import failed",

  "featuresMisc.datasetImport.failedSummary": "{count} datasets failed: {items}",
  "featuresMisc.datasetImport.skippedSummary": "{count} datasets skipped: {items}",
  "featuresMisc.datasetImport.failedRest": "; {count} more failed",
  "featuresMisc.datasetImport.skippedRest": "; {count} more skipped",
  "featuresMisc.datasetImport.item": "{name}: {reason}",
  "featuresMisc.datasetImport.unnamed": "Unnamed dataset",
  "featuresMisc.datasetImport.separator": "; ",

  "featuresMisc.profileReorder.dragAria": "Drag to reorder {label}",
  "featuresMisc.profileReorder.moveUpAria": "Move {label} up",
  "featuresMisc.profileReorder.moveDownAria": "Move {label} down",
  "featuresMisc.profileReorder.resetAria": "Reset {label}",

  "featuresMisc.webformParse.needInput":
    "Paste the web form text first, or add screenshots or documents",
  "featuresMisc.webformParse.emptyWarning":
    "No fillable fields were recognized. Check the pasted content or try a different wording.",
  "featuresMisc.webformParse.failed": "Could not recognize the web form details",

  "featuresMisc.settingsSkills.loadFailed": "Could not load skills",
} as const;

export default featuresMisc;
