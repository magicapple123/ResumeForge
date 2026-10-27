// SPDX-License-Identifier: Apache-2.0
/**
 * Confirmation panel shown when one paste yields several job postings
 * (`MultiJobDraftList`): intro, per-draft title and excerpt, the single-draft
 * edit entry, and the save actions at the bottom.
 */
const jobsUi = {
  "jobsUi.alert.title": "Found {count} job postings ({engine})",
  "jobsUi.alert.description":
    "Check that the split is right and clear the postings you do not want to save. Each one you keep becomes its own Job on the Job board once saved",
  "jobsUi.draft.untitled": "Untitled job {index}",
  "jobsUi.card.editHint":
    "Fill just this posting into the form so you can edit each field before saving",
  "jobsUi.card.editSingle": "Edit this one",
  "jobsUi.card.missingDescription": "No job description",
  "jobsUi.card.excerpt": "Source text: {excerpt}",
  "jobsUi.action.saveSelected": "Save {count} selected as jobs",
  "jobsUi.action.backToEdit": "Back to edit the text",
} as const;

export default jobsUi;
