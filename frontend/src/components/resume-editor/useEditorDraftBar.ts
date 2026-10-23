// SPDX-License-Identifier: Apache-2.0
/**
 * 简历编辑弹窗的「草稿 + 关闭时确认」状态机：从 `ResumeEditorModal` 搬出（文件行数预算 500）。
 *
 * 拆出来的边界是**一件事**：关掉这份编辑时要不要问、上次没提交的内容怎么恢复。表单渲染、
 * 标签页、AI 改写面板都不在这里。搬的时候只搬状态，不搬表单——判定与副作用按原来的顺序
 * 逐条对应，行为不变：
 *
 * 1. 提交中（`saving`）忽略关闭；
 * 2. 确认条已经开着 → 再按一次取消/Esc 收起确认条（一个入口只有一个答案）；
 * 3. 没有未保存的改动 → 直接关；
 * 4. 有未保存的改动 → 出内联确认条（footer 换态），**不开 `modal.confirm`**
 *    ——编辑器本身已是一层容器（`layer.editorModal` = 3110），再开一层就是叠层。
 *
 * 草稿（B6）：按作用域分，只进 `sessionStorage`；命中草稿**不自动应用**，由恢复条问一次
 * （自动填充会让人以为"这份简历本来就有这些改动"）。照片字段不进草稿：它是已校验的原始值，
 * 保存时仍从 `content.photo` 取，存一份只是白占体积。
 */
import { useState } from "react";
import { useFormDraft } from "../../hooks/useFormDraft";
import type { ResumeContent } from "../../types";
import { hasAnyResumeContent } from "../../utils/profileToResume";

/**
 * footer 的两种待确认动作。
 *
 * 两种共用同一条内联确认条：它们的形状一样（"做 X 会丢掉 Y，继续还是算了"），分开实现
 * 只会让 footer 里出现两条几乎相同的分支。
 */
export type EditorPendingAction = "discard" | "fill-all" | null;

/** 草稿里剔除的字段（照片，见文件头）。放模块级常量：hook 的 effect 依赖要稳定。 */
const DRAFT_OMIT: readonly string[] = ["photo"];

/** 空表单不写草稿：空白编辑器没什么可丢的，写进去只会让下次打开多一条恢复条。 */
function isEmptyResume(values: Record<string, unknown>): boolean {
  return !hasAnyResumeContent(values as unknown as ResumeContent);
}

export interface EditorDraftBarOptions {
  /** 弹窗是否打开（关闭时既不读也不写草稿）。 */
  open: boolean;
  /** 提交中：忽略关闭入口。 */
  saving: boolean;
  /** 表单被改过且还没保存。 */
  dirty: boolean;
  /** 草稿作用域，必须带够区分维度（见 `ResumeEditorModal` 的 `draftScopeKey`）。 */
  scope: string;
  /** 当前表单值（受控传入；hook 只读不写）。 */
  values: ResumeContent | undefined;
  /** 恢复草稿：调用方负责写回表单、标记未保存、记一次可撤回的历史。 */
  onRestored: (restored: Record<string, unknown>) => void;
  /** 没有未保存改动时的关闭动作。 */
  onClose: () => void;
  /** 「放弃修改」：调用方清掉脏标记并关闭。 */
  onDiscard: () => void;
  /** 「覆盖填入」：调用方把「我的资料」写进表单（含成功提示）。 */
  onFillAll: () => void;
}

export interface EditorDraftBarApi {
  /** 打开时读到的那份草稿（**不自动应用**，由恢复条询问）。 */
  draftPending: { values: Record<string, unknown>; savedAt: number } | null;
  /** 恢复条：点「恢复这份草稿」。 */
  restoreDraft: () => void;
  /** 恢复条：点「丢掉草稿」。 */
  discardDraft: () => void;
  /** 保存成功后清掉草稿（不影响当前表单）。 */
  clearDraft: () => void;
  /** footer 当前待确认的动作（`null` = 正常按钮组）。 */
  confirming: EditorPendingAction;
  /** 关闭入口（取消 / Esc / × 统一走这里）。 */
  requestClose: () => void;
  /**
   * 「放弃修改」入口：**直接**进确认态，不先判断脏不脏。
   *
   * 与 `requestClose` 分开是因为两个入口问的不是同一件事：`requestClose` 是"我要关掉"，
   * 没有未保存内容就直接关；`requestDiscard` 是"我要撤销这次修改"（中栏那颗按钮），
   * 它天然就是一次丢弃动作，所以该问就问，不该静默什么都不发生。
   */
  requestDiscard: () => void;
  /** 「填入我的资料全部数据」需要覆盖确认时调用。 */
  requestFillAll: () => void;
  /** 确认条上的「继续编辑」。 */
  keepEditing: () => void;
  /** 确认条上的主按钮（放弃修改 / 覆盖填入）。 */
  confirmPending: () => void;
}

export function useEditorDraftBar({
  open,
  saving,
  dirty,
  scope,
  values,
  onRestored,
  onClose,
  onDiscard,
  onFillAll,
}: EditorDraftBarOptions): EditorDraftBarApi {
  const [confirming, setConfirming] = useState<EditorPendingAction>(null);
  const draft = useFormDraft({
    scope,
    values: (values ?? {}) as unknown as Record<string, unknown>,
    enabled: open,
    open,
    omit: DRAFT_OMIT,
    isEmpty: isEmptyResume,
  });

  const requestClose = (): void => {
    if (saving) return;
    // 确认条已经开着：再按 Esc / 再点取消 = 回到编辑（一个入口只有一个答案）。
    if (confirming) {
      setConfirming(null);
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    setConfirming("discard");
  };

  const requestFillAll = (): void => setConfirming("fill-all");

  const requestDiscard = (): void => {
    if (saving) return;
    setConfirming("discard");
  };

  const keepEditing = (): void => setConfirming(null);

  const confirmPending = (): void => {
    if (confirming === "discard") {
      setConfirming(null);
      onDiscard();
      return;
    }
    if (confirming === "fill-all") {
      setConfirming(null);
      onFillAll();
    }
  };

  const restoreDraft = (): void => {
    const restored = draft.adopt();
    if (!restored) return;
    onRestored(restored as Record<string, unknown>);
  };

  return {
    draftPending: draft.pending,
    restoreDraft,
    discardDraft: draft.discard,
    clearDraft: draft.clear,
    confirming,
    requestClose,
    requestDiscard,
    requestFillAll,
    keepEditing,
    confirmPending,
  };
}
