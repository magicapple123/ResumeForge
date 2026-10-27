// SPDX-License-Identifier: Apache-2.0
/**
 * Referral form: field labels, placeholders, the date hint and the image-note uploader.
 *
 * The referral status values are protocol values (`active` / `submitted` / `closed` /
 * `invalid`, see `types/referral.ts`, matched word for word by the backend). This file only
 * provides their display names; the `Record<ReferralStatus, MessageKey>` table in
 * `ReferralFormFields.tsx` keeps the protocol value as its key.
 *
 * A `/` in a placeholder lists alternatives ("name / how you address them"), so English
 * keeps the same separator instead of collapsing the list into one word.
 */
const referralForm = {
  "referralForm.field.company": "Company",
  "referralForm.placeholder.company": "Company name",
  "referralForm.field.position": "Role referred for",
  "referralForm.placeholder.position": "Role name",
  "referralForm.field.referrer": "Referrer",
  "referralForm.placeholder.referrer": "Name / how you address them",
  "referralForm.field.contact": "Contact",
  "referralForm.placeholder.contact": "WeChat / email, etc.",
  "referralForm.field.relation": "Relationship",
  "referralForm.placeholder.relation": "Friend / former colleague / someone online …",
  "referralForm.field.channel": "Channel",
  "referralForm.placeholder.channel": "Nowcoder / Maimai / a direct referral …",
  "referralForm.field.code": "Referral code",
  "referralForm.placeholder.code": "Referral code from the careers site (optional)",
  "referralForm.field.status": "Status",
  "referralForm.field.job": "Linked Job (optional; deleting the Job keeps the referral)",
  "referralForm.placeholder.job": "Type a keyword to search Jobs",
  "referralForm.field.track":
    "Linked tracker entry (optional; reaching Interview or later counts as converted)",
  "referralForm.placeholder.track": "Type a keyword to search tracker entries",
  "referralForm.field.submittedAt": "Date applied",
  "referralForm.hint.submittedAt": "Leave empty if unknown",
  "referralForm.field.images": "Image notes (optional, up to {count})",
  "referralForm.action.uploadImage": "Upload image note",
  "referralForm.aria.uploadProgress": "Image note upload progress",
  "referralForm.imageAlt": "Image note {index}",
  "referralForm.removeImage": "Remove image note {index}",
  "referralForm.field.note": "Notes",
  "referralForm.placeholder.note": "Anything else worth noting (optional)",
  "referralForm.status.active": "Contacted",
  "referralForm.status.submitted": "Submitted",
  "referralForm.status.closed": "Closed",
  "referralForm.status.invalid": "Invalid",
  // List toolbar (`ReferralToolbar`): same feature area, so it shares this namespace.
  "referralForm.toolbar.title": "Referrals",
  "referralForm.toolbar.searchPlaceholder": "Search company / role / referrer",
  "referralForm.toolbar.statusPlaceholder": "Filter by status",
  "referralForm.toolbar.create": "New referral",
} as const;

export default referralForm;
