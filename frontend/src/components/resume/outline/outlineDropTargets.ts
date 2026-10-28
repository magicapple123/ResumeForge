// SPDX-License-Identifier: Apache-2.0
/**
 * 拖拽落点的**纯解析**（用户反馈 #4：拖动"大部分情况下拖不动"）。
 *
 * ## 为什么落点解析不能只靠行级事件
 *
 * 旧实现把 `onDrop` 挂在每一行（`.resume-outline-row`，28px 高、行与行之间还有缝隙）上：
 * 松手位置差一两像素就会落到分组容器/板块标题/行间缝隙上——**没有任何 drop 处理器**，
 * 浏览器直接按"拖到无效区域"处理（只有 dragend），顺序静默不变。真机实测：向下拖第二条
 * 压第一条、要点第二条拖第一条，都因为落点落在边缘/缝隙而失败。
 *
 * 现在把 drop 提到**树容器**上，落点按下面的优先级解析：
 * 1. 松在同类行上 → 该行在**基准模型**里的下标；
 * 2. 松在被拖对象自己身上 → "self"（提交排序会话的最后一步，保持既有语义）；
 * 3. 松在缝隙 / 分组容器 / 同板块标题上 → 按指针纵向位置找同组最近行（"nearest"）；
 * 4. 松在别的板块/别的条目上 → 拒绝（不猜用户意图）。
 *
 * 这里全部是纯函数（行坐标由调用方量好传进来），jsdom 里可以直接测解析规则；
 * "拖动中预览会把行挪位"这件事因此不会影响落点：一律按**对象 id 回查基准下标**。
 */
import { t } from "../../../i18n";
import {
  findOutlineEntry,
  findOutlinePoint,
  type OutlineModel,
} from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { OutlineDragPayload } from "./useOutlineSort";

/** `data-tree-key` 解析结果（与 `outlineTree.ts` 的键格式一致）。 */
export type TreeKeyTarget =
  | { kind: "entry"; field: string; objectId: string }
  | { kind: "point"; field: string; objectId: string; pointField: string; pointId: string }
  | { kind: "section"; field: string }
  | { kind: "personal" }
  | null;

export function parseTreeKey(key: string): TreeKeyTarget {
  if (!key) return null;
  if (key === "personal") return { kind: "personal" };
  const parts = key.split(":");
  if (parts[0] === "section" && parts.length >= 2) return { kind: "section", field: parts[1] };
  if (parts[0] === "entry" && parts.length >= 3) {
    return { kind: "entry", field: parts[1], objectId: parts[2] };
  }
  if (parts[0] === "point" && parts.length >= 5) {
    return {
      kind: "point",
      field: parts[1],
      objectId: parts[2],
      pointField: parts[3],
      pointId: parts[4],
    };
  }
  return null;
}

/** 条目在基准模型里的下标（`reorder-entry` 的 toIndex 口径）。 */
export function entryIndexInModel(model: OutlineModel, field: string, objectId: string): number {
  const section = model.sections.find((item) => item.field === field);
  return section?.entries.find((item) => item.objectId === objectId)?.index ?? -1;
}

/** 要点在它那个 pointField 分组里的基准下标（`reorder-point` 的 toIndex 口径）。 */
export function pointIndexInModel(
  model: OutlineModel,
  field: string,
  objectId: string,
  pointField: string,
  pointId: string,
): number {
  return (
    findOutlinePoint(model, {
      kind: "point",
      field: field as never,
      objectId,
      pointField,
      pointId,
    })?.index ?? -1
  );
}

/** 被拖对象当前的基准下标（判断"原地松手"用：原地不算一次改动）。 */
export function dragStartIndex(model: OutlineModel, payload: OutlineDragPayload): number {
  if (payload.kind === "entry") return entryIndexInModel(model, payload.field, payload.objectId);
  return pointIndexInModel(
    model,
    payload.field,
    payload.objectId,
    payload.pointField,
    payload.pointId,
  );
}

/** 拖拽会话里显示/播报用的名字（与键盘会话同一套 t()）。 */
export function dragPayloadName(model: OutlineModel, payload: OutlineDragPayload): string {
  if (payload.kind === "entry") {
    const entry = findOutlineEntry(model, {
      kind: "entry",
      field: payload.field,
      objectId: payload.objectId,
    });
    return entry && entry.title ? entry.title : t("outline.entry.untitled");
  }
  const point = findOutlinePoint(model, {
    kind: "point",
    field: payload.field,
    objectId: payload.objectId,
    pointField: payload.pointField,
    pointId: payload.pointId,
  });
  return point?.text || t("outline.point.label");
}

/** drop 的解析结果：落在同类行 / 落在被拖对象自己 / 需要按纵向就近找 / 拒绝。 */
export type DropResolution =
  { kind: "row"; index: number } | { kind: "self" } | { kind: "nearest" } | { kind: "reject" };

/**
 * 直接把 drop 的 `data-tree-key` 映射成落点；返回 `nearest` 表示"不算行，按指针就近找"。
 *
 * 松在**别的板块/别的条目**上时一律拒绝：跨板块拖动不是这个功能的语义（渲染端也不允许），
 * 就近猜测会让用户在完全无关的位置松手时看到顺序莫名变化。
 */
export function classifyDropKey(
  model: OutlineModel,
  payload: OutlineDragPayload,
  key: string,
): DropResolution {
  if (!key) return { kind: "nearest" };
  const target = parseTreeKey(key);
  if (!target) return { kind: "reject" };
  if (target.kind === "personal") return { kind: "reject" };
  if (target.kind === "section") {
    return target.field === payload.field ? { kind: "nearest" } : { kind: "reject" };
  }
  if (payload.kind === "entry") {
    if (target.kind !== "entry" || target.field !== payload.field) return { kind: "reject" };
    if (target.objectId === payload.objectId) return { kind: "self" };
    const index = entryIndexInModel(model, target.field, target.objectId);
    return index >= 0 ? { kind: "row", index } : { kind: "reject" };
  }
  if (
    target.kind !== "point" ||
    target.field !== payload.field ||
    target.objectId !== payload.objectId ||
    target.pointField !== payload.pointField
  ) {
    return { kind: "reject" };
  }
  if (target.pointId === payload.pointId) return { kind: "self" };
  const index = pointIndexInModel(
    model,
    target.field,
    target.objectId,
    target.pointField,
    target.pointId,
  );
  return index >= 0 ? { kind: "row", index } : { kind: "reject" };
}

/** 一行在当前 DOM 里的纵向中心（调用方量好传进来，纯函数好测）。 */
export interface DropRowBox {
  key: string;
  centerY: number;
}

/**
 * 缝隙 / 板块标题上的落点：在**同组可见行**里找离指针最近的一行。
 *
 * 只按"当前 DOM 里哪行离指针最近"选，再回基准模型查下标——拖动中预览会让行换位，
 * 但每一行仍然代表同一个对象 id，所以 id → 基准下标永远是对的。
 */
export function nearestDropIndex(
  model: OutlineModel,
  payload: OutlineDragPayload,
  rows: readonly DropRowBox[],
  pointerY: number,
): { kind: "row"; index: number } | { kind: "self" } | null {
  let best: {
    resolution: { kind: "row"; index: number } | { kind: "self" };
    distance: number;
  } | null = null;
  for (const row of rows) {
    const target = parseTreeKey(row.key);
    if (!target) continue;
    let resolution: { kind: "row"; index: number } | { kind: "self" } | null = null;
    if (payload.kind === "entry") {
      if (target.kind !== "entry" || target.field !== payload.field) continue;
      if (target.objectId === payload.objectId) resolution = { kind: "self" };
      else {
        const index = entryIndexInModel(model, target.field, target.objectId);
        if (index >= 0) resolution = { kind: "row", index };
      }
    } else {
      if (
        target.kind !== "point" ||
        target.field !== payload.field ||
        target.objectId !== payload.objectId ||
        target.pointField !== payload.pointField
      ) {
        continue;
      }
      if (target.pointId === payload.pointId) resolution = { kind: "self" };
      else {
        const index = pointIndexInModel(
          model,
          target.field,
          target.objectId,
          target.pointField,
          target.pointId,
        );
        if (index >= 0) resolution = { kind: "row", index };
      }
    }
    if (!resolution) continue;
    const distance = Math.abs(row.centerY - pointerY);
    if (!best || distance < best.distance) best = { resolution, distance };
  }
  return best?.resolution ?? null;
}

/** 落点下标 → 一条 reorder 命令（与键盘/会话提交共用命令层，语义不可能分叉）。 */
export function dragDropCommand(payload: OutlineDragPayload, toIndex: number): OutlineCommand {
  if (payload.kind === "entry") {
    return { type: "reorder-entry", field: payload.field, objectId: payload.objectId, toIndex };
  }
  return {
    type: "reorder-point",
    field: payload.field,
    objectId: payload.objectId,
    pointField: payload.pointField,
    pointId: payload.pointId,
    toIndex,
  };
}
