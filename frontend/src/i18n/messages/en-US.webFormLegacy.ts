// SPDX-License-Identifier: Apache-2.0
/**
 * Legacy web-form-only fields kept on `UserProfile`: card title, privacy notice, field
 * labels and placeholders. The `value`s of the three selects are protocol values and stay
 * in Chinese in the component; only these labels are translated.
 */
const webFormLegacy = {
  "webFormLegacy.cardTitle": "Web form Profile",
  "webFormLegacy.privacyAlert":
    "This stays on your own computer. It is written into a web page only when you click Fill, and it is never included in Resume export or sent to the model with your Resume.",

  "webFormLegacy.field.countryRegion": "Country / region",
  "webFormLegacy.region.mainland": "Chinese mainland",
  "webFormLegacy.region.hongKong": "Hong Kong SAR",
  "webFormLegacy.region.macau": "Macao SAR",
  "webFormLegacy.region.taiwan": "Taiwan region",
  "webFormLegacy.option.other": "Other",

  "webFormLegacy.field.nativePlace": "Place of origin",
  "webFormLegacy.placeholder.nativePlace": "e.g. Jinan, Shandong",

  "webFormLegacy.field.politicalStatus": "Political status",
  "webFormLegacy.political.cpcMember": "CPC member",
  "webFormLegacy.political.cpcProbationary": "CPC probationary member",
  "webFormLegacy.political.leagueMember": "Communist Youth League member",
  "webFormLegacy.political.masses": "Non-party member",

  "webFormLegacy.field.idType": "ID type",
  "webFormLegacy.idType.residentId": "Resident ID card",
  "webFormLegacy.idType.passport": "Passport",
  "webFormLegacy.idType.hkMacauPermit": "Permit for Hong Kong and Macao residents",
  "webFormLegacy.idType.taiwanPermit": "Permit for Taiwan residents",

  "webFormLegacy.field.idNumber": "ID number",
  "webFormLegacy.placeholder.idNumber": "ID card number",

  "webFormLegacy.field.birthDate": "Date of birth",

  "webFormLegacy.field.phoneCountryCode": "Phone country code",

  "webFormLegacy.field.expectedSalary": "Expected salary",
  "webFormLegacy.placeholder.expectedSalary": "e.g. 15-20K",

  "webFormLegacy.field.preferredIndustry": "Preferred industry",
  "webFormLegacy.placeholder.preferredIndustry": "e.g. Internet, interactive entertainment",

  "webFormLegacy.field.advisor": "Advisor",
  "webFormLegacy.placeholder.advisor": "Commonly asked in campus recruiting forms; optional",

  "webFormLegacy.field.researchDirection": "Research direction",
  "webFormLegacy.placeholder.optional": "Optional",

  "webFormLegacy.field.familyInfo": "Family information",
  "webFormLegacy.placeholder.familyInfo":
    "Some web forms ask about family members. Fill in as needed, one per line",
} as const;

export default webFormLegacy;
