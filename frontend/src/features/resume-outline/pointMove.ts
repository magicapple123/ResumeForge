// SPDX-License-Identifier: Apache-2.0
/**
 * 要点的**跨字段搬移**（用户反馈：教育经历里的第一条要点拖不动）。
 *
 * ## 为什么只能"搬字段"，不能"扁平交织"
 *
 * 同一条目可以有多个要点数组（`ENTRY_POINT_FIELDS`）：教育经历是 `courses` + `achievements`，
 * 项目是 `tech_stack` + `description` + `highlights`。大纲把它们的条目拼成**一条扁平列表**
 * 展示，于是四行看起来一模一样，其实分属两个数组；旧实现只在单个数组内重排，第一行
 * （`courses`）永远拖不动——这正是本轮缺陷的原形。
 *
 * 纸面（`backend/app/templates/_resume_blocks.j2`）**按字段**渲染：`courses` 是一行带标签的
 * 行内文本（`主修课程：…`），`achievements` 是 `<ul>` 项目符号。所以"顺序"只存在于数组内部，
 * 跨字段拖动只能实现成"把这一条内容连同身份搬进目标字段的数组"——它随之变成目标字段的条目
 * （课程行拖到项目符号区就变成一条项目符号，「主修课程：」那行随之消失）。
 *
 * ## 三个不变量
 *
 * 1. **文本与 point id 一起搬**：源数组移除该项与对应 id，目标数组在**同一位置**插入
 *    （否则加粗/来源/显隐会挂到别的要点上）；
 * 2. **源字段搬空后保留空数组**：模板的 `{% if %}` 会跳过空数组，删键会让"字段还在不在"
 *    随实现漂移；`point_ids[源字段]` 同步置 `[]`；
 * 3. **同字段 = 既有 reorder 语义**：`reorder-point` 命令直接委托到这里（见 `commands.ts`），
 *    搬移与重排只有**一份**实现，两套算法不可能分叉。
 *
 * ## 下标口径（只有一种）
 *
 * 一个条目的所有要点按**字段声明顺序**拼成一条扁平列表（与模型 `entry.points` 同序）。
 * 「把第 i 条移到第 j 位」= 先从扁平列表移除第 i 条，再插到剩余列表的第 j 个位置；插到某个
 * 位置就意味着"成为该位置所属字段的条目"，于是目标字段与目标下标可以由扁平下标**唯一**推出
 * （`flatInsertionOf`）。预览（`outlineTree.previewModel`）、拖拽落点、命令三处共用这一条推导。
 */
import type { ResumeContent } from "../../types/resume";
import { reorderPreservingIds } from "../resume-document/identity";
import { readEntryFlags } from "./flags";
import { entriesOf, findEntryIndex, pointFieldsFor, pointIdsOf } from "./model";
import type { EntryField, OutlineApplyResult, OutlineCommand } from "./types";

type RawEntry = Record<string, unknown>;

/** 扁平要点引用：字段声明顺序下的一条要点（模型 `entry.points` 结构上满足它）。 */
export interface PointRef {
  pointField: string;
  pointId: string;
}

/** 扁平搬移的落点推导结果。 */
export interface FlatInsertion {
  /** 被搬走的要点会变成哪个字段的条目。 */
  targetField: string;
  /** 在目标字段数组里的插入下标（跨字段时允许等于数组长度 = 追加到末尾）。 */
  fieldIndex: number;
  /** 在"移除被搬项之后"的扁平列表里的插入下标（预览拼回用）。 */
  flatIndex: number;
}

/** 一条搬移命令的字段三元组（同字段时退化为一次重排）。 */
export interface PointMoveFields {
  fromPointField: string;
  toPointField: string;
  /** 目标字段数组里的插入下标（同字段时是"移动后的最终下标"）。 */
  toIndex: number;
  /** `true` = 没换字段：等价于一次 `reorder-point`。 */
  sameField: boolean;
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), Math.max(0, length - 1)));
}

/** 插入位置允许等于数组长度（追加到末尾），与"移动后的最终下标"不同。 */
function clampInsert(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), Math.max(0, length)));
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? [...(value as unknown[])] : [];
}

/** 要点在扁平列表里的下标（按 `pointField` + `pointId` 定位；找不到返回 -1）。 */
export function flatPointIndexOf(
  points: readonly PointRef[],
  pointField: string,
  pointId: string,
): number {
  if (!pointId) return -1;
  return points.findIndex((point) => point.pointField === pointField && point.pointId === pointId);
}

/**
 * 把扁平列表的第 `from` 条搬到第 `to` 个位置，推出目标字段与目标下标。
 *
 * - 插到某条要点前面 → 成为**那条要点所属字段**的条目（这就是"课程行拖进项目符号区"的语义）；
 * - 插到末尾 → 成为最后一条所属字段的条目（向下拖到底不会掉到"无字段"的黑洞里）；
 * - 只有一条要点时返回 `null`：移动它什么都变不了。
 */
export function flatInsertionOf(
  points: readonly PointRef[],
  from: number,
  to: number,
): FlatInsertion | null {
  if (!Number.isInteger(from) || from < 0 || from >= points.length) return null;
  if (points.length < 2) return null;
  const remaining = points.filter((_point, index) => index !== from);
  const flatIndex = clampInsert(Number.isFinite(to) ? Math.trunc(to) : 0, remaining.length);
  const anchor =
    flatIndex < remaining.length ? remaining[flatIndex] : remaining[remaining.length - 1];
  const targetField = (anchor ?? points[from]).pointField;
  let fieldIndex = 0;
  for (let index = 0; index < flatIndex; index += 1) {
    if (remaining[index].pointField === targetField) fieldIndex += 1;
  }
  return { targetField, fieldIndex, flatIndex };
}

/**
 * 排序会话 → 搬移字段三元组（键盘、拖拽、画布预览共用这一处推导）。
 *
 * 先按 id 找当前位置：会话可能是在"内容还没变"的上一帧建的，按 id 定位比信任
 * `startIndex` 稳（与命令层同一口径）。
 */
export function pointMoveOf(
  points: readonly PointRef[],
  session: {
    pointField: string;
    pointId: string;
    startIndex: number;
    currentIndex: number;
  },
): PointMoveFields | null {
  const located = flatPointIndexOf(points, session.pointField, session.pointId);
  const from =
    located >= 0
      ? located
      : Number.isInteger(session.startIndex) && session.startIndex >= 0
        ? session.startIndex
        : -1;
  if (from < 0) return null;
  const insertion = flatInsertionOf(points, from, session.currentIndex);
  if (!insertion) return null;
  const fromPointField = points[from].pointField;
  // 移到自己的下标 = **不动**。扁平插入在"移除自己后的同一位置"只会改字段、不会改顺序：
  // 那不是任何手势的意图（键盘什么都不按就确认、原地松手都会经过这里），而且必须与
  // `outlineTree.previewPoints` 的 `to === from` 短路同口径——否则预览说"什么都没变"、
  // 命令却把这一条搬到了另一个字段（纸面上「主修课程：…」整行消失，还记一步历史）。
  // 返回同字段 + 自己在本组内的下标 ⇒ `sortSessionCommand` 落回 `reorder-point`，
  // 命令层 `to === from` 得到 `changed: false`，不产生历史。
  const sameFieldIndex = points
    .slice(0, from)
    .filter((point) => point.pointField === fromPointField).length;
  if (insertion.flatIndex === from) {
    return {
      fromPointField,
      toPointField: fromPointField,
      toIndex: sameFieldIndex,
      sameField: true,
    };
  }
  return {
    fromPointField,
    toPointField: insertion.targetField,
    toIndex: insertion.fieldIndex,
    sameField: insertion.targetField === fromPointField,
  };
}

function withField(content: ResumeContent, field: string, entries: RawEntry[]): ResumeContent {
  return { ...content, [field]: entries } as unknown as ResumeContent;
}

/**
 * 执行一条 `move-point` 命令（同字段时就是 `reorder-point` 的唯一实现）。
 *
 * 校验与 `reorder-point` 完全同一套：条目不存在 → `not-found`；锁排版 → `locked-layout`；
 * 字段不属于该条目族 / 身份不完整（旧记录没物化 id、长度对不上）→ `not-found`；
 * 越界下标一律夹取（拖动/键盘不会因为边界算出非法命令）。
 */
export function movePointInContent(
  content: ResumeContent,
  command: Extract<OutlineCommand, { type: "move-point" }>,
): OutlineApplyResult {
  const entries = entriesOf(content, command.field);
  const entryIndex = findEntryIndex(content, command.field, command.objectId);
  if (entryIndex < 0) return { ok: false, reason: "not-found" };
  const entry = entries[entryIndex];
  if (readEntryFlags(entry).lockLayout) return { ok: false, reason: "locked-layout" };
  const declared = pointFieldsFor(command.field);
  if (!declared.includes(command.fromPointField) || !declared.includes(command.toPointField)) {
    return { ok: false, reason: "not-found" };
  }
  const sourcePoints = readArray(entry[command.fromPointField]);
  const sourceIds = pointIdsOf(entry, command.fromPointField);
  // 身份不完整（旧记录没物化 id / 长度对不上）时拒绝：按下标搬移会把身份挂到别的要点上。
  if (sourcePoints.length === 0 || sourceIds.length !== sourcePoints.length) {
    return { ok: false, reason: "not-found" };
  }
  const from = sourceIds.indexOf(command.pointId);
  if (from < 0) return { ok: false, reason: "not-found" };

  const sameField = command.fromPointField === command.toPointField;
  const targetPoints = sameField ? sourcePoints : readArray(entry[command.toPointField]);
  const targetIds = sameField ? sourceIds : pointIdsOf(entry, command.toPointField);
  // 目标数组为空时长度天然相等（0 = 0），所以"搬进空字段"是允许的；非空但 id 缺失才拒绝。
  if (targetIds.length !== targetPoints.length) return { ok: false, reason: "not-found" };

  const sourcePointIds =
    entry.point_ids && typeof entry.point_ids === "object"
      ? (entry.point_ids as Record<string, unknown>)
      : {};

  if (sameField) {
    const to = clampIndex(command.toIndex, sourcePoints.length);
    if (to === from) return { ok: true, content, changed: false };
    const nextEntry: RawEntry = {
      ...entry,
      [command.fromPointField]: reorderPreservingIds(sourcePoints, from, to),
      point_ids: {
        ...sourcePointIds,
        [command.fromPointField]: reorderPreservingIds(sourceIds, from, to),
      },
    };
    const nextEntries = entries.slice();
    nextEntries[entryIndex] = nextEntry;
    return { ok: true, content: withField(content, command.field, nextEntries), changed: true };
  }

  const to = clampInsert(command.toIndex, targetPoints.length);
  const nextSourcePoints = sourcePoints.filter((_point, index) => index !== from);
  const nextSourceIds = sourceIds.filter((_id, index) => index !== from);
  const nextTargetPoints = [
    ...targetPoints.slice(0, to),
    sourcePoints[from],
    ...targetPoints.slice(to),
  ];
  const nextTargetIds = [...targetIds.slice(0, to), sourceIds[from], ...targetIds.slice(to)];
  const nextEntry: RawEntry = {
    ...entry,
    // 源字段搬空后保留空数组：模板 `{% if %}` 会跳过它，字段不会"悄悄消失"。
    [command.fromPointField]: nextSourcePoints,
    [command.toPointField]: nextTargetPoints,
    point_ids: {
      ...sourcePointIds,
      [command.fromPointField]: nextSourceIds,
      [command.toPointField]: nextTargetIds,
    },
  };
  const nextEntries = entries.slice();
  nextEntries[entryIndex] = nextEntry;
  return { ok: true, content: withField(content, command.field, nextEntries), changed: true };
}

// ── 空要点字段（拖动中的占位行）──────────────────────────────────
//
// 为什么需要这一组：跨字段搬移把 `courses` 搬空后（`courses: []`），大纲里没有课程行，
// 而 `flatInsertionOf` 只能把"插到某条要点前面/末尾"翻译成目标字段——一条要点都没有的字段
// 永远推不出来，于是**拖走就拖不回来**（单向门）。修法是拖动中给这些字段渲染一行虚线占位行：
// 它是**落点提示**，不是要点（没有 id、不可拖、不可选、不参与键盘导航与字段计数）。

/**
 * 该条目**已声明但一个要点都没有**的要点字段（字段声明顺序）。
 *
 * `entry.points` 来自 `pointsOf`，空数组的字段本来就不会产生要点，所以"没出现过"即"为空"。
 * 只在拖动中渲染占位行，平时不出现（不增视觉噪音）。
 */
export function emptyPointFields(entry: {
  field: EntryField;
  points: readonly PointRef[];
}): string[] {
  return pointFieldsFor(entry.field).filter(
    (pointField) => !entry.points.some((point) => point.pointField === pointField),
  );
}

/**
 * 占位行在条目要点区里的**视觉位置** = 它前面那几个字段的要点总数。
 *
 * 例：教育经历 `courses` 为空、`achievements` 有 3 条 → `courses` 的占位行排在最前（0），
 * 因为声明顺序里 `courses` 在 `achievements` 之前。字段顺序取 `pointFieldsFor`（唯一清单），
 * 不在这里另抄一份常量。
 */
export function emptyFieldInsertIndex(
  entry: { field: EntryField; points: readonly PointRef[] },
  pointField: string,
): number {
  const order = pointFieldsFor(entry.field);
  const at = order.indexOf(pointField);
  if (at < 0) return 0;
  const before = new Set(order.slice(0, at));
  let count = 0;
  for (const point of entry.points) {
    if (before.has(point.pointField)) count += 1;
  }
  return count;
}
