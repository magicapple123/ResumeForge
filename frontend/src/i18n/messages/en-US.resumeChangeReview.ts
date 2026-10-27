// SPDX-License-Identifier: Apache-2.0
/**
 * The change review modal (RF-13): a per-item diff review of AI rewrites and manual
 * edits before they are written into the Resume form.
 *
 * Keys are grouped by block: `modal` is the dialog title, `footer` holds the progress
 * line and the primary/secondary actions, `action` holds the accept/reject verbs,
 * `item` covers the origin tag, the rewrite request and the separator between several
 * verdict reasons, `verdict` is the preflight vocabulary plus the fact-ledger link,
 * and `diff` is the empty-diff placeholder.
 *
 * "Cancel" reuses `common.action.cancel`; this pack does not duplicate shared actions.
 */
const resumeChangeReview = {
  "resumeChangeReview.modal.title": "Review each change",

  "resumeChangeReview.footer.accepted": "Accepted {count}",
  "resumeChangeReview.footer.acceptedWithUndecided": "Accepted {accepted}, {undecided} pending",
  "resumeChangeReview.footer.applySelected": "Apply selected",
  "resumeChangeReview.footer.applySelectedCount": "Apply selected ({count})",

  "resumeChangeReview.action.acceptAll": "Accept all",
  "resumeChangeReview.hint.acceptedOnly":
    "Only accepted changes fill the form; the Resume updates after you save.",

  "resumeChangeReview.origin.aiRewrite": "AI rewrite",
  "resumeChangeReview.origin.userSupplement": "User addition",
  "resumeChangeReview.item.instruction": "Rewrite request: {instruction}",
  "resumeChangeReview.action.accept": "Accept",
  "resumeChangeReview.action.reject": "Reject",

  "resumeChangeReview.verdict.ok": "Preflight passed",
  "resumeChangeReview.verdict.factCheckNeeded": "Touches facts; verify in the fact ledger",
  "resumeChangeReview.verdict.blocked": "Contains unfinished markers; cannot be applied",
  "resumeChangeReview.verdict.blockedFallback":
    "The content has unfinished markers; complete them first",
  "resumeChangeReview.verdict.factCheckLink": "Verify in the fact ledger",
  "resumeChangeReview.item.reasonSeparator": "; ",

  "resumeChangeReview.diff.empty": "(this field was empty)",
} as const;

export default resumeChangeReview;
