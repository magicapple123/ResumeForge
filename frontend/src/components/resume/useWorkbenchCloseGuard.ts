// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台的**关闭守卫**（从 `ResumeZoomModal` 拆出，W03 行数预算）。
 *
 * 关闭入口有四个（动作条 ×、Esc、遮罩、抽屉/中栏放弃），但语义只有一个：
 * 1. **有改动**（内容脏 / 版式与快照不同 / 纸面加粗）或这还是一份**草稿** → 先就地亮确认卡片；
 * 2. 真正关闭前先 `invalidateDocument()`：让保存状态机作废在飞回包（晚到的成功不能把
 *    已关掉的界面标成已保存）；
 * 3. 「放弃并关闭」= 丢掉中栏内容与纸面加粗再关；「取消修改」= 内容回填 + 版式回滚。
 *
 * 拆出去的原因：外壳文件同时装所有挂载点，已贴住 500 行预算；这里的判断不涉及 JSX。
 */
import { useState } from "react";
import type { RefObject } from "react";
import type { MessageKey } from "../../i18n";
import type { ResumeWorkbenchEditorHandle } from "./ResumeWorkbenchEditorColumn";

interface Options {
  /** 有没有**任何**改动（`useWorkbenchOverallSave` 的唯一出口，加粗已并进去）。 */
  dirty: boolean;
  layoutDirty: boolean;
  /** 只有内容脏（版式没动）：确认句只点名内容。 */
  editorDirty: boolean;
  isDraft: boolean;
  cancel: () => void;
  invalidateDocument: () => void;
  editorRef: RefObject<ResumeWorkbenchEditorHandle | null>;
  onDiscardRichText?: () => void;
  onClose: () => void;
}

export interface WorkbenchCloseGuard {
  closeConfirmOpen: boolean;
  closeBody: MessageKey;
  handleCloseRequest: (next: boolean) => void;
  handleCancel: () => void;
  confirmDiscardAndClose: () => void;
  cancelAll: () => void;
}

export function useWorkbenchCloseGuard({
  dirty,
  layoutDirty,
  editorDirty,
  isDraft,
  cancel,
  invalidateDocument,
  editorRef,
  onDiscardRichText,
  onClose,
}: Options): WorkbenchCloseGuard {
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  // 除了"有改动"，**草稿本身**也要问：那份记录还没进过简历中心，关掉等于扔掉它。
  const needsCloseConfirm = dirty || isDraft;

  const closeWorkbench = () => {
    invalidateDocument();
    onClose();
  };
  // 判断只写在这里、不写在按钮的 `onClick` 上：antd 会把 `Popconfirm` 自己的 onClick 与
  // 子元素的 click 合并，两处各写一份就会出现"问完又立刻关掉"或"关了卡片还亮着"。
  const handleCloseRequest = (next: boolean) => {
    if (!next) return setCloseConfirmOpen(false);
    if (needsCloseConfirm) setCloseConfirmOpen(true);
    else closeWorkbench();
  };
  const handleCancel = () => handleCloseRequest(true);
  const confirmDiscardAndClose = () => {
    editorRef.current?.discard();
    onDiscardRichText?.();
    setCloseConfirmOpen(false);
    closeWorkbench();
  };
  const cancelAll = () => {
    onDiscardRichText?.();
    cancel();
  };
  // 描述跟着"丢什么"走：只说"没保存"会让用户猜不出丢的是内容还是排版。
  const closeBody: MessageKey =
    layoutDirty && editorDirty
      ? "workbench.actionbar.discard.close-body"
      : layoutDirty
        ? "workbench.actionbar.discard.close-layout"
        : dirty
          ? "workbench.close.body-content"
          : "workbench.close.body-draft";

  return {
    closeConfirmOpen,
    closeBody,
    handleCloseRequest,
    handleCancel,
    confirmDiscardAndClose,
    cancelAll,
  };
}
