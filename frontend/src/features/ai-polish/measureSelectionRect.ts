// SPDX-License-Identifier: Apache-2.0
/**
 * 量出「选区在屏幕上的哪一块」——AI 润色按钮就浮在这块下方。
 *
 * `input` / `textarea` 的选区没法直接取矩形（它们不是 DOM 选区），浏览器也没给出
 * 对应 API，所以用一个隐藏的镜像 `div` 复制排版属性、把选区包进一个 `span` 再量。
 * `contenteditable` 有真正的 Range，直接量即可。
 */

/** 与 `DOMRect` 同形的矩形；只保留定位会用到的字段，便于在测试里构造。 */
export interface SelectionRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface MeasureInput {
  kind: "input" | "textarea" | "contenteditable";
  element: HTMLElement;
  start: number;
  end: number;
}

/**
 * 镜像必须继承的排版属性：漏一个，量出来的位置就会偏（字宽、行高、内边距、
 * 边框宽度、字距、换行规则都会改变换行点）。
 */
const MIRRORED_PROPERTIES = [
  "box-sizing",
  "width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-variant",
  "font-stretch",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "text-transform",
] as const;

function toRect(rect: DOMRect): SelectionRect {
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function measureField({ element, start, end }: MeasureInput): SelectionRect | null {
  const field = element as HTMLInputElement | HTMLTextAreaElement;
  const value = field.value ?? "";
  const body = element.ownerDocument?.body;
  if (!body) return null;

  const mirror = element.ownerDocument.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  const box = mirror.style;
  box.position = "absolute";
  box.visibility = "hidden";
  box.pointerEvents = "none";
  box.top = "0";
  box.left = "-9999px";
  // textarea 会按换行折行，input 永远单行：两者的换行规则必须分开。
  box.whiteSpace = field instanceof HTMLTextAreaElement ? "pre-wrap" : "pre";
  box.overflowWrap = "break-word";

  const computed = window.getComputedStyle(field);
  for (const property of MIRRORED_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value) box.setProperty(property, value);
  }

  mirror.append(element.ownerDocument.createTextNode(value.slice(0, start)));
  const span = element.ownerDocument.createElement("span");
  // 空选区（start === end）也要能量：塞一个零宽空格占位，否则 span 尺寸为 0。
  span.textContent = value.slice(start, Math.max(start, end)) || "\u200b";
  mirror.append(span);
  mirror.append(element.ownerDocument.createTextNode(value.slice(end)));

  body.append(mirror);
  try {
    return toRect(span.getBoundingClientRect());
  } finally {
    mirror.remove();
  }
}

function measureContentEditable(element: HTMLElement): SelectionRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return null;

  // `Range.getBoundingClientRect` 是最精准的量法，但不是每个引擎都有（jsdom 就没有），
  // 缺了就退回整个可编辑区的矩形——按钮位置略粗，但不会因此完全不出现。
  const rect = (
    range as Range & { getBoundingClientRect?: () => DOMRect }
  ).getBoundingClientRect?.();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    // 折叠选区 / 空行没有矩形：退回整个可编辑区的矩形，按钮至少贴着它出现。
    return toRect(element.getBoundingClientRect());
  }
  return toRect(rect);
}

/**
 * 量出选区矩形；量不到时返回 `null`，由调用方退回元素自身的矩形。
 *
 * 镜像节点用完立即移除，不留在 DOM 里（否则会被无障碍树和截图测试看到）。
 */
export function measureSelectionRect(input: MeasureInput): SelectionRect | null {
  if (input.kind === "contenteditable") return measureContentEditable(input.element);
  return measureField(input);
}
