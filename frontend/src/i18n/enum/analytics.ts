// SPDX-License-Identifier: Apache-2.0
/**
 * 求职统计（数据看板）独有的「协议值 → 语言包 key」映射：图内坐标轴文案。
 *
 * 后端 `/api/analytics/dashboard` 有几处**直接下发中文展示名**而不是协议值：
 *
 * - `funnel[].label` / `record_sources[].label` / `referral_status[]`：前两者的
 *   `status` / `key` 与「求职进度」页是同一套协议值，映射表在 `i18n/enum/tracker.ts`
 *   （`TRACK_STATUS_LABEL_KEYS` / `TRACK_SOURCE_LABEL_KEYS`）；内推状态在
 *   `i18n/enum/referral.ts`。同一个协议值在两处必须是同一个名字，所以这里**不再复制**
 *   一份，页面层直接引用那两张表。
 * - `trend[].label` / `weekday[].label`：本页独有的坐标轴文案，按接口里的稳定字段
 *   映射（`trend[].month` 的月份号、`weekday[].key` 的星期序号），键表放在这里。
 *
 * 映射不到时由调用方回退后端原文——宁可显示原文，也不丢信息。这里**只放常量表**：值是
 * 要在渲染期才求值的 `t()` key，模块作用域不求值 `t()`——取文案的函数在
 * `pages/analytics/analyticsLabels.ts`。
 */
import type { MessageKey } from "../../i18n";

/** 后端 `weekday[].key` 的取值：`date.weekday()` 的序号，0 = 周一 … 6 = 周日。 */
export type WeekdayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";

/** 周内分布的星期名：**键是后端 `weekday[].key`**（接口里的 `label` 是中文，不能拿来当键），
 *  值指向语言包 key。中文仍是「周一」这种完整形态，与后端原文逐字一致。 */
export const WEEKDAY_LABEL_KEYS: Record<WeekdayKey, MessageKey> = {
  "0": "analyticsPage.weekday.mon",
  "1": "analyticsPage.weekday.tue",
  "2": "analyticsPage.weekday.wed",
  "3": "analyticsPage.weekday.thu",
  "4": "analyticsPage.weekday.fri",
  "5": "analyticsPage.weekday.sat",
  "6": "analyticsPage.weekday.sun",
};

/** 趋势图的月份短标签：**键是后端 `trend[].month`（"YYYY-MM"）里的月份号 1..12**，
 *  值指向语言包 key。中文是「9月」这种与后端原文逐字一致的形态；英文用 "Sep" 这类短名——
 *  一张图要并排放下 12 个月，全名会互相挤到一起被截断。 */
export const TREND_MONTH_LABEL_KEYS: Record<number, MessageKey> = {
  1: "analyticsPage.trend.monthLabel.1",
  2: "analyticsPage.trend.monthLabel.2",
  3: "analyticsPage.trend.monthLabel.3",
  4: "analyticsPage.trend.monthLabel.4",
  5: "analyticsPage.trend.monthLabel.5",
  6: "analyticsPage.trend.monthLabel.6",
  7: "analyticsPage.trend.monthLabel.7",
  8: "analyticsPage.trend.monthLabel.8",
  9: "analyticsPage.trend.monthLabel.9",
  10: "analyticsPage.trend.monthLabel.10",
  11: "analyticsPage.trend.monthLabel.11",
  12: "analyticsPage.trend.monthLabel.12",
};
