// SPDX-License-Identifier: Apache-2.0
/**
 * 「证书资质」编辑槽（F4 §5.6）的界面文案。
 *
 * 为什么单独成文件：这批 key 原来住在 `zh-CN.profileFacts.ts`——补充事实时代「资格证照」
 * 只是九类事实之一。2026-10 的 F6 把证书资质升级成 13 个大字段之一、补充事实从界面下线，
 * 编辑槽也从事实编辑器挪进简历编辑器中栏；文案随功能迁到本文件，key 前缀由 `profileFacts.`
 * 改为 `credentials.`。`zh-CN.profileFacts.ts` 本体保留给退役组件与历史测试，不再进命名空间聚合。
 *
 * 口径：状态是**用户自填的事实锁**（unknown / pending / active / expired），系统不自动认定
 * 资格是否有效；证号只在本地、永不进模型/导出，所以这里没有证号输入框。
 */

const credentials = {
  // ── 状态（用户自填的事实锁；未知/待核验都不是"已取得"） ──────
  "credentials.credentialStatus.unknown": "未知",
  "credentials.credentialStatus.pending": "待核验",
  "credentials.credentialStatus.active": "有效期内",
  "credentials.credentialStatus.expired": "已过期",

  // ── 字段 ───────────────────────────────────────────────────
  "credentials.credential.name": "证照名称",
  "credentials.credential.namePlaceholder": "如：护士执业资格证",
  "credentials.credential.credentialType": "证书类型",
  "credentials.credential.credentialTypePlaceholder": "如：职业资格 / 语言证书",
  "credentials.credential.issuer": "颁发机构",
  "credentials.credential.issuerPlaceholder": "如：省级卫生健康委员会",
  "credentials.credential.issueDate": "签发日期",
  "credentials.credential.expiryDate": "到期日期",
  "credentials.credential.status": "状态",
  "credentials.credential.statusHint": "状态由你自己填写，系统不会自动判断资格是否有效",
  "credentials.credential.number": "证号",
  "credentials.credential.numberPlaceholder": "选填，仅保存在本地",
  "credentials.credential.numberHint": "只保存在本地，默认不发送给 AI，也不会印到简历上",
  "credentials.credential.verifyUrl": "核验链接",
  "credentials.credential.note": "说明",
} as const;

export default credentials;
