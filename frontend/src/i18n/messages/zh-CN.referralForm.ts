// SPDX-License-Identifier: Apache-2.0
/**
 * 内推表单：字段标签、占位符、日期说明与图片备注上传块。
 *
 * 内推状态的取值是**协议值**（`active` / `submitted` / `closed` / `invalid`，见
 * `types/referral.ts`，与后端逐字对应）。本文件只负责它们的显示名，
 * `ReferralFormFields.tsx` 里那张 `Record<ReferralStatus, MessageKey>` 的键仍是协议值，
 * `types/referral.ts` 一个字都没改——中文表另有消费者（列表与详情抽屉）。
 *
 * 占位符里的 `/` 是**并列分隔**，不是可省略的装饰：「姓名 / 称呼」「朋友 / 前同事 / 网友」
 * 都是在说"这里能填哪几种东西"，英文保留同样的分隔结构，不要压成一个词。
 */
const referralForm = {
  "referralForm.field.company": "公司",
  "referralForm.placeholder.company": "公司名",
  "referralForm.field.position": "内推岗位",
  "referralForm.placeholder.position": "岗位名",
  "referralForm.field.referrer": "内推人",
  "referralForm.placeholder.referrer": "姓名 / 称呼",
  "referralForm.field.contact": "联系方式",
  "referralForm.placeholder.contact": "微信 / 邮箱等",
  "referralForm.field.relation": "关系",
  "referralForm.placeholder.relation": "朋友 / 前同事 / 网友…",
  "referralForm.field.channel": "渠道",
  "referralForm.placeholder.channel": "牛客 / 脉脉 / 熟人直递…",
  "referralForm.field.code": "内推码",
  "referralForm.placeholder.code": "官网内推码（选填）",
  "referralForm.field.status": "状态",
  "referralForm.field.job": "关联岗位（选填，删除岗位不影响内推）",
  "referralForm.placeholder.job": "输入关键词搜索岗位",
  "referralForm.field.track": "转化关联漏斗（选填，进入面试及以上即视为转化）",
  "referralForm.placeholder.track": "输入关键词搜索进度",
  "referralForm.field.submittedAt": "投递日期",
  "referralForm.hint.submittedAt": "留空表示未知",
  "referralForm.field.images": "图片备注（选填，最多 {count} 张）",
  "referralForm.action.uploadImage": "上传备注图",
  "referralForm.aria.uploadProgress": "备注图上传进度",
  "referralForm.imageAlt": "备注图 {index}",
  "referralForm.removeImage": "移除备注图 {index}",
  "referralForm.field.note": "备注",
  "referralForm.placeholder.note": "补充说明（选填）",
  "referralForm.status.active": "已联系",
  "referralForm.status.submitted": "已提交",
  "referralForm.status.closed": "已关闭",
  "referralForm.status.invalid": "无效",
  // 列表工具栏（`ReferralToolbar`）：与表单同属内推功能，共用本命名空间。
  "referralForm.toolbar.title": "内推记录",
  "referralForm.toolbar.searchPlaceholder": "搜索公司 / 岗位 / 内推人",
  "referralForm.toolbar.statusPlaceholder": "状态筛选",
  "referralForm.toolbar.create": "新建内推",
} as const;

export default referralForm;
