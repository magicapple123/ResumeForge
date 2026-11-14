// SPDX-License-Identifier: Apache-2.0
/**
 * 「最近一次聚焦的字段输入框」注册表 + 就地写回（R-11 / F22 的编辑入口）。
 *
 * ## 为什么需要它
 *
 * 行内格式按钮（`InlineMarkButtons`、右键菜单）**不持有内容**：它只读"当前在编辑哪个
 * 输入框"的选区，再把改好的新串写回去。而制作台里输入框是受控组件（antd `Input` /
 * `Input.TextArea` → React state），所以写回不能只改 DOM：必须同时让 React 收到 `input`
 * 事件，否则下一次重渲染会把用户的修改擦掉。
 *
 * ## 单行与多行同一套规则（F22）
 *
 * 以前这里写死 `HTMLTextAreaElement`，于是日期区间、列表逐项、作者名、字段名这些
 * **单行 `Input`** 根本进不来——选中文字点工具条只会得到「先点中要修改的文本框」。
 * 现在类型是 `HTMLInputElement | HTMLTextAreaElement`，写回按 `instanceof` 选对应原型的
 * value setter；两者都支持 `selectionStart/End` 与 `setSelectionRange`。
 *
 * ## 记住选区（F22）
 *
 * 点工具条会让输入框失焦，部分浏览器在 blur 后把 `selectionStart` 复位到末尾，
 * 于是"刚选好文字 → 点按钮"这一拍读不到选区。登记时挂上 `select / keyup / mouseup`
 * 三个监听，记下**最近一次非空**选区；`blur` **不清理**（那正是要用的时刻）。
 * 监听只在登记时挂一次（`WeakSet` 去重），所以每个用 `onFocus` 登记过的输入框都自动具备。
 */
import type { InlineEdit, InlineRange } from "../layout/inlineMarks";

/** 能被行内格式写入的目标：单行 `Input` 与多行 `Input.TextArea`。 */
export type InlineMarkField = HTMLInputElement | HTMLTextAreaElement;

let lastFocused: InlineMarkField | null = null;
let remembered: { element: InlineMarkField; range: InlineRange } | null = null;
const WATCHED = new WeakSet<InlineMarkField>();

/** 当前实时选区；空区间返回 `null`（空选区不是"选过"，不该被记住）。 */
function liveSelection(element: InlineMarkField): InlineRange | null {
  const start = element.selectionStart ?? 0;
  const end = element.selectionEnd ?? start;
  return end > start ? { start, end } : null;
}

function remember(element: InlineMarkField): void {
  const range = liveSelection(element);
  if (range) remembered = { element, range };
}

/** 挂一次监听：选区变化（含拖选、键盘扩选、"全选"）都更新记忆。 */
function watch(element: InlineMarkField): void {
  if (WATCHED.has(element)) return;
  WATCHED.add(element);
  const capture = () => remember(element);
  element.addEventListener("select", capture);
  element.addEventListener("keyup", capture);
  element.addEventListener("mouseup", capture);
}

/** 输入框聚焦时登记（各编辑器在自己的 `onFocus` 里调用，见 `registerInlineMarkField`）。 */
export function markFocusedField(element: InlineMarkField | null): void {
  lastFocused = element;
  if (!element) return;
  watch(element);
  remember(element);
}

/** 取最近聚焦且仍在文档里的输入框；脱离文档就当作没有（弹窗关掉后不该再命中）。 */
export function getFocusedField(): InlineMarkField | null {
  if (lastFocused && lastFocused.isConnected) return lastFocused;
  return null;
}

/**
 * 最近一次非空选区（只在**同一个**输入框上有效）。
 *
 * 文本可能已经变短（撤销、AI 改写），所以返回值由调用方再夹到当前长度内
 * （`InlineMarkButtons.clampToText` 已在做）。
 */
export function getRememberedRange(): InlineRange | null {
  const element = getFocusedField();
  if (!element || !remembered || remembered.element !== element) return null;
  return remembered.range;
}

/** 把一次行内标记编辑写回那个输入框（含 React 事件与选区恢复）。 */
export function applyInlineEdit(edit: InlineEdit): void {
  const element = getFocusedField();
  if (!element) return;
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, edit.text);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.focus();
  element.setSelectionRange(edit.start, edit.end);
  remembered = { element, range: { start: edit.start, end: edit.end } };
}

/** 测试用：清掉登记与记忆，避免用例之间互相命中。 */
export function resetInlineMarkFieldsForTests(): void {
  lastFocused = null;
  remembered = null;
}
