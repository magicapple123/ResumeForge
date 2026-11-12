// SPDX-License-Identifier: Apache-2.0
/**
 * 批注列表的合并、筛选与计数（W18 / 契约 §4.3–§4.4）。
 *
 * 去重是**服务端**的职责（唯一约束 `(share_package_id, external_id)`，重复导入跳过且
 * 不更新已有状态）。前端这里做两件不重复的事：
 * 1. 把"重新拉取的完整列表"与本地列表按服务端 `id` 合并（同一批数据不重复渲染）；
 * 2. 状态筛选与头部计数（纯展示，不改变任何状态）。
 */
import type { ReviewAnnotationRecord, ReviewAnnotationStatus, ReviewStatusFilter } from "./types";

export interface ReviewMergeResult {
  annotations: ReviewAnnotationRecord[];
  added: number;
  /** 服务端 `id` 已存在而跳过的条数。 */
  duplicates: number;
}

/** 按服务端 `id` 合并两份列表（已有项保留原对象：本地刚 resolve 的状态不被旧列表覆盖）。 */
export function mergeAnnotationRecords(
  existing: readonly ReviewAnnotationRecord[],
  incoming: readonly ReviewAnnotationRecord[],
): ReviewMergeResult {
  const merged = existing.slice();
  const seen = new Set(existing.map((annotation) => annotation.id));
  let added = 0;
  let duplicates = 0;
  for (const annotation of incoming) {
    if (seen.has(annotation.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(annotation.id);
    merged.push(annotation);
    added += 1;
  }
  return { annotations: merged, added, duplicates };
}

/** 单条状态替换（resolve/reopen/dismiss/reattach 成功后用返回值替换列表中同 id 项）。 */
export function replaceAnnotationRecord(
  annotations: readonly ReviewAnnotationRecord[],
  updated: ReviewAnnotationRecord,
): ReviewAnnotationRecord[] {
  return annotations.map((annotation) => (annotation.id === updated.id ? updated : annotation));
}

/** 按状态筛选。 */
export function filterAnnotationsByStatus(
  annotations: readonly ReviewAnnotationRecord[],
  filter: ReviewStatusFilter,
): ReviewAnnotationRecord[] {
  if (filter === "all") return annotations.slice();
  return annotations.filter((annotation) => annotation.status === filter);
}

export interface ReviewStatusSummary {
  total: number;
  open: number;
  resolved: number;
  stale: number;
  dismissed: number;
}

/** 头部计数（只依赖状态字段）。 */
export function summarizeAnnotationStatus(
  annotations: readonly ReviewAnnotationRecord[],
): ReviewStatusSummary {
  const summary: ReviewStatusSummary = {
    total: annotations.length,
    open: 0,
    resolved: 0,
    stale: 0,
    dismissed: 0,
  };
  for (const annotation of annotations) summary[annotation.status] += 1;
  return summary;
}

/** 状态筛选按钮的固定顺序（UI 与测试共用一份）。 */
export const REVIEW_STATUS_FILTERS: readonly ReviewStatusFilter[] = [
  "all",
  "open",
  "resolved",
  "stale",
  "dismissed",
];

/** 状态 → i18n key 后缀（`review.status.<suffix>`）；组件只拼这一处映射。 */
export const REVIEW_STATUS_LABEL: Record<ReviewAnnotationStatus, string> = {
  open: "open",
  resolved: "resolved",
  stale: "stale",
  dismissed: "dismissed",
};
