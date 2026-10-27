// SPDX-License-Identifier: Apache-2.0
/** 数据看板的显示名映射（2026-10-28 与 AnalyticsBlocks 一起从 AnalyticsPage 拆出）。
 *
 * 单独成文件的原因：`react-refresh/only-export-components` 要求组件文件只导出组件，
 * 这几张「协议值 → MessageKey」表与两段取文案的小函数被组件和页面同时使用。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import type { ReferralStatus, TrackStatus } from "../../types";

/** 阶段转化/耗时卡的显示名：**键是协议值**（`applied` / `screening` …，与后端逐字对应），
 *  值指向语言包 key。与「求职进度」页共用 `trackerForm.status.*` 词表——同一个协议值在
 *  两处必须是同一个名字，各写一份迟早会漂。`types/tracker.ts` 的 `TRACK_STATUS_LABELS`
 *  一个字都没动（列表卡片仍在用）。 */
const TRACK_STATUS_LABEL_KEYS: Record<TrackStatus, MessageKey> = {
  applied: "trackerForm.status.applied",
  screening: "trackerForm.status.screening",
  assessment: "trackerForm.status.assessment",
  interview: "trackerForm.status.interview",
  offer: "trackerForm.status.offer",
  rejected: "trackerForm.status.rejected",
  unknown: "trackerForm.status.unknown",
};

/** 内推状态显示名：同上，与内推表单共用 `referralForm.status.*` 词表。
 *  `types/referral.ts` 的 `REFERRAL_STATUS_LABELS` 一个字都没动。 */
const REFERRAL_STATUS_LABEL_KEYS: Record<ReferralStatus, MessageKey> = {
  active: "referralForm.status.active",
  submitted: "referralForm.status.submitted",
  closed: "referralForm.status.closed",
  invalid: "referralForm.status.invalid",
};

/** 内推状态显示名；未知取值原样显示（与旧的 `?? item.key` 同义）。 */
export function referralStatusLabel(key: string): string {
  const labelKey = REFERRAL_STATUS_LABEL_KEYS[key as ReferralStatus];
  return labelKey ? t(labelKey) : key;
}

/** 阶段名：协议值 → 语言包文案；未知取值原样显示。 */
export function trackStatusLabel(status: string): string {
  const labelKey = TRACK_STATUS_LABEL_KEYS[status as TrackStatus];
  return labelKey ? t(labelKey) : status;
}

/** 后端把明显非公司名的记录（纯数字 ID、单字垃圾、空）归并到这个中性占位。 */
// i18n-ok: 与后端 `services/analytics.UNKNOWN_COMPANY_LABEL` 逐字匹配，用于过滤而非展示
export const UNKNOWN_COMPANY_LABEL = "未填写公司";
