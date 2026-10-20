// SPDX-License-Identifier: Apache-2.0
/**
 * 把改写结果写回用户选中的位置。
 *
 * 难在"让受控组件也认这次改动"：React 给 `value` 装了自己的 setter 来比对变化，
 * 直接改 DOM 的 `value` 会被它当成"没变"而丢掉这次事件。所以走下表的顺序：
 * `execCommand`（保留撤销栈）→ 原型 setter + `input` 事件（React 能收到）。
 */
import type { SelectionTarget } from "./selectionTarget";

export type ReplaceFailure = "maxLength" | "detached" | "no-selection";

export interface ReplaceResult {
  ok: boolean;
  reason?: ReplaceFailure;
}

/** 用原型上的 setter 赋值并派发 `input`，React 的受控组件才会更新。 */
function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) descriptor.set.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * 用字符偏移还原一个 Range（`contenteditable` 专用）。
 *
 * 卡片里点按钮时真实选区可能已经丢了（用户在卡片的要求输入框里打过字），所以不能
 * 依赖 `window.getSelection()` 还停在原处——按捕获时的偏移重新算出来更可靠。
 */
function rangeFromOffsets(host: HTMLElement, start: number, end: number): Range | null {
  const doc = host.ownerDocument;
  const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  range.setStart(host, 0);
  range.collapse(true);

  let consumed = 0;
  let startSet = false;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (!startSet && start <= consumed + length) {
      range.setStart(node, Math.max(0, start - consumed));
      startSet = true;
    }
    if (startSet) {
      if (end <= consumed + length) {
        range.setEnd(node, Math.max(0, end - consumed));
        return range;
      }
      range.setEnd(node, length);
    }
    consumed += length;
    node = walker.nextNode();
  }

  // 偏移超出文本长度（DOM 变了）：只要能定位起点，就把尾巴收在文末。
  return startSet ? range : null;
}

function replaceInField(
  field: HTMLInputElement | HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
): ReplaceResult {
  const current = field.value ?? "";
  const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
  if (field.maxLength >= 0 && next.length > field.maxLength) {
    // 超上限时一个字符都不动：半截改写比不改更糟。
    return { ok: false, reason: "maxLength" };
  }

  field.focus();
  field.setSelectionRange(start, Math.min(end, current.length));
  if (next === current) {
    // 改写结果与原文一致：不需要派发事件，但选区要落在结果之后。
    field.setSelectionRange(start + text.length, start + text.length);
    return { ok: true };
  }

  let applied = false;
  if (typeof document.execCommand === "function") {
    try {
      // 走浏览器原生插入：撤销栈、输入法状态、`maxLength` 都交给它管。
      applied = document.execCommand("insertText", false, text);
    } catch {
      applied = false;
    }
  }

  if (!applied || field.value !== next) setFieldValue(field, next);
  const caret = start + text.length;
  field.setSelectionRange(caret, caret);
  return { ok: true };
}

function replaceInContentEditable(
  host: HTMLElement,
  start: number,
  end: number,
  text: string,
): ReplaceResult {
  const range = rangeFromOffsets(host, start, end);
  if (!range) return { ok: false, reason: "no-selection" };

  const doc = host.ownerDocument;
  const node = doc.createTextNode(text);
  range.deleteContents();
  range.insertNode(node);

  const caret = doc.createRange();
  caret.setStartAfter(node);
  caret.collapse(true);
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(caret);
  }

  const event =
    typeof InputEvent === "function"
      ? new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
      : new Event("input", { bubbles: true });
  host.dispatchEvent(event);
  return { ok: true };
}

/**
 * 用 `text` 替换 `target` 记录的选区。
 *
 * 失败只有三种原因，都返回结构化结果而不是抛异常——浮层要把原因翻译成一句中文提示。
 */
export function replaceSelection(target: SelectionTarget, text: string): ReplaceResult {
  const { element } = target;
  if (!element.isConnected) return { ok: false, reason: "detached" };

  if (target.kind === "contenteditable") {
    return replaceInContentEditable(element, target.start, target.end, text);
  }
  return replaceInField(
    element as HTMLInputElement | HTMLTextAreaElement,
    target.start,
    target.end,
    text,
  );
}
