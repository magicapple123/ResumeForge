// SPDX-License-Identifier: Apache-2.0
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";

export const WEBFORM_CUSTOM_GROUP = "custom";

const LEGACY_GROUP_IDS: Readonly<Record<string, string>> = {
  "\u8eab\u4efd\u4fe1\u606f": "identity",
  "\u8054\u7cfb\u65b9\u5f0f": "contact",
  "\u6559\u80b2\u7ecf\u5386": "education",
  "\u5176\u4ed6": "other",
  "\u5b66\u7c4d\u4e0e\u6863\u6848": "school",
  "\u8bed\u8a00\u4e0e\u8bc1\u4e66": "language",
  "\u5bb6\u5ead\u4e0e\u7d27\u6025\u8054\u7cfb\u4eba": "family",
  "\u515a\u56e2\u4fe1\u606f": "party",
  "\u8eab\u4f53\u60c5\u51b5": "health",
  "\u610f\u5411\u4e0e\u5230\u5c97": "intent",
  "\u5176\u4ed6\u8865\u5145": "misc",
  "\u81ea\u5b9a\u4e49": WEBFORM_CUSTOM_GROUP,
};

const GROUP_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  identity: "webformGroups.identity",
  contact: "delivery.check.contact",
  education: "outline.section.education",
  other: "webformGroups.other",
  school: "webformGroups.school",
  language: "webformGroups.language",
  family: "webformGroups.family",
  party: "webformGroups.party",
  health: "webformGroups.health",
  intent: "webformGroups.intent",
  misc: "webformGroups.misc",
  [WEBFORM_CUSTOM_GROUP]: "profileLibrary.webform.customGroupName",
};

const REPEATED_GROUP_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  education: "webformGroups.repeat.education",
  experience: "webformGroups.repeat.experience",
  project: "webformGroups.repeat.project",
  campus: "webformGroups.repeat.campus",
  academic: "webformGroups.repeat.academic",
  award: "webformGroups.repeat.award",
  language: "webformGroups.repeat.language",
  certificate: "webformGroups.repeat.certificate",
  skill: "webformGroups.repeat.skill",
  emergency_contact: "webformGroups.repeat.emergency_contact",
};

const LEGACY_REPEATED_GROUP_LABELS: Readonly<Record<string, string>> = {
  "\u6559\u80b2\u7ecf\u5386\u8865\u5145": "education",
  "\u5b9e\u4e60\u548c\u5de5\u4f5c\u8865\u5145": "experience",
  "\u9879\u76ee\u7ecf\u5386\u8865\u5145": "project",
  "\u6821\u56ed\u548c\u793e\u4f1a\u5b9e\u8df5\u8865\u5145": "campus",
  "\u5b66\u672f\u6210\u679c": "academic",
  "\u7ade\u8d5b\u548c\u83b7\u5956\u8865\u5145": "award",
  "\u8bed\u8a00\u80fd\u529b\u8865\u5145": "language",
  "\u8bc1\u4e66\u8865\u5145": "certificate",
  "\u6280\u80fd\u8865\u5145": "skill",
  "\u7d27\u6025\u8054\u7cfb\u4eba": "emergency_contact",
};

const OPTION_LABEL_KEYS = new Map<string, MessageKey>([
  ["gender::\u7537", "webformGroups.option.male"],
  ["gender::\u5973", "webformGroups.option.female"],
  ["gender::\u5176\u4ed6", "webformGroups.option.other"],
  ["country_region::\u4e2d\u56fd\u5927\u9646", "webformGroups.option.mainland"],
  ["country_region::\u4e2d\u56fd\u9999\u6e2f", "webformGroups.option.hongKong"],
  ["country_region::\u4e2d\u56fd\u6fb3\u95e8", "webformGroups.option.macau"],
  ["country_region::\u4e2d\u56fd\u53f0\u6e7e", "webformGroups.option.taiwan"],
  ["country_region::\u5176\u4ed6", "webformGroups.option.other"],
  ["political_status::\u4e2d\u5171\u515a\u5458", "webformGroups.option.partyMember"],
  [
    "political_status::\u4e2d\u5171\u9884\u5907\u515a\u5458",
    "webformGroups.option.probationaryPartyMember",
  ],
  ["political_status::\u5171\u9752\u56e2\u5458", "webformGroups.option.youthLeagueMember"],
  ["political_status::\u7fa4\u4f17", "webformGroups.option.masses"],
  ["political_status::\u5176\u4ed6", "webformGroups.option.other"],
  ["id_type::\u5c45\u6c11\u8eab\u4efd\u8bc1", "webformGroups.option.nationalId"],
  ["id_type::\u62a4\u7167", "webformGroups.option.passport"],
  [
    "id_type::\u6e2f\u6fb3\u5c45\u6c11\u6765\u5f80\u5185\u5730\u901a\u884c\u8bc1",
    "webformGroups.option.hkMacauPermit",
  ],
  [
    "id_type::\u53f0\u6e7e\u5c45\u6c11\u6765\u5f80\u5927\u9646\u901a\u884c\u8bc1",
    "webformGroups.option.taiwanPermit",
  ],
  ["id_type::\u5176\u4ed6", "webformGroups.option.other"],
  ["degree::\u9ad8\u4e2d", "webformGroups.option.highSchool"],
  ["degree::\u5927\u4e13", "webformGroups.option.juniorCollege"],
  ["degree::\u672c\u79d1", "webformGroups.option.bachelor"],
  ["degree::\u7855\u58eb", "webformGroups.option.master"],
  ["degree::\u535a\u58eb", "webformGroups.option.doctorate"],
  ["degree_type::\u5b66\u58eb", "webformGroups.option.bachelorDegree"],
  ["degree_type::\u7855\u58eb\u5b66\u4f4d", "webformGroups.option.masterDegree"],
  ["degree_type::\u535a\u58eb\u5b66\u4f4d", "webformGroups.option.doctorateDegree"],
  ["degree_type::\u5176\u4ed6", "webformGroups.option.other"],
  ["study_mode::\u5168\u65e5\u5236", "webformGroups.option.fullTime"],
  ["study_mode::\u975e\u5168\u65e5\u5236", "webformGroups.option.partTime"],
  ["training_mode::\u7edf\u62db", "webformGroups.option.unifiedAdmission"],
  ["training_mode::\u5b9a\u5411", "webformGroups.option.targeted"],
  ["training_mode::\u59d4\u57f9", "webformGroups.option.commissioned"],
  ["training_mode::\u5176\u4ed6", "webformGroups.option.other"],
  ["marital_status::\u672a\u5a5a", "webformGroups.option.unmarried"],
  ["marital_status::\u5df2\u5a5a", "webformGroups.option.married"],
  ["marital_status::\u79bb\u5f02", "webformGroups.option.divorced"],
  ["marital_status::\u4e27\u5076", "webformGroups.option.widowed"],
  ["marital_status::\u5176\u4ed6", "webformGroups.option.other"],
  ["disadvantaged_student::\u662f", "webformGroups.option.yes"],
  ["disadvantaged_student::\u5426", "webformGroups.option.no"],
  ["accept_assignment::\u662f", "webformGroups.option.yes"],
  ["accept_assignment::\u5426", "webformGroups.option.no"],
]);

/** Normalize historical display-value protocols on read; new values use stable IDs. */
export function normalizeWebformGroupId(group: string): string {
  return LEGACY_GROUP_IDS[group] ?? group;
}

/** Resolve only known system groups. User-provided or unknown labels remain untouched. */
export function webformGroupLabel(group: string): string {
  const key = GROUP_LABEL_KEYS[normalizeWebformGroupId(group)];
  if (key) return t(key);
  for (const [legacyLabel, family] of Object.entries(LEGACY_REPEATED_GROUP_LABELS)) {
    if (group === legacyLabel) return webformRepeatedGroupLabel(family, group);
    if (group.startsWith(`${legacyLabel} `)) {
      return `${webformRepeatedGroupLabel(family, legacyLabel)}${group.slice(legacyLabel.length)}`;
    }
  }
  return group;
}

/** Repeated-group family is a stable protocol ID; its backend label is display-only. */
export function webformRepeatedGroupLabel(family: string, fallback: string): string {
  const key = REPEATED_GROUP_LABEL_KEYS[family];
  return key ? t(key) : fallback;
}

/** Translate built-in option labels while preserving their stored field values. */
export function webformOptionLabel(fieldKey: string, value: string): string {
  const key = OPTION_LABEL_KEYS.get(`${fieldKey}::${value}`);
  return key ? t(key) : value;
}
