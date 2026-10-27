// SPDX-License-Identifier: Apache-2.0
/**
 * 事实台账的枚举显示名：分类 / 核实状态（含一句解释）/ 承担程度（含一句解释）/ 证据来源。
 *
 * **分类、核实状态、承担程度、证据来源的中文值与 `types/claim.ts` 逐字相同**——它们同时是
 * 提交后端的协议值，所以中文界面的渲染结果与迁移前完全一致；英文显示名见
 * `en-US.enumsClaims.ts`。key 由 `i18n/enum/claims.ts` 引用。
 */
const enumsClaims = {
  "enumsClaims.category.education": "教育经历",
  "enumsClaims.category.internship": "实习/工作",
  "enumsClaims.category.project": "项目经历",
  "enumsClaims.category.campus": "校园经历",
  "enumsClaims.category.skills": "专业技能",
  "enumsClaims.category.awards": "荣誉奖项",
  "enumsClaims.category.other": "其他",

  "enumsClaims.status.confirmed": "已确认",
  "enumsClaims.status.pending": "待确认",
  "enumsClaims.status.expired": "已过期",
  "enumsClaims.status.rejected": "不采用",

  "enumsClaims.statusHint.confirmed": "可以作为事实写进正式简历",
  "enumsClaims.statusHint.pending": "只能进草稿，必须保留【待补】占位符",
  "enumsClaims.statusHint.expired": "内容会随时间变化，更新前不作为最新事实",
  "enumsClaims.statusHint.rejected": "保留原因供复盘，不进入对外资料",

  "enumsClaims.responsibility.participate": "参与",
  "enumsClaims.responsibility.ownModule": "负责模块",
  "enumsClaims.responsibility.leadDelivery": "主导方案或交付",
  "enumsClaims.responsibility.owner": "项目负责人",

  "enumsClaims.responsibilityHint.participate": "在他人安排下完成其中一部分工作",
  "enumsClaims.responsibilityHint.ownModule": "独立负责其中一个明确模块或方向",
  "enumsClaims.responsibilityHint.leadDelivery": "方案由你定、交付由你推，其他人配合你",
  "enumsClaims.responsibilityHint.owner": "对整个项目的结果负责",

  "enumsClaims.source.pullRequest": "合并请求 / PR",
  "enumsClaims.source.repository": "代码仓库",
  "enumsClaims.source.document": "文档 / 报告",
  "enumsClaims.source.certificate": "证书 / 证明",
  "enumsClaims.source.link": "公开链接",
  "enumsClaims.source.screenshot": "截图",
  "enumsClaims.source.reference": "可联系的人 / 推荐人",
  "enumsClaims.source.other": "其他",

  "enumsClaims.optionWithHint": "{label}——{hint}",
} as const;

export default enumsClaims;
