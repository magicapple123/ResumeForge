// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒列表的「时间范围」筛选（T06）：全部 / 已逾期 / 今天 / 以后。
 *
 * 判定用后端下发的 `days_until`（结构化倒计时：负数=逾期天数），**不在前端按小时重算**——
 * 「已逾期 N 天」的红标与首页「近期提醒」卡必须逐字一致，两处口径都只来自
 * `services/reminder_service.reminder_days_until`。
 *
 * 逾期/今天/以后只对 pending 有意义：已完成/已忽略的提醒没有"接下来要做什么"的语义，
 * 统一不进这三个范围（选「全部」时照常显示）。
 */
import type { MessageKey } from "../../i18n";
import type { Reminder } from "../../types";

export type ReminderTimeRange = "all" | "overdue" | "today" | "future";

/** 下拉选项顺序（协议值 → 显示名走语言包）。 */
export const REMINDER_TIME_RANGES: readonly ReminderTimeRange[] = [
  "all",
  "overdue",
  "today",
  "future",
];

export const REMINDER_TIME_RANGE_LABEL_KEYS: Record<ReminderTimeRange, MessageKey> = {
  all: "reminder.filter.range.all",
  overdue: "reminder.filter.range.overdue",
  today: "reminder.filter.range.today",
  future: "reminder.filter.range.future",
};

/** 单条提醒是否落在时间范围内。 */
export function inTimeRange(item: Reminder, range: ReminderTimeRange): boolean {
  if (range === "all") return true;
  if (item.status !== "pending") return false;
  const days = item.days_until;
  // 旧后端没有 days_until：不猜，按"不在范围内"处理（避免把未知当成逾期/今天）。
  if (typeof days !== "number" || !Number.isFinite(days)) return false;
  if (range === "overdue") return days < 0;
  if (range === "today") return days === 0;
  return days > 0;
}

/** 按时间范围过滤列表（筛选后由调用方重置到第 1 页并重算总数）。 */
export function filterByTimeRange(items: Reminder[], range: ReminderTimeRange): Reminder[] {
  if (range === "all") return items;
  return items.filter((item) => inTimeRange(item, range));
}
