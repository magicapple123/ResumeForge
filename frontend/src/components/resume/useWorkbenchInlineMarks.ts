// SPDX-License-Identifier: Apache-2.0
/**
 * 中栏「最近聚焦的文本域」+ 字符级标记（W07）的写回通道。
 *
 * ## 为什么是「最近聚焦」而不是 document.activeElement
 *
 * 点工具条上的按钮时焦点已经离开文本框（按钮自己拿到 focus），但 textarea 的
 * selectionStart/End 仍保留。所以要在编辑栏根节点用 onFocusCapture 记下最近一次聚焦的
 * textarea，并在 blur 之后**不**清空它（fe-typography §3 A.1）。
 *
 * ## 为什么走 DOM 的 input 事件而不是直接 setState
 *
 * 中栏表单是 antd Form 的受控字段：值、脏值、sessionStorage 草稿与 W03 统一历史全挂在
 * 同一条 onChange 上。复用 features/ai-polish/replaceSelection 的写法（原型 setter +
 * input 事件）等价于「替用户键入」，所以加粗/斜体/链接与手打走的是同一条写回链路。
 */
import { useCallback, useEffect, useRef } from "react";
import type { FocusEvent, RefObject } from "react";
import { replaceSelection } from "../../features/ai-polish/replaceSelection";
import { elementRect } from "../../features/ai-polish/selectionTarget";
import type { InlineMarkCommit } from "./typography/InlineMarkButtons";

export interface WorkbenchInlineMarks {
  /** 最近聚焦的 textarea（blur 后保留；换简历时清空）。 */
  activeTextAreaRef: RefObject<HTMLTextAreaElement | null>;
  /** 挂到编辑栏根节点（React 的 onFocusCapture）。 */
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
  /** InlineMarkButtons.getTarget：没有可编辑目标时返回 null（组件会提示，不静默）。 */
  getTarget: () => HTMLTextAreaElement | null;
  /** InlineMarkButtons.onCommit：写回该字段，下一帧恢复焦点与选区。 */
  commit: (next: InlineMarkCommit) => void;
}

export function useWorkbenchInlineMarks(resumeId?: number): WorkbenchInlineMarks {
  const activeTextAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // 换一份简历：旧 textarea 已不属于当前文档，不能继续当"最近聚焦"。
  useEffect(() => {
    activeTextAreaRef.current = null;
  }, [resumeId]);

  const onFocusCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    const target = event.target;
    // antd 的 Input.TextArea 底层就是 textarea；只读/禁用改不了，不当目标。
    if (!(target instanceof HTMLTextAreaElement)) return;
    if (target.readOnly || target.disabled) return;
    activeTextAreaRef.current = target;
  }, []);

  const getTarget = useCallback(() => activeTextAreaRef.current, []);

  const commit = useCallback((next: InlineMarkCommit) => {
    const target = activeTextAreaRef.current;
    if (!target || !target.isConnected) return;
    // 整段替换（start 0 / end 全文）：规则层已经给出插入标记后的完整文本。
    const outcome = replaceSelection(
      {
        kind: "textarea",
        element: target,
        start: 0,
        end: target.value.length,
        text: target.value,
        rect: elementRect(target),
      },
      next.text,
    );
    if (!outcome.ok) return;
    // 等 React 把新 value 刷到 DOM 再落选区：否则偏移落在旧文本上。
    const restore = () => {
      target.focus();
      target.setSelectionRange(next.selection.start, next.selection.end);
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restore);
    else setTimeout(restore, 0);
  }, []);

  return { activeTextAreaRef, onFocusCapture, getTarget, commit };
}
