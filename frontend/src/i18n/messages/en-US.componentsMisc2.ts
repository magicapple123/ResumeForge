// SPDX-License-Identifier: Apache-2.0
/**
 * Scattered copy: the Job reference panel, the header model switcher, the one-click
 * redaction dialog and the referral panel.
 *
 * These four files belong to the same closing batch and share no single domain
 * namespace, so they share one pack. The blocks are `jobReference` / `modelProfile` /
 * `redaction` / `referral`, matching the component each block belongs to.
 */
const componentsMisc2 = {
  // Job reference panel (`JobRequirementPanel`): read-only snapshot of the Job.
  "componentsMisc2.jobReference.ariaLabel": "Job requirements reference: {title}",
  "componentsMisc2.jobReference.eyebrow": "Job requirements reference",
  "componentsMisc2.jobReference.location": "Location",
  "componentsMisc2.jobReference.type": "Type",
  "componentsMisc2.jobReference.salary": "Salary",
  "componentsMisc2.jobReference.description": "Responsibilities",
  "componentsMisc2.jobReference.emptyDescription": "No responsibilities listed",
  "componentsMisc2.jobReference.requirements": "Requirements",
  "componentsMisc2.jobReference.emptyRequirements": "No requirements listed",
  "componentsMisc2.jobReference.skills": "Skill tags",
  "componentsMisc2.jobReference.emptySkills": "No skill tags yet",
  "componentsMisc2.jobReference.other": "Other information",
  "componentsMisc2.jobReference.emptyOther": "No other information",

  // Header model switcher (`ModelProfileSelect`): switch and double-click test feedback.
  "componentsMisc2.modelProfile.defaultRecordName": "Default configuration",
  "componentsMisc2.modelProfile.ariaLabel": "Current model profile",
  "componentsMisc2.modelProfile.placeholder": "Select a model profile",
  "componentsMisc2.modelProfile.switched": "Switched to profile “{name}”",
  "componentsMisc2.modelProfile.switchFailed": "Could not switch the model profile",
  "componentsMisc2.modelProfile.testFailed": "“{name}” connection failed: {reason}",
  "componentsMisc2.modelProfile.testOkLatency": "“{name}” connection succeeded ({latency}ms)",
  "componentsMisc2.modelProfile.testOk": "“{name}” connection succeeded",
  "componentsMisc2.modelProfile.unknownReason": "Unknown reason",

  // One-click redaction dialog (`RedactionModal`): masking scope comes from `REDACTION_FIELDS`.
  "componentsMisc2.redaction.title": "One-click redaction",
  "componentsMisc2.redaction.scope": "What to mask",
  "componentsMisc2.redaction.preview": "Preview redacted",
  "componentsMisc2.redaction.download": "Download redacted (PDF)",
  "componentsMisc2.redaction.previewFailed": "Could not preview the redacted resume",
  "componentsMisc2.redaction.downloadFailed": "Could not download the redacted resume",
  "componentsMisc2.redaction.savedTo": "Also saved to {path}",
  "componentsMisc2.redaction.downloadStarted": "Redacted resume download started",
  "componentsMisc2.redaction.field.name": "Name",
  "componentsMisc2.redaction.field.phone": "Phone",
  "componentsMisc2.redaction.field.email": "Email",
  "componentsMisc2.redaction.field.company": "Latest company",

  // Referral panel (`ReferralPanel`): action feedback, image-note upload and page total.
  // Status names are protocol-driven and stay in `referralForm` / `referralDetail`.
  "componentsMisc2.referral.loadFailed": "Could not load referrals",
  "componentsMisc2.referral.imageTypeError": "Only png/jpg/webp/gif/bmp/tiff images are supported",
  "componentsMisc2.referral.imageSizeError": "Each image must be 2 MB or smaller",
  "componentsMisc2.referral.imageCountLimit": "Up to {count} image notes",
  "componentsMisc2.referral.uploadFailed": "Could not upload the image",
  "componentsMisc2.referral.created": "Referral created",
  "componentsMisc2.referral.updated": "Referral updated",
  "componentsMisc2.referral.saveFailed": "Could not save the referral",
  "componentsMisc2.referral.deleted": "Referral deleted",
  "componentsMisc2.referral.deleteFailed": "Could not delete the referral",
  "componentsMisc2.referral.batchDeleted": "Deleted {count} referrals; restore them from Trash",
  "componentsMisc2.referral.batchDeleteFailed":
    "Could not delete the selected referrals, please try again",
  "componentsMisc2.referral.empty": "No referrals yet. Keep track of the referrals you find here.",
  "componentsMisc2.referral.paginationTotal": "{count} in total",
  "componentsMisc2.referral.batchNoun": "referrals",
} as const;

export default componentsMisc2;
