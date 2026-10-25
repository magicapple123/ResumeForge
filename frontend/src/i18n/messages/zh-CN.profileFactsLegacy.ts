// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实（已退役）旧文案的**临时兼容别名**。
 *
 * 背景：R-70 把「资格证照」从九类补充事实升级成 13 个大字段之一，编辑槽文案从
 * profileFacts.* 迁到 credentials.*。features/profile-facts/** 的源码与测试仍留在
 * tsconfig 内（物理删除/回收站需单独授权），它们仍引用旧的 profileFacts.credential* /
 * profileFacts.credentialStatus* 键；本文件把这两组键以旧前缀登记为别名，让迁移窗口内
 * tsc 可以清零（Lead 2026-10-25 裁决 B）。
 *
 * **删除 facts 目录时必须同时删除本文件与 zh-CN.namespaces.ts 里的注册**；
 * 新代码禁止使用这里任何 key。
 */
const profileFactsLegacy = {
  "profileFacts.credentialStatus.unknown": "未知",
  "profileFacts.credentialStatus.pending": "待核验",
  "profileFacts.credentialStatus.active": "有效期内",
  "profileFacts.credentialStatus.expired": "已过期",

  "profileFacts.credential.name": "证照名称",
  "profileFacts.credential.namePlaceholder": "如：护士执业资格证",
  "profileFacts.credential.issuer": "颁发机构",
  "profileFacts.credential.issuerPlaceholder": "如：省级卫生健康委员会",
  "profileFacts.credential.issueDate": "签发日期",
  "profileFacts.credential.expiryDate": "到期日期",
  "profileFacts.credential.status": "状态",
  "profileFacts.credential.statusHint": "状态由你自己填写，系统不会自动判断资格是否有效",
  "profileFacts.credential.number": "证号",
  "profileFacts.credential.numberPlaceholder": "选填，仅保存在本地",
  "profileFacts.credential.numberHint": "只保存在本地，默认不发送给 AI，也不会印到简历上",
  "profileFacts.credential.verifyUrl": "核验链接",
  "profileFacts.credential.note": "说明",
} as const;

export default profileFactsLegacy;
