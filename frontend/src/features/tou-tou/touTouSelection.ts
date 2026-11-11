// SPDX-License-Identifier: Apache-2.0
/**
 * 投投「划词动作」的定位与区域判定（#27A）。
 *
 * 本文件只放**纯函数**：选区矩形的并集、浮条的落点、区域分类、区域 → 动作映射。
 * 事件订阅（selectionchange + 200ms debounce、mouseup 后一帧定位）在
 * `useTouTouSelection`；渲染在 `TouTouSelectionMenu`。这样"1 个字符 / 跨段落 /
 * 跨元素"三种定位可以脱离浏览器事件与布局直接测。
 *
 * ## 区域判定
 *
 * 优先读显式属性 `data-tou-tou-region`（页面可以自己标注，取值见
 * `TOU_TU_SELECTION_REGIONS`），否则按现有稳定锚点向上找：
 * - 剪贴板卡：`.tt-clipboard-card`（投投自己的卡）；
 * - 岗位描述：`.job-detail-text` / `.job-detail-text-section` / `[data-job-description]`；
 * - 简历经历：`.document-editor` / `[data-document-section]` / `.resume-wb-canvas` /
 *   `[data-field-path]`。
 *
 * 这些类名是各页面现有的真实锚点（`DocumentEditor` 的根、`JobDetailDrawer` 的正文、
 * `EntryLayoutPanel` 的字段行）。找不到就落到"任意文本"，永远不猜。
 */
import type { MessageKey } from "../../i18n";

export type TouTouSelectionRegion = "resume-experience" | "job-description" | "clipboard" | "text";

export const TOU_TU_SELECTION_REGIONS: readonly TouTouSelectionRegion[] = [
  "resume-experience",
  "job-description",
  "clipboard",
  "text",
];

export type TouTouSelectionActionId =
  | "rewrite"
  | "star"
  | "numbers"
  | "check-duplicates"
  | "jd-match"
  | "keywords"
  | "explain"
  | "copy"
  | "save-material"
  | "recognize";

export const REGION_LABEL_KEYS: Record<TouTouSelectionRegion, MessageKey> = {
  "resume-experience": "touTou.selection.regionResume",
  "job-description": "touTou.selection.regionJob",
  clipboard: "touTou.selection.regionClipboard",
  text: "touTou.selection.regionText",
};

const ACTION_LABEL_KEYS: Record<TouTouSelectionActionId, MessageKey> = {
  rewrite: "touTou.selection.rewrite",
  star: "touTou.selection.star",
  numbers: "touTou.selection.numbers",
  "check-duplicates": "touTou.selection.checkDuplicates",
  "jd-match": "touTou.selection.jdMatch",
  keywords: "touTou.selection.keywords",
  explain: "touTou.selection.explain",
  copy: "touTou.selection.copy",
  "save-material": "touTou.selection.saveMaterial",
  recognize: "touTou.selection.recognize",
};

/** 每个区域浮出哪些动作（详册 27A 的表格，顺序即浮条顺序）。 */
const REGION_ACTIONS: Record<TouTouSelectionRegion, readonly TouTouSelectionActionId[]> = {
  "resume-experience": ["rewrite", "star", "numbers", "check-duplicates"],
  "job-description": ["jd-match", "keywords", "explain", "copy"],
  clipboard: ["recognize", "copy", "save-material"],
  text: ["explain", "copy", "save-material"],
};

export function selectionActionsForRegion(
  region: TouTouSelectionRegion,
): readonly TouTouSelectionActionId[] {
  return REGION_ACTIONS[region];
}

export function selectionActionLabelKey(action: TouTouSelectionActionId): MessageKey {
  return ACTION_LABEL_KEYS[action];
}

/** 浮条与选区之间的间距（详册要求 8px）。 */
export const SELECTION_MENU_GAP = 8;
/** 浮条离视口边缘的最小距离。 */
export const SELECTION_VIEWPORT_MARGIN = 8;

export interface SelectionRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function toSelectionRect(rect: {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width?: number;
  height?: number;
}): SelectionRect {
  const width = typeof rect.width === "number" ? rect.width : rect.right - rect.left;
  const height = typeof rect.height === "number" ? rect.height : rect.bottom - rect.top;
  return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width, height };
}

/**
 * 选区矩形并集。
 *
 * 一个 Range 跨段落/跨元素时会给出多个矩形（每行一段、每个元素一段），取并集才能
 * 把浮条放在"整段选中"的下方；只取第一段会让浮条跑到第一行下面。
 * 完全空（没有矩形，或全是 0 大小的 caret）返回 `null`，调用方据此不显示浮条。
 */
export function selectionAnchorRect(rects: readonly SelectionRect[]): SelectionRect | null {
  if (rects.length === 0) return null;
  let top = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(top) || !Number.isFinite(left)) return null;
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width === 0 && height === 0) return null;
  return { top, left, right, bottom, width, height };
}

export interface MenuPlacement {
  top: number;
  left: number;
  placement: "below" | "above";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), Math.max(min, max));
}

/**
 * 浮条落点：默认在选区下方 8px、水平居中；下方放不下就翻到上方，两侧夹回视口。
 *
 * 参数全是纯数字（视口/浮条尺寸由调用方量），所以三种选区形态的定位都能直接测。
 */
export function selectionMenuPosition(
  anchor: SelectionRect,
  viewport: { width: number; height: number },
  menu: { width: number; height: number },
): MenuPlacement {
  const maxLeft = Math.max(
    SELECTION_VIEWPORT_MARGIN,
    viewport.width - menu.width - SELECTION_VIEWPORT_MARGIN,
  );
  const left = clamp(
    anchor.left + anchor.width / 2 - menu.width / 2,
    SELECTION_VIEWPORT_MARGIN,
    maxLeft,
  );
  const maxTop = Math.max(
    SELECTION_VIEWPORT_MARGIN,
    viewport.height - menu.height - SELECTION_VIEWPORT_MARGIN,
  );
  const below = anchor.bottom + SELECTION_MENU_GAP;
  if (below <= maxTop) return { top: below, left, placement: "below" };
  const above = anchor.top - SELECTION_MENU_GAP - menu.height;
  if (above >= SELECTION_VIEWPORT_MARGIN) {
    return { top: above, left, placement: "above" };
  }
  return { top: clamp(below, SELECTION_VIEWPORT_MARGIN, maxTop), left, placement: "below" };
}

const REGION_ATTR = "data-tou-tou-region";
const CLIPBOARD_SELECTORS = [".tt-clipboard-card"];
const JOB_SELECTORS = [
  "[data-job-description]",
  ".job-detail-text",
  ".job-detail-text-section",
  ".job-detail-drawer",
];
const RESUME_SELECTORS = [
  "[data-resume-document]",
  "[data-document-section]",
  "[data-field-path]",
  ".document-editor",
  ".resume-wb-canvas",
  ".resume-wb-group",
];

function isRegion(value: string | null): value is TouTouSelectionRegion {
  return value !== null && (TOU_TU_SELECTION_REGIONS as readonly string[]).includes(value);
}

function closestElement(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** 选中文本落在哪一类区域（见文件头注释的锚点清单）。 */
export function classifySelectionRegion(node: Node | null): TouTouSelectionRegion {
  let element = closestElement(node);
  while (element) {
    const current: Element = element;
    const declared = current.getAttribute(REGION_ATTR);
    if (isRegion(declared)) return declared;
    if (CLIPBOARD_SELECTORS.some((selector) => current.matches(selector))) return "clipboard";
    if (JOB_SELECTORS.some((selector) => current.matches(selector))) return "job-description";
    if (RESUME_SELECTORS.some((selector) => current.matches(selector))) return "resume-experience";
    element = current.parentElement;
  }
  return "text";
}

export interface DomSelectionSnapshot {
  text: string;
  rect: SelectionRect;
  region: TouTouSelectionRegion;
}

/** 选中文本长度上限：与后端侧问端点的 `selection` 上限一致，超长截断而不是拒绝。 */
export const SELECTION_TEXT_MAX_CHARS = 4_000;

function nonEmptyText(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  return text.length > SELECTION_TEXT_MAX_CHARS ? text.slice(0, SELECTION_TEXT_MAX_CHARS) : text;
}

/** 读 `window.getSelection()`（页面正文里的划选）。 */
export function readWindowSelection(win: Window): DomSelectionSnapshot | null {
  const selection = win.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = nonEmptyText(selection.toString());
  if (!text) return null;
  const range = selection.getRangeAt(0);
  const rawRects =
    typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
  const anchor = selectionAnchorRect(rawRects.map(toSelectionRect));
  if (!anchor) return null;
  return { text, rect: anchor, region: classifySelectionRegion(selection.anchorNode) };
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", "number"]);

/**
 * 读表单控件里的选择（简历编辑器大多用 `textarea` / `input`）。
 *
 * 这类选择**不进** `window.getSelection()`，所以必须单独读 `selectionStart/End`。
 * 控件内无法逐行量出选区矩形，这里退到控件矩形定位浮条——位置是控件而不是光标，
 * 这是刻意的近似（能点、不遮内容），不假装精确。
 */
export function readFormControlSelection(win: Window): DomSelectionSnapshot | null {
  const active = win.document.activeElement;
  if (!active) return null;
  const tag = active.tagName;
  const control =
    tag === "TEXTAREA"
      ? (active as HTMLTextAreaElement)
      : tag === "INPUT" && TEXT_INPUT_TYPES.has((active as HTMLInputElement).type)
        ? (active as HTMLInputElement)
        : null;
  if (!control) return null;
  const start = control.selectionStart;
  const end = control.selectionEnd;
  if (typeof start !== "number" || typeof end !== "number" || start === end) return null;
  const text = nonEmptyText(control.value.slice(Math.min(start, end), Math.max(start, end)));
  if (!text) return null;
  const rect = control.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return {
    text,
    rect: toSelectionRect(rect),
    region: classifySelectionRegion(control),
  };
}

/** 当前有没有可操作的选中文本：先看表单控件，再看页面选区。 */
export function readActiveSelection(win: Window = window): DomSelectionSnapshot | null {
  return readFormControlSelection(win) ?? readWindowSelection(win);
}

/**
 * 只判断「有没有选中文本」，不需要量出矩形。
 *
 * 与 ``readActiveSelection`` 的区别：后者要求能算出选区矩形（jsdom 里恒为空、无头
 * 环境也可能拿不到），本函数只做文本判断。键盘入口用它做**闸门**（决定 mod+k 是接管
 * 还是让给全站搜索），面板真正打开时仍走 ``readActiveSelection`` 取快照。
 */
export function hasSelectedText(win: Window = window): boolean {
  const control = readFormControlSelectionText(win);
  if (control) return true;
  const selection = win.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  return Boolean(selection.toString().trim());
}

/** 表单控件内选中文本的**纯文本**判断（不依赖 getBoundingClientRect 的尺寸）。 */
function readFormControlSelectionText(win: Window): string | null {
  const active = win.document.activeElement;
  if (!active) return null;
  const tag = active.tagName;
  const control =
    tag === "TEXTAREA"
      ? (active as HTMLTextAreaElement)
      : tag === "INPUT" && TEXT_INPUT_TYPES.has((active as HTMLInputElement).type)
        ? (active as HTMLInputElement)
        : null;
  if (!control) return null;
  const start = control.selectionStart;
  const end = control.selectionEnd;
  if (typeof start !== "number" || typeof end !== "number" || start === end) return null;
  return nonEmptyText(control.value.slice(Math.min(start, end), Math.max(start, end)));
}
