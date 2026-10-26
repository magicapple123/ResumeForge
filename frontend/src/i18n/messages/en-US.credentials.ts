// SPDX-License-Identifier: Apache-2.0
const credentials = {
  "credentials.credentialStatus.unknown": "Unknown",
  "credentials.credentialStatus.pending": "Pending verification",
  "credentials.credentialStatus.active": "Within validity period",
  "credentials.credentialStatus.expired": "Expired",
  "credentials.credential.name": "Credential name",
  "credentials.credential.namePlaceholder": "e.g. Nursing license",
  "credentials.credential.credentialType": "Certificate type",
  "credentials.credential.credentialTypePlaceholder":
    "e.g. Professional qualification / language certificate",
  "credentials.credential.issuer": "Issuing organization",
  "credentials.credential.issuerPlaceholder": "e.g. State Department of Health",
  "credentials.credential.issueDate": "Issue date",
  "credentials.credential.expiryDate": "Expiration date",
  "credentials.credential.status": "Status",
  "credentials.credential.statusHint":
    "You enter the status; the app does not determine whether a credential is valid",
  "credentials.credential.number": "Credential number",
  "credentials.credential.numberPlaceholder": "Optional, stored locally only",
  "credentials.credential.numberHint":
    "Stored locally only, not sent to AI by default or printed on the Resume",
  "credentials.credential.verifyUrl": "Verification link",
  "credentials.credential.note": "Notes",
} as const;

export default credentials;
