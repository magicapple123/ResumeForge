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
 * ## 拖拽落点语义（2026-10-28 修）
 *
 * 拖动是"抓行"而不是"抓 18px 手柄"：整行可拖（行内动作按钮不劫持拖动），手柄保留给键盘。
 * 落点解析在树容器上做（`useOutlineDragDrop` + `outlineDropTargets`）：**指针压在某条同类行
 * 的行矩形里**就是"移动到该行当前下标"；落在缝隙 / 分组容器 / 板块标题 / 空白处一律**不猜**
 * （hover 维持现状，drop 提交拖动中看到的那一版）；松在别的板块/别的条目上则不动。**不能只挂行级 drop**——28px 高的行之间满是缝隙，
 * 差一两像素就会静默取消（用户反馈"大部分情况下拖不动"的真机原形）。精确的首尾控制
 * 仍由键盘的 Home/End 负责。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent, KeyboardEvent, RefObject } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
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
import { entryIndexInModel, pointIndexInModel } from "./outlineDropTargets";
import { useOutlineDragDrop } from "./useOutlineDragDrop";

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
  /** 大纲树滚动容器：拖到上下边缘时自动滚动（长列表才能拖到屏幕外目标）。 */
  treeRef: RefObject<HTMLElement | null>;
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
  dragOverPoint: (
    entry: OutlineEntry,
    point: OutlinePoint,
    event: DragEvent<HTMLDivElement>,
  ) => void;
  /** 树容器上的 dragOver / drop / dragEnd（落点解析见 `outlineDropTargets`）。 */
  handleTreeDragOver: (event: DragEvent<HTMLDivElement>) => void;
  handleTreeDrop: (event: DragEvent<HTMLDivElement>) => void;
  handleTreeDragEnd: (event: DragEvent<HTMLDivElement>) => void;
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
  previewBase,
  onStructurePreview,
  treeRef,
}: OutlineSortOptions): OutlineSortApi {
  useLocale();
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

  /**
   * 会话所属条目的**扁平要点列表**（字段声明顺序，与模型 `entry.points` 同序）。
   *
   * 跨字段搬移的目标字段/下标由它唯一推出（`pointMove.pointMoveOf`）：键盘、拖拽提交与
   * 画布预览三处都传这一份，落点与看到的顺序不可能分叉。条目会话返回空数组。
   */
  const sessionPoints = useCallback(
    (session: OutlineSortSession): OutlinePoint[] => {
      if (session.kind !== "point") return [];
      const entry = findOutlineEntry(model, {
        kind: "entry",
        field: session.field,
        objectId: session.objectId,
      });
      return entry ? entry.points : [];
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
    if (dispatch(sortSessionCommand(session, sessionPoints(session)))) {
      announce(t("outline.sort.committed", { name, position: session.currentIndex + 1 }));
    }
    setSortSession(null);
  }, [announce, dispatch, nameOfSession, sessionPoints, sortSession]);

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
      if (dispatch(sortSessionCommand(session, sessionPoints(session)))) {
        announce(t("outline.sort.committed", { name, position: session.currentIndex + 1 }));
      }
    }
    endDrag();
  }, [announce, dispatch, endDrag, nameOfSession, sessionPoints, sortSession]);

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

  const dragOverPoint = useCallback(
    (entry: OutlineEntry, point: OutlinePoint, event: DragEvent<HTMLDivElement>) => {
      if (dragPayload?.kind !== "point") return;
      // 同一条目内的**任意**要点行都是合法落点（跨字段搬移：courses ↔ achievements …），
      // 跨条目一律不接（那会改另一条经历的内容）。
      if (dragPayload.field !== entry.field || dragPayload.objectId !== entry.objectId) return;
      event.preventDefault();
      if (dragPayload.pointId === point.pointId) return;
      const key = pointTreeKey(entry.field, entry.objectId, point.pointField, point.pointId);
      if (key === dropTargetKey) return;
      setDropTargetKey(key);
      const targetIndex = pointIndexInModel(
        model,
        entry.field,
        entry.objectId,
        point.pointField,
        point.pointId,
      );
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

  /**
   * 拖动悬停（树容器上算）：行在拖动中被设成 `pointer-events:none`（否则被拖行会挡住指针、
   * 浏览器扣掉 drop），所以行级 dragover 在真机收不到——预览换位改由这里驱动。
   *
   * 悬停在**空要点字段的占位行**上时，`index` 是被拖要点自己的基准下标（= 不产生位移），
   * 所以既有分支天然把预览**复位**成真实顺序（`currentIndex` 回 `startIndex`）：
   * 占位行的落点是"搬进那个字段的第 0 位"，用户看到的高亮槽位就是松手后的位置。
   */
  const handleDragHover = useCallback((target: { key: string; index: number } | null) => {
    if (!target) return;
    setDropTargetKey(target.key);
    setSortSession((previous) => {
      if (!previous || previous.currentIndex === target.index) return previous;
      return { ...previous, currentIndex: target.index };
    });
  }, []);
  // 树容器上的拖放接入（悬停预览 / drop 落点解析 / 边缘自动滚动）：命令与历史仍走上面那几个出口。
  const dragDrop = useOutlineDragDrop({
    model,
    payload: dragPayload,
    treeRef,
    dispatch,
    announce,
    endDrag,
    commitDrag,
    onHover: handleDragHover,
  });

  // ── 结构预览（只给右栏画布，不落库、不进历史）──────────────────
  // 只服务**拖动**：键盘会话是"逐键改 currentIndex"，每一步都推右栏重排只会让纸面闪；
  // 拖动是一次持续手势，用户期待纸面跟着手走。会话对象只在目标下标变化时换新引用，
  // 所以 applyOutlineCommand 不会在每帧 dragOver 里重算。
  const structurePreview = useMemo(
    () =>
      dragPayload
        ? structurePreviewContent(
            previewBase,
            sortSession,
            sortSession ? sessionPoints(sortSession) : [],
          )
        : null,
    [dragPayload, previewBase, sessionPoints, sortSession],
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
    dragOverPoint,
    handleTreeDragOver: dragDrop.handleTreeDragOver,
    handleTreeDrop: dragDrop.handleTreeDrop,
    handleTreeDragEnd: dragDrop.handleTreeDragEnd,
  };
}
