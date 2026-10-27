// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒域的三张「协议值 → 语言包 key」映射：类型、状态与紧急度。
 *
 * **键是协议值**：`interview` / `pending` / `overdue` 等与后端 `schemas/reminder`、
 * `services/reminder_service` 逐字对应，永远不翻。`types/reminder.ts` 的
 * `REMINDER_KIND_LABELS` / `REMINDER_STATUS_LABELS` / `REMINDER_URGENCY_LABELS`
 * 一个字都没动——本模块只在页面层把它们映到语言包 key。
 *
 * 模块作用域不能求值 `t()`（切语言不会重渲染），所以这里只放 key 表与纯查表函数。
 */
import type { MessageKey } from "../index";
import type { ReminderKind, ReminderStatus, ReminderUrgency } from "../../types";

/** 提醒类型：筛选下拉与表单下拉的 `value` 仍是协议值。 */
export const REMINDER_KIND_LABEL_KEYS: Record<ReminderKind, MessageKey> = {
  interview: "enumsReferral.reminderKind.interview",
  assessment_deadline: "enumsReferral.reminderKind.assessmentDeadline",
  hr_reply: "enumsReferral.reminderKind.hrReply",
  other: "enumsReferral.reminderKind.other",
};

/** 提醒状态：列表 Tag 与详情抽屉共用这一张。 */
export const REMINDER_STATUS_LABEL_KEYS: Record<ReminderStatus, MessageKey> = {
  pending: "enumsReferral.reminderStatus.pending",
  done: "enumsReferral.reminderStatus.done",
  dismissed: "enumsReferral.reminderStatus.dismissed",
};

/** 首页紧急度四档（判定在后端 `reminder_urgency`，这里只是短名）。 */
export const REMINDER_URGENCY_LABEL_KEYS: Record<ReminderUrgency, MessageKey> = {
  overdue: "enumsReferral.reminderUrgency.overdue",
  soon: "enumsReferral.reminderUrgency.soon",
  upcoming: "enumsReferral.reminderUrgency.upcoming",
  later: "enumsReferral.reminderUrgency.later",
};

/** 只认自己的键：原型链上的 `constructor` / `__proto__` 不能变成显示名。 */
function lookup<K extends string>(
  labels: Record<K, MessageKey>,
  value: string,
): MessageKey | undefined {
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value as K] : undefined;
}

/** 未知取值返回 `undefined`，调用方回退成后端下发的原值（不丢信息）。 */
export function reminderKindLabelKey(value: string): MessageKey | undefined {
  return lookup(REMINDER_KIND_LABEL_KEYS, value);
}

/** 未知取值返回 `undefined`，调用方回退成后端下发的原值（不丢信息）。 */
export function reminderStatusLabelKey(value: string): MessageKey | undefined {
  return lookup(REMINDER_STATUS_LABEL_KEYS, value);
}

/** 未知取值返回 `undefined`，调用方回退成后端下发的原值（不丢信息）。 */
export function reminderUrgencyLabelKey(value: string): MessageKey | undefined {
  return lookup(REMINDER_URGENCY_LABEL_KEYS, value);
}
