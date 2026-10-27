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

  "claimDraftModal.placeholder.subject": "Subject (optional, e.g. the project name)",
  "claimDraftModal.placeholder.rawText":
    "Paste the original material here - the more specific the better. Anything you leave out will not be filled in.",
  "claimDraftModal.action.generate": "Generate drafts",
  "claimDraftModal.action.saveSelected": "Save {count} selected",

  "claimDraftModal.empty.noDrafts": "No drafts yet",
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
