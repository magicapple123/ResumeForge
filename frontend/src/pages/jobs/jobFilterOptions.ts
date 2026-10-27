// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场的筛选选项与批量操作类型。
 * （自 JobsPage 拆出的共享常量：筛选栏与批量工具栏都用 STATUS_OPTIONS。）
 */
import type { MessageKey } from "../../i18n";

// 岗位类型 / 状态选项定义在 `types/job.ts`（唯一来源），这里只转发并保留旧名。
// 这两张表的 `value` 与 `label` 都是落库的数据值（协议值），由类型层带 `i18n-ok` 说明。
export { JOB_TYPE_OPTIONS, JOB_STATUS_OPTIONS as STATUS_OPTIONS } from "../../types/job";
// 与后端 `source_kind` 查询参数一一对应；`value` 是协议值，标签走语言包（`labelKey`），
// 渲染处再 `t()`。「自动采集 / 手动添加」是用户能一眼理解的二分，不是把 recognition_source
// 的原始值直接搬上来。
export const SOURCE_KIND_OPTIONS: { value: "collected" | "manual"; labelKey: MessageKey }[] = [
  { value: "collected", labelKey: "jobsPage.filter.sourceCollected" },
  { value: "manual", labelKey: "jobsPage.filter.sourceManual" },
];

export type BatchAction = "status" | "delete" | "enqueue" | null;
