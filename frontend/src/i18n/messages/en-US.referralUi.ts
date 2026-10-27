// SPDX-License-Identifier: Apache-2.0
/**
 * Referral UI: the list row, the create / edit modal and the conversion stats card.
 *
 * Generic actions (save, cancel, delete, select multiple) reuse the `common` pack; this
 * file only carries referral-specific wording.
 */
const referralUi = {
  "referralUi.form.title.edit": "Edit referral",
  "referralUi.form.title.create": "New referral",
  "referralUi.list.action.detail": "Details",
  "referralUi.list.action.edit": "Edit",
  "referralUi.list.confirm.deleteTitle": "Delete this referral?",
  "referralUi.list.value.noReferrer": "No referrer recorded",
  "referralUi.list.tag.converted": "Converted",
  "referralUi.list.label.referralCode": "Referral code: {code}",
  "referralUi.list.image.noteAlt": "Image note",
  "referralUi.list.aria.select": "Select referral {name}",
  "referralUi.list.aria.moreActions": "More actions for {name}",
  "referralUi.stats.title": "Referral conversion rate",
  "referralUi.stats.valid": "Valid referrals",
  "referralUi.stats.converted": "Converted",
  "referralUi.stats.rate": "Conversion rate",
} as const;

export default referralUi;
