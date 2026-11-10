// SPDX-License-Identifier: Apache-2.0
/**
 * Fact ledger card (one read-only entry): header fallback and verification date, row
 * actions, field labels, evidence and footer hints.
 */
const claimCard = {
  /** Fallback when neither a title nor a subject is set. */
  "claimCard.header.fallbackTitle": "Entry {id}",
  /** Verification date on the right of the header. */
  "claimCard.header.lastVerified": "Last verified {date}",
  /** Accessible name of the checkbox in bulk-selection mode. */
  "claimCard.header.selectAria": "Select ledger entry {name}",

  /** Inline "mark as confirmed" button. */
  "claimCard.action.confirm": "Mark as confirmed",
  /** Tooltip explaining that only confirmed entries feed generation. */
  "claimCard.action.confirmTooltip":
    "Only confirmed entries become facts when a resume is generated",
  /** Row action menu: edit. */
  "claimCard.action.edit": "Edit",
  /** Row action menu: delete (soft delete, undo lives in the toast). */
  "claimCard.action.delete": "Delete",
  /** Accessible name of the overflow menu button. */
  "claimCard.action.moreAria": "More actions for {name}",

  /** Placeholder when the source fact or wording is empty. */
  "claimCard.wording.empty": "(Not filled in)",

  /** Label of the first body row. */
  "claimCard.field.sourceFact": "Source fact",
  /** Label of the second body row. */
  "claimCard.field.wording": "Resume wording",
  /** Label of the personal-boundary row. */
  "claimCard.field.boundary": "Personal boundary",
  /** Label of the allowed-uses row. */
  "claimCard.field.allowedUses": "Allowed uses",

  /** Header tag: this entry is not linked to any profile entry, so generation ignores it. */
  "claimCard.link.unlinked": "Not used in generation",
  /** Tooltip for the grey tag: why it happens and where to fix it. */
  "claimCard.link.unlinkedTooltip":
    "This entry has no linked profile entry, so it never enters the fact baseline - link it from the editor",
  /** Header tag: the link came from the migration's subject-based auto-match. */
  "claimCard.link.autoLinked": "Auto-linked, please review",
  /** Tooltip explaining where the auto link came from. */
  "claimCard.link.autoLinkedTooltip":
    "Auto-matched by subject during migration - open it, review, and save to confirm",
  /** Footer: how many profile entries are linked (detail records only). */
  "claimCard.link.linkedCount": "{count} linked profile entries",

  /** Label of the evidence section in the footer. */
  "claimCard.evidence.title": "Evidence",
  /** Suffix appended to the location when the evidence is not public. */
  "claimCard.evidence.privateSuffix": " (private)",

  /** Footer hint shown when interview details are present. */
  "claimCard.interview.prepared":
    "Interview details ready (decisions / difficulties / verification / results)",
} as const;

export default claimCard;
