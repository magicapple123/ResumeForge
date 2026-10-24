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
import { useCallback, useMemo, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { t } from "../../../i18n";
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

export interface OutlineSortOptions {
  model: OutlineModel;
  selection: OutlineSelection | null;
  select: (selection: OutlineSelection) => void;
  dispatch: (command: OutlineCommand) => boolean;
  announce: (text: string) => void;
  notifyBlocked: (reason: OutlineBlockReason) => void;
  /** 只读宿主（没有 onCommand）不排序；面板也不会渲染排序手柄，这里再兜一层。 */
  enabled: boolean;
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

export function useOutlineSort({
  model,
  selection,
  select,
  dispatch,
  announce,
  notifyBlocked,
  enabled,
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
    [announceSort, enabled, model, notifyBlocked, select],
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
  const endDrag = useCallback(() => {
    setDragPayload(null);
    setDropTargetKey(null);
  }, []);

  const beginEntryDrag = useCallback(
    (entry: OutlineEntry) => {
      if (!enabled) return;
      if (!canMoveEntry(entry)) return notifyBlocked("locked-layout");
      select({ kind: "entry", field: entry.field, objectId: entry.objectId });
      setDragPayload({ kind: "entry", field: entry.field, objectId: entry.objectId });
    },
    [enabled, notifyBlocked, select],
  );

  const beginPointDrag = useCallback(
    (entry: OutlineEntry, point: OutlinePoint) => {
      if (!enabled) return;
      if (!canMovePoint(entry)) return notifyBlocked("locked-layout");
      if (!point.pointId) return;
      select({
        kind: "point",
        field: entry.field,
        objectId: entry.objectId,
        pointField: point.pointField,
        pointId: point.pointId,
      });
      setDragPayload({
        kind: "point",
        field: entry.field,
        objectId: entry.objectId,
        pointField: point.pointField,
        pointId: point.pointId,
      });
    },
    [enabled, notifyBlocked, select],
  );

  const dragOverEntry = useCallback(
    (entry: OutlineEntry, event: DragEvent<HTMLDivElement>) => {
      if (dragPayload?.kind !== "entry" || dragPayload.field !== entry.field) return;
      if (dragPayload.objectId === entry.objectId) return;
      event.preventDefault();
      setDropTargetKey(entryKey(entry.field, entry.objectId));
    },
    [dragPayload],
  );

  const dropOnEntry = useCallback(
    (entry: OutlineEntry, event: DragEvent<HTMLDivElement>) => {
      if (dragPayload?.kind !== "entry" || dragPayload.field !== entry.field) return;
      event.preventDefault();
      const section = previewTree.sections.find((item) => item.field === entry.field);
      const targetIndex =
        section?.entries.findIndex((item) => item.objectId === entry.objectId) ?? -1;
      const draggedName = entryName(
        findOutlineEntry(model, {
          kind: "entry",
          field: dragPayload.field,
          objectId: dragPayload.objectId,
        }),
      );
      if (targetIndex >= 0 && dragPayload.objectId !== entry.objectId) {
        const command: OutlineCommand = {
          type: "reorder-entry",
          field: dragPayload.field,
          objectId: dragPayload.objectId,
          toIndex: targetIndex,
        };
        if (dispatch(command)) {
          announce(t("outline.sort.committed", { name: draggedName, position: targetIndex + 1 }));
        }
      }
      endDrag();
    },
    [announce, dispatch, dragPayload, endDrag, model, previewTree],
  );

  const dragOverPoint = useCallback(
    (entry: OutlineEntry, point: OutlinePoint, event: DragEvent<HTMLDivElement>) => {
      if (dragPayload?.kind !== "point") return;
      if (dragPayload.objectId !== entry.objectId || dragPayload.pointField !== point.pointField)
        return;
      if (dragPayload.pointId === point.pointId) return;
      event.preventDefault();
      setDropTargetKey(pointTreeKey(entry.field, entry.objectId, point.pointField, point.pointId));
    },
    [dragPayload],
  );

  const dropOnPoint = useCallback(
    (entry: OutlineEntry, point: OutlinePoint, event: DragEvent<HTMLDivElement>) => {
      if (dragPayload?.kind !== "point") return;
      if (dragPayload.objectId !== entry.objectId || dragPayload.pointField !== point.pointField)
        return;
      event.preventDefault();
      const sourcePoint = findOutlinePoint(model, {
        kind: "point",
        field: dragPayload.field,
        objectId: dragPayload.objectId,
        pointField: dragPayload.pointField,
        pointId: dragPayload.pointId,
      });
      if (point.pointId && dragPayload.pointId !== point.pointId) {
        const command: OutlineCommand = {
          type: "reorder-point",
          field: dragPayload.field,
          objectId: dragPayload.objectId,
          pointField: dragPayload.pointField,
          pointId: dragPayload.pointId,
          toIndex: point.index,
        };
        if (dispatch(command)) {
          announce(
            t("outline.sort.committed", {
              name: sourcePoint?.text || t("outline.point.label"),
              position: point.index + 1,
            }),
          );
        }
      }
      endDrag();
    },
    [announce, dispatch, dragPayload, endDrag, model],
  );

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
