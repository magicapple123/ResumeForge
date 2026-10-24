// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲树的**纯视图逻辑**（无 React）：可见节点顺序、父节点、排序会话的预览模型。
 *
 * 单独抽出来是因为它们最容易写错又最适合离线测试：
 * - 键盘上下移动时"下一个是谁"依赖展开状态，写错就会跳过/重复节点；
 * - Enter 确认前只预览顺序（不派发命令），预览必须与最终命令算出同一个结果——
 *   两处各写一套算法必然分叉，所以命令与预览共用 `reorderPreservingIds` 与同一份
 *   startIndex/currentIndex 语义。
 */
import { reorderPreservingIds } from "../../../features/resume-document/identity";
import type {
  EntryField,
  OutlineCommand,
  OutlineSelection,
  OutlineSortSession,
} from "../../../features/resume-outline/types";
import {
  entryKey,
  selectionKey,
  type OutlineEntry,
  type OutlineModel,
  type OutlinePoint,
} from "../../../features/resume-outline/model";

/** 树节点的稳定键（DOM `data-tree-key`、焦点映射、多选集合共用）。 */
export function sectionTreeKey(field: string): string {
  return `section:${field}`;
}

export function pointTreeKey(
  field: string,
  objectId: string,
  pointField: string,
  pointId: string,
): string {
  return `point:${field}:${objectId}:${pointField}:${pointId}`;
}

/** 选择 → 树键（选中项与焦点项用同一套键，键盘移动后焦点不丢）。 */
export function treeKeyForSelection(selection: OutlineSelection | null | undefined): string {
  if (!selection) return "";
  if (selection.kind === "personal") return "personal";
  if (selection.kind === "entry") return entryKey(selection.field, selection.objectId);
  return pointTreeKey(selection.field, selection.objectId, selection.pointField, selection.pointId);
}

/** 从树键解析它所属的条目键（要点 → 条目；条目/分组 → 空串）。 */
export function entryKeyOfTreeKey(key: string): string {
  if (!key.startsWith("point:")) return "";
  const parts = key.split(":");
  if (parts.length < 5) return "";
  return `entry:${parts[1]}:${parts[2]}`;
}

/**
 * 按当前展开状态列出可见树节点（键盘 Home/End/上下移动的顺序来源）。
 *
 * 个人信息是一个**叶子节点**（`personal`）：它没有条目数组，不能排序/复制/隐藏。
 */
export function visibleTreeKeys(
  model: OutlineModel,
  expandedSections: ReadonlySet<string>,
  expandedEntries: ReadonlySet<string>,
): string[] {
  const keys: string[] = [];
  for (const section of model.sections) {
    if (section.field === null) {
      keys.push("personal");
      continue;
    }
    keys.push(sectionTreeKey(section.field));
    if (!expandedSections.has(section.field)) continue;
    for (const entry of section.entries) {
      if (!entry.objectId) continue;
      const key = entryKey(entry.field, entry.objectId);
      keys.push(key);
      if (!expandedEntries.has(key)) continue;
      for (const point of entry.points) {
        if (!point.pointId) continue;
        keys.push(pointTreeKey(entry.field, entry.objectId, point.pointField, point.pointId));
      }
    }
  }
  return keys;
}

/**
 * 排序会话的预览模型：只把被移动的对象换到 currentIndex，别的一律不动。
 *
 * 要点排序的会话下标是"该 pointField 分组内"的下标（命令也是这样算的），所以分组重排后
 * 再按原字段顺序拼回去——不能把不同 pointField 的要点混在一起排（那会跨语义数组搬内容）。
 */
export function previewModel(
  model: OutlineModel,
  session: OutlineSortSession | null,
): OutlineModel {
  if (!session) return model;
  const sections = model.sections.map((section) => {
    if (section.field !== session.field) return section;
    if (session.kind === "entry") {
      return {
        ...section,
        entries: reorderPreservingIds(section.entries, session.startIndex, session.currentIndex),
      };
    }
    return {
      ...section,
      entries: section.entries.map((entry) => {
        if (entry.objectId !== session.objectId) return entry;
        const fields: string[] = [];
        for (const point of entry.points) {
          if (!fields.includes(point.pointField)) fields.push(point.pointField);
        }
        const points: OutlinePoint[] = [];
        for (const pointField of fields) {
          const group = entry.points.filter((point) => point.pointField === pointField);
          if (pointField !== session.pointField) {
            points.push(...group);
            continue;
          }
          points.push(
            ...reorderPreservingIds(group, session.startIndex, session.currentIndex).map(
              (point, index) => ({ ...point, index }),
            ),
          );
        }
        return { ...entry, points };
      }),
    };
  });
  return { ...model, sections };
}

/** 条目选择能不能进入排序（找不到/身份缺失/只有一个条目时返回 null）。 */
export function entrySortSession(
  model: OutlineModel,
  selection: OutlineSelection | null | undefined,
): OutlineSortSession | null {
  if (!selection || selection.kind !== "entry") return null;
  const section = model.sections.find((item) => item.field === selection.field);
  if (!section) return null;
  const index = section.entries.findIndex((entry) => entry.objectId === selection.objectId);
  if (index < 0 || section.entries.length < 2) return null;
  return {
    kind: "entry",
    field: selection.field,
    objectId: selection.objectId,
    startIndex: index,
    currentIndex: index,
    total: section.entries.length,
  };
}

/** 要点选择能不能进入排序（同一 pointField 分组内至少两条）。 */
export function pointSortSession(
  model: OutlineModel,
  selection: OutlineSelection | null | undefined,
): OutlineSortSession | null {
  if (!selection || selection.kind !== "point") return null;
  const entry = findEntry(model, selection.field, selection.objectId);
  if (!entry) return null;
  const group = entry.points.filter((point) => point.pointField === selection.pointField);
  const index = group.findIndex((point) => point.pointId === selection.pointId);
  if (index < 0 || group.length < 2) return null;
  return {
    kind: "point",
    field: selection.field,
    objectId: selection.objectId,
    pointField: selection.pointField,
    pointId: selection.pointId,
    startIndex: index,
    currentIndex: index,
    total: group.length,
  };
}

/** 从当前选择构造排序会话（条目优先；都不是可排序对象时返回 null）。 */
export function sortSessionForSelection(
  model: OutlineModel,
  selection: OutlineSelection | null | undefined,
): OutlineSortSession | null {
  return entrySortSession(model, selection) ?? pointSortSession(model, selection);
}

/** 排序会话 → 最终命令（Enter 确认时**只**派发这一条，拖动过程不产生历史）。 */
export function sortSessionCommand(session: OutlineSortSession): OutlineCommand {
  if (session.kind === "entry") {
    return {
      type: "reorder-entry",
      field: session.field,
      objectId: session.objectId,
      toIndex: session.currentIndex,
    };
  }
  return {
    type: "reorder-point",
    field: session.field,
    objectId: session.objectId,
    pointField: session.pointField ?? "",
    pointId: session.pointId ?? "",
    toIndex: session.currentIndex,
  };
}

function findEntry(model: OutlineModel, field: string, objectId: string): OutlineEntry | null {
  const section = model.sections.find((item) => item.field === field);
  return section?.entries.find((entry) => entry.objectId === objectId) ?? null;
}

/** 树键 → 选择（键盘 Enter/空格激活用）。纯字符串解析，不需要模型。 */
export function selectionForTreeKey(key: string): OutlineSelection | null {
  if (!key) return null;
  if (key === "personal") return { kind: "personal" };
  const parts = key.split(":");
  if (parts[0] === "entry" && parts.length >= 3) {
    return { kind: "entry", field: parts[1] as EntryField, objectId: parts[2] };
  }
  if (parts[0] === "point" && parts.length >= 5) {
    return {
      kind: "point",
      field: parts[1] as EntryField,
      objectId: parts[2],
      pointField: parts[3],
      pointId: parts[4],
    };
  }
  return null;
}

/** 选择对应的条目（要点 → 所属条目；个人信息/找不到 → null）。 */
export function selectionEntry(
  model: OutlineModel,
  selection: OutlineSelection | null | undefined,
): OutlineEntry | null {
  if (!selection || selection.kind === "personal") return null;
  return findEntry(model, selection.field, selection.objectId);
}

/** 选中对象的稳定键（用于判断"这次选择是不是换了一个对象"）。 */
export function selectionAnchor(selection: OutlineSelection | null | undefined): string {
  return selectionKey(selection);
}
