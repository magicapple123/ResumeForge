// SPDX-License-Identifier: Apache-2.0
/**
 * Referral detail drawer: the fallback title for a record with no role or company, the
 * field list, the note and image-note sections, and the edit action.
 *
 * The status tag has no key here: its display name still comes from
 * `REFERRAL_STATUS_LABELS` in `types/referral.ts`, shared with the list row.
 */
const referralDetail = {
  "referralDetail.title.fallback": "Referral details",
  "referralDetail.tag.converted": "Converted",
  "referralDetail.field.company": "Company",
  "referralDetail.field.position": "Role referred for",
  "referralDetail.field.referrer": "Referrer",
  "referralDetail.field.contact": "Contact",
  "referralDetail.field.relation": "Relationship",
  "referralDetail.field.channel": "Channel",
  "referralDetail.field.code": "Referral code",
  "referralDetail.field.submittedAt": "Date applied",
  "referralDetail.field.job": "Linked job",
  "referralDetail.field.createdAt": "Created",
  "referralDetail.field.updatedAt": "Updated",
  "referralDetail.value.notRecorded": "Not recorded",
  "referralDetail.value.unknown": "Unknown",
  "referralDetail.value.empty": "(None)",
  "referralDetail.section.note": "Notes",
  "referralDetail.section.images": "Image notes ({count})",
  "referralDetail.image.noteAlt": "Image note",
  "referralDetail.action.edit": "Edit",
  "referralDetail.image.previewMask": "View image {index}",
} as const;

export default referralDetail;
