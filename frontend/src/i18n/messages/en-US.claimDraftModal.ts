// SPDX-License-Identifier: Apache-2.0
/**
 * "Draft fact ledger entries from material" dialog: title, intro, placeholders,
 * actions, empty state and feedback.
 *
 * The category dropdown's display names come from this pack; `CATEGORY_LABEL_KEYS` in
 * `ClaimDraftModal.tsx` is keyed by the protocol value that is submitted to the backend,
 * so `types/claim.ts` is untouched.
 */
const claimDraftModal = {
  "claimDraftModal.title": "Generate fact ledger drafts from material",
  "claimDraftModal.intro":
    "Paste an experience, a project description or an award. Every extracted entry starts as Pending, so check each one before marking it confirmed.",

  "claimDraftModal.category.education": "Education",
  "claimDraftModal.category.internship": "Internship / work",
  "claimDraftModal.category.project": "Projects",
  "claimDraftModal.category.campus": "Campus activities",
  "claimDraftModal.category.skills": "Skills",
  "claimDraftModal.category.awards": "Awards",
  "claimDraftModal.category.other": "Other",

  "claimDraftModal.label.fromProfile": "Pick from profile",
  "claimDraftModal.placeholder.fromProfile": "Pick an entry to fill the text and subject",
  "claimDraftModal.fromProfile.loadFailed": "Could not load the profile - you can still paste text",
  "claimDraftModal.fromProfile.empty": "No profile entries available yet",
  "claimDraftModal.replaceEntry.confirm": "Replace what you typed?",
  "claimDraftModal.replaceEntry.note":
    "The text, subject and category will be replaced by the new entry",
  "claimDraftModal.replaceEntry.action": "Replace",

  "claimDraftModal.entryFieldLine": "{label}: {value}",
  "claimDraftModal.placeholder.subjectExample": "e.g. the project name",
  "claimDraftModal.placeholder.rawText":
    "Paste the original material here - the more specific the better. Anything you leave out will not be filled in.",
  "claimDraftModal.label.category": "Category",
  "claimDraftModal.label.subject": "Subject",
  "claimDraftModal.action.generate": "Generate drafts",
  "claimDraftModal.action.regenerate": "Regenerate",
  "claimDraftModal.action.saveSelected": "Save {count} selected",
  "claimDraftModal.regenerate.confirm": "Regenerating will overwrite edits to the current drafts",

  "claimDraftModal.empty.nothingExtracted":
    "No facts worth saving were extracted from this material…",
  "claimDraftModal.placeholder.title": "Title",
  "claimDraftModal.placeholder.sourceFact": "Source fact",
  "claimDraftModal.placeholder.candidateWording":
    "Resume wording (keep a [TODO: what is missing] marker on anything unverified)",

  "claimDraftModal.toast.pasteFirst": "Paste the material you want to organize first",
  "claimDraftModal.toast.noDrafts": "No checkable claims were found in this material",
  "claimDraftModal.toast.pickAtLeastOne": "Select at least one entry",
  "claimDraftModal.toast.saved": "Added {count} entries to the fact ledger as Pending",
  "claimDraftModal.error.generateFailed": "Could not generate drafts",
  "claimDraftModal.error.saveFailed": "Could not save",
} as const;

export default claimDraftModal;
