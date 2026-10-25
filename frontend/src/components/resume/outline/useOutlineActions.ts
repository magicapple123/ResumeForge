// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲的结构**写操作入口**：把用户动作翻译成 `OutlineCommand`，并统一处理两种结果：
 *
 * - 能派发：调用宿主给的 `onCommand(command, baseContent)`（W03 历史/保存层消费）；
 * - 不能派发：给出**面向用户的说明**（锁定/对象已不存在），不静默失败、不显示原因码。
 *
 * 所有"写"都集中在这一个文件，面板与排序会话不各自拼命令——避免出现两套 id/下标口径。
 */
import { useCallback } from "react";
import { t } from "../../../i18n";
import type { ResumeContent } from "../../../types/resume";
import {
  BLOCKED_REASON_KEY,
  canCloneEntry,
  canClonePoint,
} from "../../../features/resume-outline/commands";
import type { OutlineEntry, OutlinePoint } from "../../../features/resume-outline/model";
import type {
  OutlineBlockReason,
  OutlineCommand,
  OutlineEntryRef,
} from "../../../features/resume-outline/types";

export interface OutlineActionsOptions {
  baseContent: ResumeContent | null;
  onCommand?: (command: OutlineCommand, baseContent: ResumeContent) => void;
  announce: (text: string) => void;
}

export interface OutlineActionsApi {
  dispatch: (command: OutlineCommand) => boolean;
  notifyBlocked: (reason: OutlineBlockReason) => void;
  setHidden: (entries: readonly OutlineEntry[], hidden: boolean) => void;
  /** W06：按 point id 显隐单条/多条要点（不改条目自身的 hidden）。 */
  setHiddenPoints: (entry: OutlineEntry, points: readonly OutlinePoint[], hidden: boolean) => void;
  setLock: (entry: OutlineEntry, lock: "content" | "layout", value: boolean) => void;
  cloneEntry: (entry: OutlineEntry) => void;
  /** W06：复制一条要点（新 point id、相邻插入）。 */
  clonePoint: (entry: OutlineEntry, point: OutlinePoint) => void;
}

function refsOf(entries: readonly OutlineEntry[]): OutlineEntryRef[] {
  return entries.map((entry) => ({ field: entry.field, objectId: entry.objectId }));
}

export function useOutlineActions({
  baseContent,
  onCommand,
  announce,
}: OutlineActionsOptions): OutlineActionsApi {
  const notifyBlocked = useCallback(
    (reason: OutlineBlockReason) => announce(t(BLOCKED_REASON_KEY[reason])),
    [announce],
  );

  const dispatch = useCallback(
    (command: OutlineCommand): boolean => {
      if (!onCommand || !baseContent) return false;
      onCommand(command, baseContent);
      return true;
    },
    [baseContent, onCommand],
  );

  const setHidden = useCallback(
    (entries: readonly OutlineEntry[], hidden: boolean) => {
      if (entries.length === 0) return;
      // 显隐是可见性操作，两种锁都不阻止（锁正文/锁排版都不改变"导出里要不要出现"）。
      if (dispatch({ type: "set-hidden", entries: refsOf(entries), hidden })) {
        announce(
          t(hidden ? "outline.batch.hidden" : "outline.batch.shown", { count: entries.length }),
        );
      }
    },
    [announce, dispatch],
  );

  const setHiddenPoints = useCallback(
    (entry: OutlineEntry, points: readonly OutlinePoint[], hidden: boolean) => {
      const targets = points.filter((point) => point.pointId !== "");
      if (targets.length === 0) return;
      const ok = dispatch({
        type: "set-hidden-points",
        field: entry.field,
        objectId: entry.objectId,
        points: targets.map((point) => ({ pointField: point.pointField, pointId: point.pointId })),
        hidden,
      });
      if (ok)
        announce(
          t(hidden ? "outline.point.hidden" : "outline.point.shown", { count: targets.length }),
        );
    },
    [announce, dispatch],
  );

  const setLock = useCallback(
    (entry: OutlineEntry, lock: "content" | "layout", value: boolean) => {
      dispatch({ type: "set-lock", field: entry.field, objectId: entry.objectId, lock, value });
    },
    [dispatch],
  );

  const cloneEntry = useCallback(
    (entry: OutlineEntry) => {
      // 锁正文阻止复制：复制会生成一份可改的正文副本，等于绕开"这段已定稿"的意图。
      if (!canCloneEntry(entry)) return notifyBlocked("locked-content");
      dispatch({ type: "clone-entry", field: entry.field, objectId: entry.objectId });
    },
    [dispatch, notifyBlocked],
  );

  const clonePoint = useCallback(
    (entry: OutlineEntry, point: OutlinePoint) => {
      if (!canClonePoint(entry)) return notifyBlocked("locked-content");
      const ok = dispatch({
        type: "clone-point",
        field: entry.field,
        objectId: entry.objectId,
        pointField: point.pointField,
        pointId: point.pointId,
      });
      if (ok) announce(t("outline.point.cloned"));
    },
    [announce, dispatch, notifyBlocked],
  );

  return { dispatch, notifyBlocked, setHidden, setHiddenPoints, setLock, cloneEntry, clonePoint };
}
