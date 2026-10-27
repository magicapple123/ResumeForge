// SPDX-License-Identifier: Apache-2.0
/**
 * Copy for the Profile date fields (year/month/day selects, the Ongoing checkbox,
 * year group headers and the unsupported-format hint).
 */
const dateFields = {
  "dateFields.aria.year": "{label} year",
  "dateFields.aria.month": "{label} month",
  "dateFields.aria.day": "{label} day",
  "dateFields.placeholder.year": "Year",
  "dateFields.placeholder.month": "Month",
  "dateFields.placeholder.day": "Day",
  "dateFields.ongoing": "Present",
  "dateFields.parseUnsupported":
    "This date format isn't recognized; choose a date and save. The previous value is kept for now.",
  "dateFields.yearGroup.past": "This year and earlier",
  "dateFields.yearGroup.future": "Future years",
} as const;

export default dateFields;
