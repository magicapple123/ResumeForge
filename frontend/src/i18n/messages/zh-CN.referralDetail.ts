// SPDX-License-Identifier: Apache-2.0
/**
 * 内推详情抽屉：缺失字段的兜底标题、字段清单、备注与图片备注分区、编辑入口。
 *
 * 状态 Tag 的显示名不在这里——它来自 `types/referral.ts` 的 `REFERRAL_STATUS_LABELS`
 * （与列表行共用一张表，`types` 层不改）。
 */
const referralDetail = {
  "referralDetail.title.fallback": "内推详情",
  "referralDetail.tag.converted": "已转化",
  "referralDetail.field.company": "公司",
  "referralDetail.field.position": "内推岗位",
  "referralDetail.field.referrer": "内推人",
  "referralDetail.field.contact": "联系方式",
  "referralDetail.field.relation": "关系",
  "referralDetail.field.channel": "渠道",
  "referralDetail.field.code": "内推码",
  "referralDetail.field.submittedAt": "投递日期",
  "referralDetail.field.job": "关联岗位",
  "referralDetail.field.createdAt": "创建时间",
  "referralDetail.field.updatedAt": "更新时间",
  "referralDetail.value.notRecorded": "未记录",
  "referralDetail.value.unknown": "未知",
  "referralDetail.value.empty": "（无）",
  "referralDetail.section.note": "备注",
  "referralDetail.section.images": "图片备注（{count}）",
  "referralDetail.image.noteAlt": "备注图",
  "referralDetail.action.edit": "编辑",
  "referralDetail.image.previewMask": "查看第 {index} 张图片",
} as const;

export default referralDetail;
