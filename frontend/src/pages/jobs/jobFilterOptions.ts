// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场的筛选选项与批量操作类型。
 * （自 JobsPage 拆出的共享常量：筛选栏的来源选项与两处共用的批量动作类型。）
 */
import type { MessageKey } from "../../i18n";

// 岗位类型 / 状态两张表仍归 `types/job.ts`（协议值的唯一来源），但展示名已改为
// `src/i18n/enum/jobs.ts` 的 LABEL_KEYS，由筛选栏与批量工具栏在渲染期 `t()`。
// 与后端 `source_kind` 查询参数一一对应；`value` 是协议值，标签走语言包（`labelKey`），
// 渲染处再 `t()`。「自动采集 / 手动添加」是用户能一眼理解的二分，不是把 recognition_source
// 的原始值直接搬上来。
export const SOURCE_KIND_OPTIONS: { value: "collected" | "manual"; labelKey: MessageKey }[] = [
  { value: "collected", labelKey: "jobsPage.filter.sourceCollected" },
  { value: "manual", labelKey: "jobsPage.filter.sourceManual" },
];

export type BatchAction = "status" | "delete" | "enqueue" | null;
