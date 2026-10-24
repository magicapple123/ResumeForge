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
import { BLOCKED_REASON_KEY, canCloneEntry } from "../../../features/resume-outline/commands";
import type { OutlineEntry } from "../../../features/resume-outline/model";
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
  setLock: (entry: OutlineEntry, lock: "content" | "layout", value: boolean) => void;
  cloneEntry: (entry: OutlineEntry) => void;
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

  return { dispatch, notifyBlocked, setHidden, setLock, cloneEntry };
}
