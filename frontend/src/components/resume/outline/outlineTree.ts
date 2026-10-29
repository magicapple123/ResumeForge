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
import {
  flatInsertionOf,
  flatPointIndexOf,
  pointMoveOf,
  type PointRef,
} from "../../../features/resume-outline/pointMove";

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

/**
 * 空要点字段**占位行**的树键（只在拖动中出现，见 `OutlineTreeView` 的 `renderEmptyTarget`）。
 *
 * 前缀是 `point-empty` 而不是 `point`：它**不是要点**（没有 pointId、不可拖、不可选、
 * 不参与键盘导航），只有 `parseTreeKey` 认它——`selectionForTreeKey` 只认 `parts[0] ===
 * "point"`，所以占位行永远解析不出选择（这正是我们要的）。
 */
export function emptyFieldTreeKey(field: string, objectId: string, pointField: string): string {
  return `point-empty:${field}:${objectId}:${pointField}`;
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
  // 只认 `point:`：空字段占位行是 `point-empty:`（前缀不同），不会命中这里——
  // 它没有“所属条目里的某一条要点”可归属，也不参与任何选择/焦点映射。
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
 * 要点会话的 `currentIndex` 是**条目内扁平要点列表**的下标（字段声明顺序拼成一条，与模型
 * `entry.points` 同序）：同字段时它就是"该组内的新位置"，跨字段时它表示"移到扁平列表的第几位"，
 * 目标字段由 `flatInsertionOf` 唯一推出（与命令层同一处推导，见 `pointMove.ts`）。
 * 扁平拼回仍按字段声明顺序——不能把不同 pointField 的要点混排，那会跨语义数组搬内容。
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
      entries: section.entries.map((entry) =>
        entry.objectId === session.objectId
          ? {
              ...entry,
              points: previewPoints(entry.points, session.startIndex, session.currentIndex),
            }
          : entry,
      ),
    };
  });
  return { ...model, sections };
}

/**
 * 要点搬移的预览：把第 `from` 条扁平地移到第 `to` 个位置。
 *
 * 搬进别的字段时它**变成那个字段的条目**（`pointField` 随之改写，行上的字段标签跟着变），
 * 这正是"课程行拖到项目符号区就变成一条项目符号"的预览形态。`index` 重新编号成组内下标
 * （只用于展示行号，命令与落点一律按 id 定位）。
 */
function previewPoints(points: readonly OutlinePoint[], from: number, to: number): OutlinePoint[] {
  // 没有位移：原样返回。**必须短路**——否则 `flatInsertionOf` 会拿"剩余列表的第 from 条"
  // 当 anchor，把被搬项改成**另一个字段**（位置没动、字段标签却变了），而"悬停空字段占位行"
  // 正是靠"currentIndex 复位成 startIndex"来清掉上一次的预览位移（见 useOutlineSort）。
  if (to === from) return [...points];
  const insertion = flatInsertionOf(points, from, to);
  if (!insertion) return [...points];
  const remaining = points.filter((_point, index) => index !== from);
  const moved: OutlinePoint = { ...points[from], pointField: insertion.targetField };
  const flat = [
    ...remaining.slice(0, insertion.flatIndex),
    moved,
    ...remaining.slice(insertion.flatIndex),
  ];
  const counters = new Map<string, number>();
  return flat.map((point) => {
    const index = counters.get(point.pointField) ?? 0;
    counters.set(point.pointField, index + 1);
    return { ...point, index };
  });
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

/**
 * 要点选择能不能进入排序（**该条目要点总数 ≥2**）。
 *
 * 门槛从"同一 pointField 分组内 ≥2 条"改成"总数 ≥2"：跨字段搬移后，只有 1 条课程的条目
 * 也能把它挪到别的字段去，手柄不该形同虚设。
 */
export function pointSortSession(
  model: OutlineModel,
  selection: OutlineSelection | null | undefined,
): OutlineSortSession | null {
  if (!selection || selection.kind !== "point") return null;
  const entry = findEntry(model, selection.field, selection.objectId);
  if (!entry) return null;
  const startIndex = flatPointIndexOf(entry.points, selection.pointField, selection.pointId);
  if (startIndex < 0 || entry.points.length < 2) return null;
  return {
    kind: "point",
    field: selection.field,
    objectId: selection.objectId,
    pointField: selection.pointField,
    pointId: selection.pointId,
    startIndex,
    currentIndex: startIndex,
    total: entry.points.length,
  };
}

/** 从当前选择构造排序会话（条目优先；都不是可排序对象时返回 null）。 */
export function sortSessionForSelection(
  model: OutlineModel,
  selection: OutlineSelection | null | undefined,
): OutlineSortSession | null {
  return entrySortSession(model, selection) ?? pointSortSession(model, selection);
}

/**
 * 排序会话 → 最终命令（Enter 确认时**只**派发这一条，拖动过程不产生历史）。
 *
 * 要点会话需要 `points`（该条目的扁平要点列表，字段声明顺序）才能算出"搬到哪个字段的第几位"：
 * 同字段派发 `reorder-point`（与历史行为一字不差），跨字段派发 `move-point`。
 * 没有 `points` 时退化为同字段重排（老调用点/单字段条目天然成立）。
 */
export function sortSessionCommand(
  session: OutlineSortSession,
  points: readonly PointRef[] = [],
): OutlineCommand {
  if (session.kind === "entry") {
    return {
      type: "reorder-entry",
      field: session.field,
      objectId: session.objectId,
      toIndex: session.currentIndex,
    };
  }
  const pointField = session.pointField ?? "";
  const pointId = session.pointId ?? "";
  const move =
    points.length > 0
      ? pointMoveOf(points, {
          pointField,
          pointId,
          startIndex: session.startIndex,
          currentIndex: session.currentIndex,
        })
      : null;
  if (move && !move.sameField) {
    return {
      type: "move-point",
      field: session.field,
      objectId: session.objectId,
      fromPointField: move.fromPointField,
      toPointField: move.toPointField,
      pointId,
      toIndex: move.toIndex,
    };
  }
  return {
    type: "reorder-point",
    field: session.field,
    objectId: session.objectId,
    pointField,
    pointId,
    toIndex: move ? move.toIndex : session.currentIndex,
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
  // 空字段占位行（`point-empty:...`）解析结果恒为 null：它不是要点，选中它没有意义，
  // 也不该把它塞进选择/属性区（`parts[0] === "point"` 的严格相等正好把它排除）。
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
