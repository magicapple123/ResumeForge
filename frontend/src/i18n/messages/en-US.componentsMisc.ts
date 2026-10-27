// SPDX-License-Identifier: Apache-2.0
/**
 * Shared components (second batch, closing set): the pre-recognition file staging area and
 * preview, the recognition source badge, the quality-check dialog, the version diff view,
 * the export entry, the dataset boundary and new-dataset dialog, the sidebar update check,
 * the resume editor shell and the header theme switch.
 */
const componentsMisc = {
  "componentsMisc.recognitionField.dropHint": "Drop to add screenshots or documents",
  "componentsMisc.recognitionField.add": "Add screenshots or documents",
  "componentsMisc.recognitionField.ignoredUnsupported":
    "Ignored {count} unsupported files (only screenshots and pdf/docx are accepted)",
  "componentsMisc.recognitionField.pasteHint":
    "You can also drag files here, or press Ctrl+V in the text box to paste a screenshot (up to {count} files, each ≤ 2 MB and ≤ 5 MB in total; screenshots and pdf/docx documents are accepted)",
  "componentsMisc.recognitionField.removeTooltip": "Remove {name}",
  "componentsMisc.recognitionField.removeAria": "Remove file {name}",

  "componentsMisc.recognitionPreview.action": "Preview",
  "componentsMisc.recognitionPreview.open": "Preview {name}",
  "componentsMisc.recognitionPreview.loading": "Generating preview…",
  "componentsMisc.recognitionPreview.error":
    "This file cannot be previewed, but recognition still works",
  "componentsMisc.recognitionPreview.pageAlt": "Page {page}",
  "componentsMisc.recognitionPreview.docxHint":
    "Word documents cannot be previewed in the browser; the text is extracted during recognition",

  "componentsMisc.recognitionOutcome.source.ai": "AI recognition",
  "componentsMisc.recognitionOutcome.hint.ai":
    "Recognized by a large language model; every field was checked against the content you provided. Please verify before saving",
  "componentsMisc.recognitionOutcome.source.local": "Local rules",
  "componentsMisc.recognitionOutcome.hint.local":
    "No model was called; results come from built-in matching rules and are less accurate than AI recognition. Please verify carefully before saving",
  "componentsMisc.recognitionOutcome.recognizedText":
    "Show the text the model recognized (check it against the screenshot)",

  "componentsMisc.qualityModal.title": "Quality check",
  "componentsMisc.qualityModal.tab.risk": "Risk scan",
  "componentsMisc.qualityModal.tab.ats": "ATS check",

  "componentsMisc.resumeDiff.compare": "Compared:",
  "componentsMisc.resumeDiff.stat.added": "{added} added",
  "componentsMisc.resumeDiff.stat.removed": "{removed} removed",
  "componentsMisc.resumeDiff.stat.unchanged": "{unchanged} unchanged",

  "componentsMisc.exportButtons.export": "Export",

  "componentsMisc.datasetScope.loading": "Connecting to the local workbench",
  "componentsMisc.datasetScope.errorTitle": "Cannot connect to the local workbench",
  "componentsMisc.datasetScope.errorBody":
    "Data has not loaded yet. Make sure the service is running, then refresh the page.",
  "componentsMisc.datasetScope.refresh": "Refresh",

  "componentsMisc.datasetCreate.title": "New dataset",
  "componentsMisc.datasetCreate.create": "Create",
  "componentsMisc.datasetCreate.intro":
    "Each dataset has its own jobs, materials and resumes. The interface looks the same, but data never crosses over - useful for keeping work, personal and interview practice separate.",
  "componentsMisc.datasetCreate.namePlaceholder": "e.g. Work, Personal, Interview practice",
  "componentsMisc.datasetCreate.nameAria": "Dataset name",

  "componentsMisc.updateCheck.latest": "You are on the latest version ({version})",
  "componentsMisc.updateCheck.available": "Version {version} is available.",
  "componentsMisc.updateCheck.goUpdate": "Update in Settings",
  "componentsMisc.updateCheck.failed": "Could not check for updates",
  "componentsMisc.updateCheck.checking": "Checking for updates…",
  "componentsMisc.updateCheck.check": "Check for updates",

  "componentsMisc.resumeEditorModal.title": "Adjust resume content",
  "componentsMisc.resumeEditorModal.save": "Save and update preview",

  "componentsMisc.theme.label": "Theme",
  "componentsMisc.theme.light": "Light",
  "componentsMisc.theme.dark": "Dark",
  "componentsMisc.theme.system": "System",
} as const;

export default componentsMisc;
