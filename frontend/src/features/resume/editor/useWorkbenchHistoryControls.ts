// SPDX-License-Identifier: Apache-2.0
/**
 * QW-1：撤销 / 恢复的**唯一接线**（动作条按钮 + 全站快捷键）。
 *
 * 两者必须调同一个 `history.undo/redo`：快捷键走 `useWorkbenchV2Shortcuts`，动作条走
 * `ResumeWorkbenchActionBar` 的 `onUndo/onRedo`；如果组件里各写一份，禁用态与"撤销的是
 * 哪一步"的摘要就会分叉。摘要直接取历史栈顶（`summaryOf` 已经写在快照上）。
 *
 * 之所以单独成模块：`ResumeWorkbenchV2` 已贴 500 行预算，这组透传不该继续铺在组件里。
 */
import type { ComponentProps } from "react";
import type ResumeWorkbenchActionBar from "./ResumeWorkbenchActionBar";
import type { WorkbenchV2History } from "./useWorkbenchV2History";
import { useWorkbenchV2Shortcuts } from "./useWorkbenchV2Shortcuts";

type ActionBarProps = ComponentProps<typeof ResumeWorkbenchActionBar>;
/** 动作条上与"撤销/恢复"有关的那一组 props（组件用 `{...}` 透传）。 */
export type UndoRedoActionBarProps = Pick<
  ActionBarProps,
  "canUndo" | "canRedo" | "undoSummary" | "redoSummary" | "onUndo" | "onRedo"
>;

export function useWorkbenchHistoryControls(
  history: WorkbenchV2History,
  enabled: boolean,
): UndoRedoActionBarProps {
  const { canUndo, canRedo, past, future } = history.historyTab;
  // Q03：全站快捷键体系（设置页可改键；输入框内 undo/redo 让给浏览器原生）。
  useWorkbenchV2Shortcuts({ undo: history.undo, redo: history.redo, enabled });
  return {
    canUndo,
    canRedo,
    // 栈顶就是"按下去会撤销/恢复的那一步"。
    undoSummary: past.length > 0 ? past[past.length - 1].summary : undefined,
    redoSummary: future.length > 0 ? future[future.length - 1].summary : undefined,
    onUndo: history.undo,
    onRedo: history.redo,
  };
}
