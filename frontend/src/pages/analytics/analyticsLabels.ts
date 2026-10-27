// SPDX-License-Identifier: Apache-2.0
/** 数据看板的显示名取用（2026-10-28 与 AnalyticsBlocks 一起从 AnalyticsPage 拆出）。
 *
 * 单独成文件的原因：`react-refresh/only-export-components` 要求组件文件只导出组件，
 * 这几段「协议值 → 文案」的小函数被组件和页面同时使用。
 *
 * 协议值与语言包 key 的对照表**不在这个文件里**：阶段名与记录来源在 `i18n/enum/tracker.ts`
 * （与「求职进度」页共用同一张表），内推状态在 `i18n/enum/referral.ts`，图内坐标轴
 * （月份 / 星期）在本页独有的 `i18n/enum/analytics.ts`。这里只负责在渲染期求值 `t()`。
 *
 * 后端下发中文展示名的几处（漏斗阶段 / 趋势月份 / 周内分布 / 记录来源）按接口里的稳定字段
 * 映射，映射不到就回退后端原文——宁可显示原文，也不丢信息。
 */
import { t } from "../../i18n";
import { TREND_MONTH_LABEL_KEYS, WEEKDAY_LABEL_KEYS } from "../../i18n/enum/analytics";
import type { WeekdayKey } from "../../i18n/enum/analytics";
import { referralStatusLabelKey } from "../../i18n/enum/referral";
import { TRACK_SOURCE_LABEL_KEYS, TRACK_STATUS_LABEL_KEYS } from "../../i18n/enum/tracker";
import type { TrackStatus, TrackSource } from "../../types";

/** 内推状态显示名；未知取值原样显示（与旧的 `?? item.key` 同义）。 */
export function referralStatusLabel(key: string): string {
  const labelKey = referralStatusLabelKey(key);
  return labelKey ? t(labelKey) : key;
}

/** 阶段名：协议值 → 语言包文案；未知取值原样显示。 */
export function trackStatusLabel(status: string): string {
  const labelKey = TRACK_STATUS_LABEL_KEYS[status as TrackStatus];
  return labelKey ? t(labelKey) : status;
}

/** 漏斗阶段名：协议值 → 语言包文案；未知取值回退后端下发的原文（`funnel[].label`）。 */
export function funnelStageLabel(status: string, fallback: string): string {
  const labelKey = TRACK_STATUS_LABEL_KEYS[status as TrackStatus];
  return labelKey ? t(labelKey) : fallback;
}

/** 周内分布的星期名：按后端 `weekday[].key`（0 = 周一）映射；未知取值回退原文。 */
export function weekdayLabel(key: string, fallback: string): string {
  const labelKey = WEEKDAY_LABEL_KEYS[key as WeekdayKey];
  return labelKey ? t(labelKey) : fallback;
}

/** 趋势图的月份短标签：按 `trend[].month`（"YYYY-MM"）的月份号映射；解析不出回退原文。 */
export function trendMonthLabel(month: string, fallback: string): string {
  const labelKey = TREND_MONTH_LABEL_KEYS[Number(month.slice(5, 7))];
  return labelKey ? t(labelKey) : fallback;
}

/** 记录来源名：按 `record_sources[].key` 映射；未知取值回退原文。 */
export function recordSourceLabel(key: string, fallback: string): string {
  const labelKey = TRACK_SOURCE_LABEL_KEYS[key as TrackSource];
  return labelKey ? t(labelKey) : fallback;
}

/** 后端把明显非公司名的记录（纯数字 ID、单字垃圾、空）归并到这个中性占位。 */
// i18n-ok: 与后端 `services/analytics.UNKNOWN_COMPANY_LABEL` 逐字匹配，用于过滤而非展示
export const UNKNOWN_COMPANY_LABEL = "未填写公司";
