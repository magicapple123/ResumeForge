// SPDX-License-Identifier: Apache-2.0
/**
 * 中栏「最近聚焦的文本域」+ 字符级标记（W07）的写回通道。
 *
 * ## 为什么是「最近聚焦」而不是 document.activeElement
 *
 * 点工具条上的按钮时焦点已经离开文本框（按钮自己拿到 focus），但 textarea 的
 * selectionStart/End 通常仍保留。所以要在编辑栏根节点用 onFocusCapture 记下最近一次聚焦的
 * textarea，并在 blur 之后**不**清空它（fe-typography §3 A.1）。
 *
 * ## 为什么还要「记住最近一次非空选区」
 *
 * 用户报的原始场景（2026-10-29）：「添加链接还需要选取文字」。原因不是规则层不支持，而是
 * **读选区的时机**：点图标时焦点先离开文本框，某些浏览器/交互顺序会把选区折叠成 0 长度
 * （点到工具条空白、popover 抢焦点、双击误触），于是 `selectionStart === selectionEnd`，
 * 按钮只能回一句「先选要修改的文字」——用户明明选过。
 *
 * 所以除了「最近聚焦的 textarea」，这里还维护「最近一次**非空**选区」：在绑定的 textarea
 * 上监听 `select` / `keyup` / `mouseup` / `blur`，只要出现过非空选区就记下来（含失焦那一拍）。
 * 点图标时组件先读实时选区、实时为空再回退到这份记忆（见 `InlineMarkButtons.readPicked`）。
 * 记忆只对**同一个** textarea 有效：换输入框/换简历都清掉（旧下标对新文本没有意义）。
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
import type { InlineRange } from "../../features/resume-layout/inlineMarks";
import type { InlineMarkCommit } from "./typography/InlineMarkButtons";

export interface WorkbenchInlineMarks {
  /** 最近聚焦的 textarea（blur 后保留；换简历时清空）。 */
  activeTextAreaRef: RefObject<HTMLTextAreaElement | null>;
  /** 挂到编辑栏根节点（React 的 onFocusCapture）。 */
  onFocusCapture: (event: FocusEvent<HTMLElement>) => void;
  /** InlineMarkButtons.getTarget：没有可编辑目标时返回 null（组件会提示，不静默）。 */
  getTarget: () => HTMLTextAreaElement | null;
  /**
   * InlineMarkButtons.getRememberedRange：最近一次**非空**选区（失焦/点按钮后仍可用）。
   *
   * 返回 null = 这个文本框上还没出现过非空选区，调用方应退回「光标处」语义。
   */
  getRememberedRange: () => InlineRange | null;
  /** InlineMarkButtons.onCommit：写回该字段，下一帧恢复焦点与选区。 */
  commit: (next: InlineMarkCommit) => void;
}

/**
 * 监听哪些事件来记选区。
 *
 * - `select`：用户拖选/双击选词/setSelectionRange 都会触发（最贴切的那个）；
 * - `keyup`：Shift + 方向键扩选（有些浏览器不派发 select）；
 * - `mouseup`：拖选结束的那一拍（select 在部分浏览器上早于鼠标松开）；
 * - `blur`：**关键的那一拍**——点工具条按钮就是它，此时选区还在，记下来才来得及。
 */
const SELECTION_EVENTS = ["select", "keyup", "mouseup", "blur"] as const;

/** 读一个 textarea 的规范化选区（start ≤ end；读不到就是 0/0）。 */
function readRange(element: HTMLTextAreaElement): InlineRange {
  const rawStart = element.selectionStart ?? 0;
  const rawEnd = element.selectionEnd ?? rawStart;
  return { start: Math.min(rawStart, rawEnd), end: Math.max(rawStart, rawEnd) };
}

export function useWorkbenchInlineMarks(resumeId?: number): WorkbenchInlineMarks {
  const activeTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  // 与 activeTextAreaRef 对应的"最近一次非空选区"：只在同一个 textarea 上有意义。
  const rememberedRangeRef = useRef<InlineRange | null>(null);
  // 已绑定的元素与监听器：换目标 / 卸载时按引用精确解绑（不用每次渲染重建闭包）。
  const bindingRef = useRef<{ element: HTMLTextAreaElement; handler: () => void } | null>(null);

  /** 解绑当前 textarea 上的选区监听（幂等）。 */
  const unbind = useCallback(() => {
    const binding = bindingRef.current;
    if (!binding) return;
    for (const eventName of SELECTION_EVENTS) {
      binding.element.removeEventListener(eventName, binding.handler);
    }
    bindingRef.current = null;
  }, []);

  /** 给新聚焦的 textarea 绑上选区监听；换元素时先清掉上一份记忆。 */
  const bind = useCallback(
    (element: HTMLTextAreaElement) => {
      if (bindingRef.current?.element === element) return;
      unbind();
      // 换了输入框：旧下标对新文本没有意义，宁可退回"光标处"也不要用错位置。
      rememberedRangeRef.current = null;
      const handler = () => {
        const range = readRange(element);
        // 只记非空选区：0 长度的光标位置不是"用户选过文字"。
        if (range.start !== range.end) rememberedRangeRef.current = range;
      };
      for (const eventName of SELECTION_EVENTS) {
        element.addEventListener(eventName, handler);
      }
      bindingRef.current = { element, handler };
      // 聚焦那一拍可能已经有选区（tab 进输入框、脚本 setSelectionRange）：先记一次。
      handler();
    },
    [unbind],
  );

  // 卸载：解绑监听（否则会在已卸载的组件上留着 DOM 闭包）。
  useEffect(() => unbind, [unbind]);

  // 换一份简历：旧 textarea 已不属于当前文档，不能继续当"最近聚焦"，记忆也一起清。
  useEffect(() => {
    activeTextAreaRef.current = null;
    rememberedRangeRef.current = null;
    unbind();
  }, [resumeId, unbind]);

  const onFocusCapture = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const target = event.target;
      // antd 的 Input.TextArea 底层就是 textarea；只读/禁用改不了，不当目标。
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (target.readOnly || target.disabled) return;
      activeTextAreaRef.current = target;
      bind(target);
    },
    [bind],
  );

  const getTarget = useCallback(() => activeTextAreaRef.current, []);

  const getRememberedRange = useCallback(() => rememberedRangeRef.current, []);

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
    // 写回后的选区就是"用户此刻看到的那一段"：记下来，下一次点按钮不必再选一遍。
    if (next.selection.end > next.selection.start) {
      rememberedRangeRef.current = { start: next.selection.start, end: next.selection.end };
    }
    // 等 React 把新 value 刷到 DOM 再落选区：否则偏移落在旧文本上。
    const restore = () => {
      target.focus();
      target.setSelectionRange(next.selection.start, next.selection.end);
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restore);
    else setTimeout(restore, 0);
  }, []);

  return { activeTextAreaRef, onFocusCapture, getTarget, getRememberedRange, commit };
}
