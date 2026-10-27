// SPDX-License-Identifier: Apache-2.0
/**
 * Display names for the fact-ledger enums: category, verification status (with its
 * one-line hint), responsibility level (with its hint) and evidence source type.
 *
 * The keys are the protocol values defined in `types/claim.ts`; this pack only holds
 * their English display names. `i18n/enum/claims.ts` owns the value-to-key mapping.
 */
const enumsClaims = {
  "enumsClaims.category.education": "Education",
  "enumsClaims.category.internship": "Internship / work",
  "enumsClaims.category.project": "Projects",
  "enumsClaims.category.campus": "Campus activities",
  "enumsClaims.category.skills": "Skills",
  "enumsClaims.category.awards": "Awards",
  "enumsClaims.category.other": "Other",

  "enumsClaims.status.confirmed": "Confirmed",
  "enumsClaims.status.pending": "Pending",
  "enumsClaims.status.expired": "Expired",
  "enumsClaims.status.rejected": "Not used",

  "enumsClaims.statusHint.confirmed": "Can be written into a formal resume",
  "enumsClaims.statusHint.pending": "Drafts only; keep the [TODO: what is missing] placeholder",
  "enumsClaims.statusHint.expired": "Changes over time; not current fact until updated",
  "enumsClaims.statusHint.rejected": "Kept with its reason for review; never used externally",

  "enumsClaims.responsibility.participate": "Participated",
  "enumsClaims.responsibility.ownModule": "Owned a module",
  "enumsClaims.responsibility.leadDelivery": "Led the solution or delivery",
  "enumsClaims.responsibility.owner": "Project owner",

  "enumsClaims.responsibilityHint.participate":
    "Did part of the work under someone else's direction",
  "enumsClaims.responsibilityHint.ownModule":
    "Independently owned one clearly defined module or area",
  "enumsClaims.responsibilityHint.leadDelivery":
    "Set the approach and drove delivery while others supported you",
  "enumsClaims.responsibilityHint.owner": "Accountable for the whole project's outcome",

  "enumsClaims.source.pullRequest": "Pull request / PR",
  "enumsClaims.source.repository": "Code repository",
  "enumsClaims.source.document": "Document / report",
  "enumsClaims.source.certificate": "Certificate / proof",
  "enumsClaims.source.link": "Public link",
  "enumsClaims.source.screenshot": "Screenshot",
  "enumsClaims.source.reference": "Reference / recommender",
  "enumsClaims.source.other": "Other",

  "enumsClaims.optionWithHint": "{label} - {hint}",
} as const;

export default enumsClaims;
