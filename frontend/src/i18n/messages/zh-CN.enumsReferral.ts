// SPDX-License-Identifier: Apache-2.0
/**
 * 内推 / 提醒域的四张枚举词表：内推状态、提醒类型、提醒状态与提醒紧急度。
 *
 * 键是协议值（见 `types/referral.ts` 与 `types/reminder.ts`，与后端逐字对应），值只是
 * 显示名；页面层通过 `i18n/enum/referral.ts` 与 `i18n/enum/reminder.ts` 的映射表取 key。
 *
 * 中文值逐字等于 `types/referral.ts` 的 `REFERRAL_STATUS_LABELS` 与 `types/reminder.ts`
 * 的 `REMINDER_KIND_LABELS` / `REMINDER_STATUS_LABELS` / `REMINDER_URGENCY_LABELS`，
 * 迁移前后中文渲染结果不变；两张 `types` 表一个字都没动。
 */
const enumsReferral = {
  // ===== 内推状态（REFERRAL_STATUS_LABELS 的显示名） =====
  "enumsReferral.referralStatus.active": "已联系",
  "enumsReferral.referralStatus.submitted": "已提交",
  "enumsReferral.referralStatus.closed": "已关闭",
  "enumsReferral.referralStatus.invalid": "无效",

  // ===== 提醒类型（REMINDER_KIND_LABELS 的显示名） =====
  "enumsReferral.reminderKind.interview": "面试",
  "enumsReferral.reminderKind.assessmentDeadline": "测评/笔试截止",
  "enumsReferral.reminderKind.hrReply": "催 HR 回复",
  "enumsReferral.reminderKind.other": "其他",

  // ===== 提醒状态（REMINDER_STATUS_LABELS 的显示名） =====
  "enumsReferral.reminderStatus.pending": "待办",
  "enumsReferral.reminderStatus.done": "已完成",
  "enumsReferral.reminderStatus.dismissed": "已忽略",

  // ===== 提醒紧急度（REMINDER_URGENCY_LABELS 的显示名） =====
  "enumsReferral.reminderUrgency.overdue": "已逾期",
  "enumsReferral.reminderUrgency.soon": "临近",
  "enumsReferral.reminderUrgency.upcoming": "即将",
  "enumsReferral.reminderUrgency.later": "稍后",
} as const;

export default enumsReferral;
