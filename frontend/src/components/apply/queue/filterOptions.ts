// SPDX-License-Identifier: Apache-2.0
/**
 * 投递队列的两个筛选下拉的选项清单（自 ApplyQueuePanel 拆出）。
 *
 * 单独成 `.ts` 而不是放进 `QueueFilterBar.tsx`：那个文件只导出组件，React Fast Refresh
 * 才不会退化成整页刷新（同 `common/rowActionMenu.tsx` 的注释）。
 */
import {
  ADMISSION_META,
  QUEUE_STATUS_META,
  type AdmissionResult,
  type QueueStatus,
} from "../../../types";
import { t } from "../../../i18n";

/** 状态筛选选项：直接从 QUEUE_STATUS_META 取，文案与表格里的状态标签同源。 */
export const STATUS_FILTER_OPTIONS = (
  Object.entries(QUEUE_STATUS_META) as [QueueStatus, { label: string; color: string }][]
).map(([value, meta]) => ({ value, label: meta.label }));

/**
 * 准入筛选选项：**派生**自 `ADMISSION_META`（唯一正本），标签因此与准入徽标同源。
 * 末尾的「未分析」是**筛选专用哨兵**：`admission === null` 时 Select 的 value 不能是
 * null，而它不是准入结论（后端只下发三值），所以不进 `ADMISSION_META`。
 */
export const UNANALYZED_FILTER = "unanalyzed";

/**
 * 准入筛选选项（渲染期构建）：前三条的显示名仍来自 types 的 `ADMISSION_META`（协议值→
 * 展示名的唯一正本，待 types 层枚举 code 化），只有筛选专用哨兵「未分析」走语言包。
 */
export function admissionFilterOptions(): { value: string; label: string }[] {
  return [
    ...(
      Object.entries(ADMISSION_META) as [AdmissionResult, { label: string; color: string }][]
    ).map(([value, meta]) => ({ value, label: meta.label })),
    { value: UNANALYZED_FILTER, label: t("applyQueue.admission.unanalyzed") },
  ];
}
export type AdmissionFilterValue = AdmissionResult | typeof UNANALYZED_FILTER;
