// SPDX-License-Identifier: Apache-2.0
/**
 * 「网申资料」里沿用 `UserProfile` 的旧网申专用字段：卡片标题、隐私提示、字段标签与占位符。
 *
 * ## 三个下拉的 `value` 是协议值
 *
 * `country_region` / `political_status` / `id_type` 的取值会提交给后端，还要与网申表单
 * 的下拉选项逐字匹配（见 `EducationSection.tsx` 的同一先例），因此 `value` 一律保留中文，
 * 只把 `label` 换成 `t()`。写成显式 `{ value: "中国大陆", label: t(…) }`，
 * 不用 `array.map((value) => ({ value, label: value }))`——后者一翻就把协议值也翻了。
 */
const webFormLegacy = {
  "webFormLegacy.cardTitle": "网申资料",
  "webFormLegacy.privacyAlert":
    "这些只存在你自己的电脑上，只在你点「填充」时写进网页，不会进入简历导出，也不会随简历发给大模型。",

  "webFormLegacy.field.countryRegion": "国家和地区",
  "webFormLegacy.region.mainland": "中国大陆",
  "webFormLegacy.region.hongKong": "中国香港",
  "webFormLegacy.region.macau": "中国澳门",
  "webFormLegacy.region.taiwan": "中国台湾",
  /** 「国家和地区 / 政治面貌 / 证件类型」三个下拉共用的末位选项。 */
  "webFormLegacy.option.other": "其他",

  "webFormLegacy.field.nativePlace": "籍贯",
  "webFormLegacy.placeholder.nativePlace": "如：山东济南",

  "webFormLegacy.field.politicalStatus": "政治面貌",
  "webFormLegacy.political.cpcMember": "中共党员",
  "webFormLegacy.political.cpcProbationary": "中共预备党员",
  "webFormLegacy.political.leagueMember": "共青团员",
  "webFormLegacy.political.masses": "群众",

  "webFormLegacy.field.idType": "证件类型",
  "webFormLegacy.idType.residentId": "居民身份证",
  "webFormLegacy.idType.passport": "护照",
  "webFormLegacy.idType.hkMacauPermit": "港澳居民来往内地通行证",
  "webFormLegacy.idType.taiwanPermit": "台湾居民来往大陆通行证",

  "webFormLegacy.field.idNumber": "证件号码",
  "webFormLegacy.placeholder.idNumber": "身份证号",

  "webFormLegacy.field.birthDate": "出生日期",

  "webFormLegacy.field.phoneCountryCode": "手机区号",

  "webFormLegacy.field.expectedSalary": "期望薪资",
  "webFormLegacy.placeholder.expectedSalary": "如：15-20K",

  "webFormLegacy.field.preferredIndustry": "意向行业",
  "webFormLegacy.placeholder.preferredIndustry": "如：互联网、互动娱乐",

  "webFormLegacy.field.advisor": "导师",
  "webFormLegacy.placeholder.advisor": "校招表单常问，选填",

  "webFormLegacy.field.researchDirection": "研究方向",
  "webFormLegacy.placeholder.optional": "选填",

  "webFormLegacy.field.familyInfo": "家庭信息",
  "webFormLegacy.placeholder.familyInfo": "部分网申表单会问家庭成员情况，按需填写；一行一条",
} as const;

export default webFormLegacy;
