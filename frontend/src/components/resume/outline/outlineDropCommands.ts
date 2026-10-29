// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲拖拽的**命令构造**（落点语义 → `OutlineCommand`）。
 *
 * 单独成文件的原因只有一条预算：`outlineDropTargets.ts` 是落点**解析**（键 → 目标 → 下标），
 * 带 band 语义的长注释，已经贴着 500 行硬红线；这个函数是"解析结果 → 一条命令"的纯构造，
 * 职责本来就分得开（`dragDropCommand` 留在那边是因为它要读模型的扁平要点列表）。
 *
 * ## 空字段占位行的落点为什么必须单独一条命令
 *
 * 跨字段搬移把某个要点数组搬空后（`courses: []`），那个字段在扁平列表里一条要点都没有，
 * `flatInsertionOf` 的一切 `(from, to)` 都推不出 `targetField = courses`——硬用扁平下标算会得到
 * "位置没变、字段却变了"或"落到相邻字段"的错误语义。占位行的含义只有一个：
 * **把这条搬进该字段**，而该字段此刻是空的，所以 `toIndex` 恒为 `0`。
 *
 * 条目拖动（`kind: "entry"`）没有"搬进字段"这种落点 → 返回 `null`。
 */
import type { OutlineDragPayload } from "./useOutlineSort";
import type { OutlineCommand } from "../../../features/resume-outline/types";

/**
 * 空字段占位行的落点 → 一条 `move-point`（"搬进这个字段的第 0 位"）。
 *
 * 命中判定在 `outlineDropTargets.classifyDropKey` / `bandHitRow`（`kind: "field"`）；
 * 这里只负责把它翻译成命令，保证"一次搬移 = 一条命令 = 一步历史"。
 */
export function dragFieldCommand(
  payload: OutlineDragPayload,
  pointField: string,
): OutlineCommand | null {
  if (payload.kind !== "point") return null;
  return {
    type: "move-point",
    field: payload.field,
    objectId: payload.objectId,
    fromPointField: payload.pointField,
    toPointField: pointField,
    pointId: payload.pointId,
    toIndex: 0,
  };
}
