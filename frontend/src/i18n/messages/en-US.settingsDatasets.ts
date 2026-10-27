// SPDX-License-Identifier: Apache-2.0
/**
 * Settings · Datasets tab: the **operation feedback** produced by `useSettingsDatasets`
 * (export/import receipts, the uncovered scope note, restored global model records and
 * fonts, switch/rename/delete/create toasts, and the attachment-problem confirmation).
 * Static copy for the datasets card lives in `en-US.datasets.ts`.
 *
 * Sentences are whole keys, and the clause separators are keys too: Chinese joins clauses
 * with the full-width comma while English needs a half-width one, so a hard-coded
 * separator in code would mix both punctuation styles on one screen. Counts, names and
 * sizes stay parameters (`{count}` / `{name}` / `{size}`) rather than string
 * concatenation.
 *
 * Every key here is evaluated when a handler runs, never at module scope, so the locale
 * is whatever is active at that moment.
 */
const settingsDatasets = {
  "settingsDatasets.load.failed": "Could not load the datasets",

  "settingsDatasets.partsSeparator": ", ",
  "settingsDatasets.problemSeparator": "; ",

  "settingsDatasets.uncovered.atLeast": "at least {count} items",
  "settingsDatasets.uncovered.count": "{count} items",
  "settingsDatasets.uncovered.size": " ({size})",
  "settingsDatasets.uncovered.summary":
    "Not included in this backup: {amount}{size}. They live in the data directory but not in this archive; see the uncovered section of manifest.json inside it.",

  "settingsDatasets.export.datasetDone": "Exported [{name}] to your browser's download folder",
  "settingsDatasets.export.allDone":
    "Exported all {count} datasets to your browser's download folder",
  "settingsDatasets.export.failed": "Could not export the dataset",
  "settingsDatasets.export.allFailed": "Could not export all datasets",
  "settingsDatasets.export.missingAttachments":
    "{count} referenced attachments are missing from disk, so the backup does not contain them",
  "settingsDatasets.export.mismatchedAttachments":
    "{count} attachments do not match what the database records, so the archive holds the bytes currently on disk",
  "settingsDatasets.export.incomplete": "{summary}, but this backup is incomplete: {problems}",
  "settingsDatasets.export.missingAtImport":
    "{count} more attachments were already missing when this dataset was imported; the manifest inside the archive notes them",

  "settingsDatasets.import.done": "Imported the dataset [{name}]",
  "settingsDatasets.import.extraDatasets": "and restored {count} other datasets from the archive",
  "settingsDatasets.import.extraNames": " ({names})",
  "settingsDatasets.import.extraNamesMore": " ({names} and others)",
  "settingsDatasets.import.namesSeparator": ", ",
  "settingsDatasets.import.apiKeyRestored": "the API keys in the backup were restored as well",
  "settingsDatasets.import.globalFailed":
    "the global model configuration could not be imported ({error})",
  "settingsDatasets.import.globalRestored": "restored {count} global model records",
  "settingsDatasets.import.globalSkipped": " ({count} with the same name skipped)",
  "settingsDatasets.import.globalKeptLocal":
    "kept the local version for {count} global model records with the same name",
  "settingsDatasets.import.fontsRestored": "restored {count} custom fonts",
  "settingsDatasets.import.fontsSkipped":
    "kept the local version of {count} fonts with the same name",
  "settingsDatasets.import.summaryOk": "{parts}; nothing in your current data was affected",
  "settingsDatasets.import.summaryIncomplete":
    "{parts}; nothing in your current data was affected, but this backup is incomplete: {problems}",
  "settingsDatasets.import.fallbackProblem": "attachments are missing or failed verification",
  "settingsDatasets.import.moreProblems": " ({count} in total)",
  "settingsDatasets.import.fontsIncomplete": "Fonts were not fully restored: {problems}",
  "settingsDatasets.import.failed": "Could not import the backup",
  "settingsDatasets.import.assetProblemTitle": "The backup's attachments have a problem",
  "settingsDatasets.import.assetProblemContent":
    "{error}\n\nYou can skip the problem attachments and import only the database content (the original files on this machine are not changed).",
  "settingsDatasets.import.skipAssets": "Skip attachments and continue",

  "settingsDatasets.switch.done": "Switched to [{name}]; reloading the page",
  "settingsDatasets.switch.failed": "Could not switch datasets",
  "settingsDatasets.rename.done": "Renamed",
  "settingsDatasets.rename.failed": "Could not rename the dataset",
  "settingsDatasets.delete.done": "Deleted [{name}]; you can recover it from data/datasets/.trash/",
  "settingsDatasets.delete.failed": "Could not delete the dataset",
  "settingsDatasets.delete.note":
    "The dataset leaves the list and the app offers no way to restore it; export a backup first.",
  "settingsDatasets.create.nameRequired": "Enter a dataset name",
  "settingsDatasets.create.done":
    "Created the dataset [{name}]; you can switch to it from the list",
  "settingsDatasets.create.failed": "Could not create the dataset",
} as const;

export default settingsDatasets;
