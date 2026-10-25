// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲的**键盘排序会话 + 拖拽**（W06 的 P1-01 核心交互）。
 *
 * ## 排序为什么是"会话"
 *
 * 手柄上按 Enter/空格进入会话：方向键/Home/End 只改 `currentIndex`，树上即时预览新顺序；
 * **Enter 才派发一条 `OutlineCommand`**、Esc 直接丢弃。于是"一次排序 = 一条历史记录"，
 * 中途取消不会留下半截操作（W03 的时间线里也不会出现一串零碎移动）。
 *
 * ## 拖拽落点语义
 *
 * 落在目标行上 = "移动到目标行当前下标"（不做上下半区的像素判定：那需要真实布局尺寸，
 * jsdom 里测不了，也会让"落点提示"与"实际插入"两套算法分叉）。精确的首尾控制由键盘
 * 的 Home/End 负责。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { t } from "../../../i18n";
import type { ResumeContent } from "../../../types/resume";
import { canMoveEntry, canMovePoint } from "../../../features/resume-outline/commands";
import {
  entryKey,
  findOutlineEntry,
  findOutlinePoint,
} from "../../../features/resume-outline/model";
import type {
  OutlineEntry,
  OutlineModel,
  OutlinePoint,
} from "../../../features/resume-outline/model";
import type {
  OutlineBlockReason,
  OutlineCommand,
  OutlineSelection,
  OutlineSortSession,
} from "../../../features/resume-outline/types";
import {
  pointTreeKey,
  previewModel,
  sortSessionCommand,
  sortSessionForSelection,
} from "./outlineTree";
import { structurePreviewContent } from "./outlinePreview";

export interface OutlineSortOptions {
  model: OutlineModel;
  selection: OutlineSelection | null;
  select: (selection: OutlineSelection) => void;
  dispatch: (command: OutlineCommand) => boolean;
  announce: (text: string) => void;
  notifyBlocked: (reason: OutlineBlockReason) => void;
  /** 只读宿主（没有 onCommand）不排序；面板也不会渲染排序手柄，这里再兜一层。 */
  enabled: boolean;
  /**
   * 预览基准内容（含未保存编辑）：拖动/键盘排序时按它算出"只给画布看"的重排结果。
   * 它必须与 `model` 来自同一份内容（id 对得上），否则命令按 id 找不到对象、预览会静默消失。
   */
  previewBase: ResumeContent | null;
  /** 结构预览出口：排序会话改变时给出新内容，结束（松手 / 取消 / 提交）时给 null。 */
  onStructurePreview?: (content: ResumeContent | null) => void;
}

/** 一次拖拽携带的信息（只记身份；落点按目标行当前下标算）。 */
export type OutlineDragPayload =
  | { kind: "entry"; field: OutlineEntry["field"]; objectId: string }
  | {
      kind: "point";
      field: OutlineEntry["field"];
      objectId: string;
      pointField: string;
      pointId: string;
    };

export interface OutlineSortApi {
  sortSession: OutlineSortSession | null;
  /** 排序会话的预览树（面板渲染这份；属性区/命令仍用真实 model）。 */
  previewTree: OutlineModel;
  startSort: (target: OutlineSelection) => void;
  handleSortKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  dragPayload: OutlineDragPayload | null;
  dropTargetKey: string | null;
  beginEntryDrag: (entry: OutlineEntry) => void;
  beginPointDrag: (entry: OutlineEntry, point: OutlinePoint) => void;
  endDrag: () => void;
  dragOverEntry: (entry: OutlineEntry, event: DragEvent<HTMLDivElement>) => void;
  dropOnEntry: (entry: OutlineEntry, event: DragEvent<HTMLDivElement>) => void;
  dragOverPoint: (
    entry: OutlineEntry,
    point: OutlinePoint,
    event: DragEvent<HTMLDivElement>,
  ) => void;
  dropOnPoint: (entry: OutlineEntry, point: OutlinePoint, event: DragEvent<HTMLDivElement>) => void;
}

function clampIndex(value: number, total: number): number {
  return Math.max(0, Math.min(value, Math.max(0, total - 1)));
}

function entryName(entry: OutlineEntry | null): string {
  return entry && entry.title ? entry.title : t("outline.entry.untitled");
}

/** 目标行在**基准模型**里的下标：命令的 `toIndex` 也是这个口径（预览树已重排，下标不能现算）。 */
function entryIndexInModel(model: OutlineModel, field: OutlineEntry["field"], objectId: string) {
  const section = model.sections.find((item) => item.field === field);
  return section?.entries.find((item) => item.objectId === objectId)?.index ?? -1;
}

/** 要点在它那个 pointField 分组里的基准下标（`reorder-point` 的 toIndex 口径）。 */
function pointIndexInModel(model: OutlineModel, entry: OutlineEntry, point: OutlinePoint) {
  const found = findOutlinePoint(model, {
    kind: "point",
    field: entry.field,
    objectId: entry.objectId,
    pointField: point.pointField,
    pointId: point.pointId,
  });
  return found?.index ?? -1;
}

export function useOutlineSort({
  model,
  selection,
  select,
  dispatch,
  announce,
  notifyBlocked,
  enabled,
  previewBase,
  onStructurePreview,
}: OutlineSortOptions): OutlineSortApi {
  const [sortSession, setSortSession] = useState<OutlineSortSession | null>(null);
  const [dragPayload, setDragPayload] = useState<OutlineDragPayload | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  const previewTree = useMemo(() => previewModel(model, sortSession), [model, sortSession]);

  const nameOfSession = useCallback(
    (session: OutlineSortSession): string => {
      if (session.kind === "entry") {
        return entryName(
          findOutlineEntry(model, {
            kind: "entry",
            field: session.field,
            objectId: session.objectId,
          }),
        );
      }
      const point = findOutlinePoint(model, {
        kind: "point",
        field: session.field,
        objectId: session.objectId,
        pointField: session.pointField ?? "",
        pointId: session.pointId ?? "",
      });
      return point?.text || t("outline.point.label");
    },
    [model],
  );

  const announceSort = useCallback(
    (session: OutlineSortSession) => {
      announce(
        t("outline.sort.active", {
          name: nameOfSession(session),
          position: session.currentIndex + 1,
          total: session.total,
        }),
      );
    },
    [announce, nameOfSession],
  );

  const startSort = useCallback(
    (target: OutlineSelection) => {
      if (!enabled) return;
      // 拖动中不再开键盘会话：两者共用同一条 sortSession，后开的会把拖动预览顶掉。
      if (dragPayload) return;
      if (target.kind === "entry") {
        const entry = findOutlineEntry(model, target);
        if (!entry) return notifyBlocked("not-found");
        if (!canMoveEntry(entry)) return notifyBlocked("locked-layout");
      } else if (target.kind === "point") {
        const parent = findOutlineEntry(model, {
          kind: "entry",
          field: target.field,
          objectId: target.objectId,
        });
        if (!parent) return notifyBlocked("not-found");
        if (!canMovePoint(parent)) return notifyBlocked("locked-layout");
      } else {
        return;
      }
      const session = sortSessionForSelection(model, target);
      if (!session) return;
      select(target);
      setSortSession(session);
      announceSort(session);
    },
    [announceSort, dragPayload, enabled, model, notifyBlocked, select],
  );

  const moveSort = useCallback(
    (toIndex: number) => {
      setSortSession((previous) => {
        if (!previous) return previous;
        const currentIndex = clampIndex(toIndex, previous.total);
        if (currentIndex === previous.currentIndex) return previous;
        const next = { ...previous, currentIndex };
        announceSort(next);
        return next;
      });
    },
    [announceSort],
  );

  const commitSort = useCallback(() => {
    if (!sortSession) return;
    const session = sortSession;
    const name = nameOfSession(session);
    if (dispatch(sortSessionCommand(session))) {
      announce(t("outline.sort.committed", { name, position: session.currentIndex + 1 }));
    }
    setSortSession(null);
  }, [announce, dispatch, nameOfSession, sortSession]);

  const cancelSort = useCallback(() => {
    if (!sortSession) return;
    announce(t("outline.sort.cancelled", { name: nameOfSession(sortSession) }));
    setSortSession(null);
  }, [announce, nameOfSession, sortSession]);

  const handleSortKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!sortSession) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          if (selection) startSort(selection);
        }
        return;
      }
      event.stopPropagation();
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          moveSort(sortSession.currentIndex - 1);
          break;
        case "ArrowDown":
          event.preventDefault();
          moveSort(sortSession.currentIndex + 1);
          break;
        case "Home":
          event.preventDefault();
          moveSort(0);
          break;
        case "End":
          event.preventDefault();
          moveSort(sortSession.total - 1);
          break;
        case "Enter":
          event.preventDefault();
          commitSort();
          break;
        case "Escape":
          event.preventDefault();
          cancelSort();
          break;
        default:
          break;
      }
    },
    [cancelSort, commitSort, moveSort, selection, sortSession, startSort],
  );

  // ── 拖拽 ───────────────────────────────────────────────────────
  // 拖拽与键盘共用同一个 `sortSession`：开拖即建立会话，dragOver 只挪 `currentIndex`，
  // 松手（drop）才派发**一条**命令。于是"拖动中看到的顺序"与"提交的顺序"是同一条命令
  // 算出来的，两套算法不可能分叉；拖到条目外由 dragend 清会话，不留任何历史。
  const endDrag = useCallback(() => {
    setDragPayload(null);
    setDropTargetKey(null);
    // 松手 = 拖动会话结束（预览内容由下面的 effect 一并清掉）；键盘会话不经过这里。
    setSortSession((previous) => (previous ? null : previous));
  }, []);

  /** 拖拽落点：提交会话里最后一步（一条命令），然后收起拖动状态。 */
  const commitDrag = useCallback(() => {
    const session = sortSession;
    if (session && session.currentIndex !== session.startIndex) {
      const name = nameOfSession(session);
      if (dispatch(sortSessionCommand(session))) {
        announce(t("outline.sort.committed", { name, position: session.currentIndex + 1 }));
      }
    }
    endDrag();
  }, [announce, dispatch, endDrag, nameOfSession, sortSession]);

  const beginEntryDrag = useCallback(
    (entry: OutlineEntry) => {
      if (!enabled) return;
      if (!canMoveEntry(entry)) return notifyBlocked("locked-layout");
      const target: OutlineSelection = {
        kind: "entry",
        field: entry.field,
        objectId: entry.objectId,
      };
      select(target);
      setDragPayload({ kind: "entry", field: entry.field, objectId: entry.objectId });
      // 拖动会话与键盘会话互斥：开拖即接管（两者共用同一条 sortSession）。
      setSortSession(sortSessionForSelection(model, target));
    },
    [enabled, model, notifyBlocked, select],
  );

  const beginPointDrag = useCallback(
    (entry: OutlineEntry, point: OutlinePoint) => {
      if (!enabled) return;
      if (!canMovePoint(entry)) return notifyBlocked("locked-layout");
      if (!point.pointId) return;
      const target: OutlineSelection = {
        kind: "point",
        field: entry.field,
        objectId: entry.objectId,
        pointField: point.pointField,
        pointId: point.pointId,
      };
      select(target);
      setDragPayload({
        kind: "point",
        field: entry.field,
        objectId: entry.objectId,
        pointField: point.pointField,
        pointId: point.pointId,
      });
      setSortSession(sortSessionForSelection(model, target));
    },
    [enabled, model, notifyBlocked, select],
  );

  const dragOverEntry = useCallback(
    (entry: OutlineEntry, event: DragEvent<HTMLDivElement>) => {
      if (dragPayload?.kind !== "entry" || dragPayload.field !== entry.field) return;
      // 指针可能正停在"已经被预览挪到身下"的被拖行上：允许落点（drop 时提交最后一步），
      // 但顺序不再变——否则指针每帧都把自己算成新目标，树会来回抖。
      event.preventDefault();
      if (dragPayload.objectId === entry.objectId) return;
      const key = entryKey(entry.field, entry.objectId);
      // dragOver 高频：目标没变就什么都不做（同目标不重复 setState / 不重建大对象）。
      if (key === dropTargetKey) return;
      setDropTargetKey(key);
      const targetIndex = entryIndexInModel(model, entry.field, entry.objectId);
      if (targetIndex < 0) return;
      setSortSession((previous) => {
        if (!previous || previous.kind !== "entry" || previous.currentIndex === targetIndex) {
          return previous;
        }
        return { ...previous, currentIndex: targetIndex };
      });
    },
    [dragPayload, dropTargetKey, model],
  );

  const dropOnEntry = useCallback(
    (entry: OutlineEntry, event: DragEvent<HTMLDivElement>) => {
      if (dragPayload?.kind !== "entry" || dragPayload.field !== entry.field) return;
      event.preventDefault();
      commitDrag();
    },
    [commitDrag, dragPayload],
  );

  const dragOverPoint = useCallback(
    (entry: OutlineEntry, point: OutlinePoint, event: DragEvent<HTMLDivElement>) => {
      if (dragPayload?.kind !== "point") return;
      if (dragPayload.objectId !== entry.objectId || dragPayload.pointField !== point.pointField)
        return;
      event.preventDefault();
      if (dragPayload.pointId === point.pointId) return;
      const key = pointTreeKey(entry.field, entry.objectId, point.pointField, point.pointId);
      if (key === dropTargetKey) return;
      setDropTargetKey(key);
      const targetIndex = pointIndexInModel(model, entry, point);
      if (targetIndex < 0) return;
      setSortSession((previous) => {
        if (!previous || previous.kind !== "point" || previous.currentIndex === targetIndex) {
          return previous;
        }
        return { ...previous, currentIndex: targetIndex };
      });
    },
    [dragPayload, dropTargetKey, model],
  );

  const dropOnPoint = useCallback(
    (entry: OutlineEntry, point: OutlinePoint, event: DragEvent<HTMLDivElement>) => {
      if (dragPayload?.kind !== "point") return;
      if (dragPayload.objectId !== entry.objectId || dragPayload.pointField !== point.pointField)
        return;
      event.preventDefault();
      commitDrag();
    },
    [commitDrag, dragPayload],
  );

  // ── 结构预览（只给右栏画布，不落库、不进历史）──────────────────
  // 只服务**拖动**：键盘会话是"逐键改 currentIndex"，每一步都推右栏重排只会让纸面闪；
  // 拖动是一次持续手势，用户期待纸面跟着手走。会话对象只在目标下标变化时换新引用，
  // 所以 applyOutlineCommand 不会在每帧 dragOver 里重算。
  const structurePreview = useMemo(
    () => (dragPayload ? structurePreviewContent(previewBase, sortSession) : null),
    [dragPayload, previewBase, sortSession],
  );
  useEffect(() => {
    onStructurePreview?.(structurePreview);
  }, [onStructurePreview, structurePreview]);
  // 面板卸载（切页签 / 关制作台）时收起预览：右栏不能停在"会话已不存在"的顺序上。
  useEffect(() => () => onStructurePreview?.(null), [onStructurePreview]);

  // 内容里已经找不到被排序的对象（并发保存/切记录）时，会话自动作废，不留悬空预览。
  if (
    sortSession &&
    !findOutlineEntry(model, {
      kind: "entry",
      field: sortSession.field,
      objectId: sortSession.objectId,
    })
  ) {
    setSortSession(null);
  }

  return {
    sortSession,
    previewTree,
    startSort,
    handleSortKeyDown,
    dragPayload,
    dropTargetKey,
    beginEntryDrag,
    beginPointDrag,
    endDrag,
    dragOverEntry,
    dropOnEntry,
    dragOverPoint,
    dropOnPoint,
  };
}
