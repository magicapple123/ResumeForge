/**
 * 判定「当前这段选区能不能被 AI 润色」，并给出改写它所需要的全部信息。
 *
 * 纯函数（只读 DOM）：不注册监听、不发请求，便于单独测试。真正的监听与浮层在
 * `AiPolishLayer.tsx`。
 */
import { measureSelectionRect, type SelectionRect } from "./measureSelectionRect";

export type SelectionKind = "input" | "textarea" | "contenteditable";

/** 可编辑控件：`contenteditable` 的宿主还是普通 HTMLElement。 */
export type EditableElement = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

export interface SelectionTarget {
  kind: SelectionKind;
  element: EditableElement;
  /** 选区在 `element.value`（或可编辑区文本）里的字符偏移。 */
  start: number;
  end: number;
  text: string;
  /** 选区矩形；量不到时退回元素矩形，供浮层定位。 */
  rect: SelectionRect;
}

/** 允许润色的 input 类型：`password`/`file`/`number` 这类不提供可用选区的除外。 */
const ALLOWED_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel"]);

/**
 * 敏感字段：密钥、口令、令牌不该被送去模型。命中即整块禁用（连按钮都不出现），
 * 而不是提醒用户"注意隐私"——用户此刻正在复制粘贴密码，不该被打断。
 */
const SENSITIVE_FIELD = /password|secret|token|api[-_]?key/i;

/** 选区必然落在哪个可编辑区里（`contenteditable` 可以是嵌套的）。 */
function contentEditableHost(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const host = element?.closest('[contenteditable="true"]');
  return host instanceof HTMLElement ? host : null;
}

function looksSensitive(element: HTMLElement): boolean {
  const markers = [element.getAttribute("name"), element.id, element.getAttribute("autocomplete")];
  return markers.some((marker) => !!marker && SENSITIVE_FIELD.test(marker));
}

/**
 * 可见性判定只读计算样式的 `display`/`visibility` 与 `hidden` 属性。
 *
 * 刻意不用 `getClientRects().length`：那是"是否已布局"的判据，antd 弹窗在
 * 退场动画里、以及 jsdom 里都会返回空，会把功能整个判死。
 */
function isVisible(element: HTMLElement): boolean {
  if (element.hidden) return false;
  if (element.closest('[aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * 这个元素是否「可以就地润色」。
 *
 * 排除项与理由：禁用/只读改不了（替换会失败）、`role="combobox"` 是 antd 的
 * 选择器输入框（文字是查询条件，不是要润色的内容）、`data-ai-polish-ignore`
 * 给页面自己留一个"这里别弹"的开关、敏感字段见 `SENSITIVE_FIELD`。
 */
export function isEditableElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest("[data-ai-polish-ignore]")) return false;
  if (element.getAttribute("role") === "combobox") return false;

  if (element instanceof HTMLInputElement) {
    if (!ALLOWED_INPUT_TYPES.has((element.type || "text").toLowerCase())) return false;
    if (element.disabled || element.readOnly) return false;
  } else if (element instanceof HTMLTextAreaElement) {
    if (element.disabled || element.readOnly) return false;
  } else if (element.getAttribute("contenteditable") !== "true") {
    return false;
  }

  if (looksSensitive(element)) return false;
  return isVisible(element);
}

function kindOf(element: HTMLElement): SelectionKind {
  if (element instanceof HTMLInputElement) return "input";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  return "contenteditable";
}

/** 选区起点在可编辑区文本里的字符偏移（含内部换行与行内元素的文字）。 */
function textOffset(host: HTMLElement, container: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(host);
  try {
    range.setEnd(container, offset);
  } catch {
    // 容器不在 host 里（DOM 刚被 React 换掉）：拿不到可信偏移，当 0 处理。
    return 0;
  }
  return range.toString().length;
}

function buildTarget(
  host: HTMLElement,
  kind: SelectionKind,
  start: number,
  end: number,
): SelectionTarget | null {
  if (end <= start) return null;
  const text =
    kind === "contenteditable"
      ? (window.getSelection()?.toString() ?? "")
      : (host as HTMLInputElement | HTMLTextAreaElement).value.slice(start, end);
  // 纯空白没有可润色的内容，发给模型只会花钱换来一段同样空的结果。
  if (!text.trim()) return null;

  const rect =
    measureSelectionRect({ kind, element: host, start, end }) ??
    toSelectionRect(host.getBoundingClientRect());
  return { kind, element: host, start, end, text, rect };
}

function toSelectionRect(rect: DOMRect): SelectionRect {
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * 读出当前选区；不可润色时返回 `null`。
 *
 * `contenteditable` 的选区在 `window.getSelection()` 里；`input`/`textarea` 的选区
 * 只挂在元素自身（`selectionStart/End`），而那个元素一定是当前聚焦的元素。
 */
export function getSelectionTarget(): SelectionTarget | null {
  const selection = window.getSelection();
  const host =
    selection && selection.rangeCount > 0 ? contentEditableHost(selection.anchorNode) : null;
  if (host && isEditableElement(host) && selection && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    const start = textOffset(host, range.startContainer, range.startOffset);
    const end = start + range.toString().length;
    const target = buildTarget(host, "contenteditable", start, end);
    if (target) return target;
  }

  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    if (!isEditableElement(active)) return null;
    const start = active.selectionStart;
    const end = active.selectionEnd;
    // `type="email"` 等类型不暴露 selectionStart（规范允许返回 null）：拿不到偏移就
    // 无法替换，宁可不出按钮，也不做一次"改了但看不到"的操作。
    if (start === null || end === null) return null;
    return buildTarget(active, kindOf(active), start, end);
  }

  return null;
}
