// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒倒计时胶囊的文案：把后端下发的**结构化天数**按当前界面语言组合出来。
 *
 * ## 为什么不直接用 `due_label`
 *
 * 后端 `/api/reminders/upcoming` 会同时下发 `days_until`（整数）与 `due_label`
 * （后端拼好的中文，如「已逾期 1 天」「今天」「2 天后」）。`due_label` 只为兼容旧前端和
 * 其它调用方保留：直接渲染它，英文界面里这一颗 Tag 会是全屏唯一的中文。
 *
 * ## 为什么回退到 `due_label`
 *
 * `days_until` 是后加的字段：旧后端（或旧测试数据）没有它。此时宁可露出后端给的中文，
 * 也不要渲染一个空胶囊——空 Tag 会让"什么时候到期"这条信息彻底消失。
 */
import { t } from "../i18n";

/**
 * 把 `days_until` 翻成当前语言的倒计时文案。
 *
 * @param daysUntil 后端给的结构化倒计时：负数=逾期天数，0=今天，1=明天，N=N 天后。
 *   缺失（旧后端）或不是有限数时按 `fallback` 处理。
 * @param fallback 拿不到结构化天数时显示的文案，通常是后端下发的 `due_label`。
 * @returns 当前界面语言下的倒计时文案。
 */
export function reminderDueLabel(daysUntil: number | null | undefined, fallback: string): string {
  if (typeof daysUntil !== "number" || !Number.isFinite(daysUntil)) return fallback;
  // 后端只发整数；下游若给出小数，截断比渲染「In 1.5 days」更像人话。
  const days = Math.trunc(daysUntil);
  if (days < 0) return t("homePage.reminders.due.overdue", { days: -days });
  if (days === 0) return t("homePage.reminders.due.today");
  if (days === 1) return t("homePage.reminders.due.tomorrow");
  return t("homePage.reminders.due.inDays", { days });
}
