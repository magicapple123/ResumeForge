// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列的两个筛选下拉的选项清单（自 ApplyQueuePanel 拆出）。
 *
 * 单独成 `.ts` 而不是放进 `QueueFilterBar.tsx`：那个文件只导出组件，React Fast Refresh
 * 才不会退化成整页刷新（同 `common/rowActionMenu.tsx` 的注释）。
 *
 * 两个清单都在**渲染期**构建：展示名取语言包（`i18n/enum/apply.ts` 的 key 表），`value`
 * 仍是后端协议值。调用方 `useLocale()` 订阅语言变化，切语言后重建 options 才会拿到新文案。
 */
import { t } from "../../../i18n";
import { ADMISSION_LABEL_KEYS, QUEUE_STATUS_LABEL_KEYS } from "../../../i18n/enum/apply";
import type { AdmissionResult, QueueStatus } from "../../../types";

/** 状态筛选选项：顺序与 `QUEUE_STATUS_META` 一致，文案与表格里的状态标签同源。 */
export function statusFilterOptions(): { value: QueueStatus; label: string }[] {
  return (Object.keys(QUEUE_STATUS_LABEL_KEYS) as QueueStatus[]).map((value) => ({
    value,
    label: t(QUEUE_STATUS_LABEL_KEYS[value]),
  }));
}

/**
 * 准入筛选选项：与准入徽标同源（同一份 key 表）。
 * 末尾的「未分析」是**筛选专用哨兵**：`admission === null` 时 Select 的 value 不能是
 * null，而它不是准入结论（后端只下发三值），所以不进 `ADMISSION_META`。
 */
export const UNANALYZED_FILTER = "unanalyzed";

export function admissionFilterOptions(): { value: string; label: string }[] {
  return [
    ...(Object.keys(ADMISSION_LABEL_KEYS) as AdmissionResult[]).map((value) => ({
      value,
      label: t(ADMISSION_LABEL_KEYS[value]),
    })),
    { value: UNANALYZED_FILTER, label: t("applyQueue.admission.unanalyzed") },
  ];
}
export type AdmissionFilterValue = AdmissionResult | typeof UNANALYZED_FILTER;
