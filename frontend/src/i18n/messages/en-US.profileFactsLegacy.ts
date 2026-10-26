// SPDX-License-Identifier: Apache-2.0
// Compatibility keys for retired Profile fact components.
const profileFactsLegacy = {
  "profileFacts.credentialStatus.unknown": "Unknown",
  "profileFacts.credentialStatus.pending": "Pending verification",
  "profileFacts.credentialStatus.active": "Within validity period",
  "profileFacts.credentialStatus.expired": "Expired",
  "profileFacts.credential.name": "Credential name",
  "profileFacts.credential.namePlaceholder": "e.g. Nursing license",
  "profileFacts.credential.issuer": "Issuing organization",
  "profileFacts.credential.issuerPlaceholder": "e.g. State Department of Health",
  "profileFacts.credential.issueDate": "Issue date",
  "profileFacts.credential.expiryDate": "Expiration date",
  "profileFacts.credential.status": "Status",
  "profileFacts.credential.statusHint":
    "You enter the status; the app does not determine whether a credential is valid",
  "profileFacts.credential.number": "Credential number",
  "profileFacts.credential.numberPlaceholder": "Optional, stored locally only",
  "profileFacts.credential.numberHint":
    "Stored locally only, not sent to AI by default or printed on the Resume",
  "profileFacts.credential.verifyUrl": "Verification link",
  "profileFacts.credential.note": "Notes",
} as const;

export default profileFactsLegacy;
