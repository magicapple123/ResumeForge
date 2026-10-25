// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲面板状态的**组合根**：把三块互不依赖的 hook 拼成一个面板可消费的接口。
 *
 * | 模块 | 职责 |
 * |---|---|
 * | `useOutlineCore` | 选择 / 多选 / 展开 / 焦点 / 键盘导航（纯视图状态） |
 * | `useOutlineActions` | 结构写操作 → `OutlineCommand` + 被拒绝原因的人话说明 |
 * | `useOutlineSort` | 键盘排序会话 + 拖拽（含预览树） |
 *
 * 组合层只做两件事：持有**播报文本**（三块共用同一个 `aria-live` 出口），以及把
 * "批量显隐"翻译成 set-hidden + 清空多选。展示层（`OutlinePanel`）一行状态都不自己造。
 */
import { useCallback, useState } from "react";
import type { RefObject } from "react";
import type { ResumeContent } from "../../../types/resume";
import type { OutlineModel } from "../../../features/resume-outline/model";
import type { OutlineCommand, OutlineSelection } from "../../../features/resume-outline/types";
import { useOutlineActions, type OutlineActionsApi } from "./useOutlineActions";
import { useOutlineCore, type OutlineCoreApi } from "./useOutlineCore";
import { useOutlineSort, type OutlineSortApi } from "./useOutlineSort";

export interface OutlineStateOptions {
  /** 命令基于的内容快照（已 ensureIds；命令层必须拿同一份执行，否则 id 对不上）。 */
  baseContent: ResumeContent | null;
  model: OutlineModel;
  onCommand?: (command: OutlineCommand, baseContent: ResumeContent) => void;
  pickTarget?: { path: string; nonce: number } | null;
  onSelectionChange?: (selection: OutlineSelection | null) => void;
  treeRef: RefObject<HTMLElement | null>;
  /** 排序结构预览出口（拖动中给右栏画布的新顺序；null = 结束）。缺省 = 不预览。 */
  onStructurePreview?: (content: ResumeContent | null) => void;
}

export interface OutlineStateApi extends OutlineCoreApi, OutlineSortApi, OutlineActionsApi {
  announcement: string;
  /** 统一播报出口（搜索/定位等面板级动作也走同一个 aria-live）。 */
  announce: (text: string) => void;
  batchSetHidden: (hidden: boolean) => void;
}

export function useOutlineState({
  baseContent,
  model,
  onCommand,
  pickTarget,
  onSelectionChange,
  treeRef,
  onStructurePreview,
}: OutlineStateOptions): OutlineStateApi {
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((text: string) => setAnnouncement(text), []);

  const core = useOutlineCore({ model, baseContent, pickTarget, onSelectionChange, treeRef });
  const actions = useOutlineActions({ baseContent, onCommand, announce });
  const sort = useOutlineSort({
    model,
    selection: core.selection,
    select: core.select,
    dispatch: actions.dispatch,
    announce,
    notifyBlocked: actions.notifyBlocked,
    enabled: Boolean(onCommand && baseContent),
    // 预览基准 = 面板渲染/命令用的同一份内容（含未保存编辑）：id 一一对上，预览与提交同源。
    previewBase: baseContent,
    onStructurePreview,
  });

  const batchSetHidden = useCallback(
    (hidden: boolean) => {
      actions.setHidden(core.multiSelectedEntries, hidden);
      // 批量操作完成后收起多选栏：按钮消失本身就是"这次批量做完了"的反馈。
      core.clearMultiSelect();
    },
    [actions, core],
  );

  return {
    ...core,
    ...actions,
    ...sort,
    announcement,
    announce,
    batchSetHidden,
  };
}
