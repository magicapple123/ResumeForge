// SPDX-License-Identifier: Apache-2.0
/** 数据集卡片（与 zh-CN.datasets.ts 一一对应）。 */
const datasets = {
  "datasets.card.title": "Datasets",
  "datasets.action.create": "New empty dataset",
  "datasets.action.import": "Import backup as a new dataset",
  "datasets.action.exportCurrent": "Export current dataset",
  "datasets.action.exportAll": "Export all datasets",
  "datasets.action.export": "Export",
  "datasets.action.switch": "Switch",
  "datasets.action.rename": "Rename",
  "datasets.action.delete": "Delete",
  "datasets.intro":
    "Each dataset is a complete ResumeForge database (Jobs, Profile, Resumes, favorites, assistant conversations and every attachment). You can switch between them at any time and they never affect each other. Importing a backup only adds a dataset — the one you are using is untouched; exported backups include the global model configuration and its API keys by default, and you can untick that.",
  "datasets.option.globalConfig":
    "Include the global model configuration and API keys (all saved records) in the backup",
  "datasets.hint.globalConfig":
    "Ticked by default. The global model configuration lives in `global_settings.json` in the data directory, not inside any dataset's database; when ticked it is exported as a separate section and merged back into this machine on import (records with the same name and existing local content keep the local version).",
  "datasets.hint.apiKey":
    "Ticked by default. API keys follow this option: when ticked they are written in the form this machine stores them (encrypted by the OS on Windows, bound to the current user and this computer — you may need to re-enter them after restoring elsewhere; plain text in the archive on macOS/Linux). When unticked, neither configuration nor keys are included. A backup with keys is more sensitive — keep it safe and do not send it to anyone you do not trust.",
  "datasets.hint.fonts":
    "Custom fonts (in `data/fonts/` of the data directory) travel with the archive, so Resumes that reference them still render after moving to another machine; if a font with the same name already exists locally, the local copy wins.",
  "datasets.dropzone.hint": "Drop to import the backup (.zip)",
  "datasets.dropzone.aria": "Choose a backup file",
  "datasets.import.tooltip": "Importing adds a dataset and never touches the one currently in use",
  "datasets.empty": "No datasets yet",
  "datasets.tooltip.active": "In use",
  "datasets.tooltip.switch": "Switch to this dataset",
  "datasets.badge.current": "Current",
  "datasets.source.sample": "Sample",
  "datasets.confirm.delete": "Delete the dataset “{name}”?",
  "datasets.default.allName": "All datasets",
  "datasets.default.importName": "Imported dataset",
  "datasets.rename.title": "Rename dataset",
  "datasets.rename.save": "Save",
  "datasets.rename.hint":
    "The name only distinguishes datasets in the list; it does not affect the data.",
  "datasets.create.title": "New empty dataset",
  "datasets.create.ok": "Create",
  "datasets.create.hint":
    "After creating it you return to the dataset list and can switch to it at any time; once active it is empty (Jobs, Resumes and Profile all start from scratch).",
  "datasets.create.placeholder": "Dataset name (e.g. Autumn recruiting)",
  "datasets.export.titleAll": "Export all datasets",
  "datasets.export.titleOne": "Export dataset",
  "datasets.export.includeConfig":
    "The archive includes the global model configuration and API keys (all saved records)",
  "datasets.export.hint":
    "This name becomes the download file name and may contain Chinese characters; .zip is appended automatically.",
  "datasets.export.placeholder": "e.g. campus-20261019-101500",
  "datasets.export.aria": "Export file name",
} as const;

export default datasets;
