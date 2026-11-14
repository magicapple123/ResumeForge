// SPDX-License-Identifier: Apache-2.0
/**
 * W07 的**字符级标记编辑规则**（wave2 契约 §2.7 的协议 v2）：`**加粗**`（既有）、
 * `*斜体*`（新）、`[文字](https://…)`（新）。
 *
 * ## 边界：编辑 vs 渲染
 *
 * 本模块只负责"在用户选区上插入/移除标记"——富文本编辑器必须有这份规则，否则用户按下
 * 斜体按钮时没人知道该在哪敲星号。**渲染的唯一实现仍在后端** `resume_inline_marks`：
 * 前端解析一遍再画一遍，就是第二套标记协议（旧客户端显示字面星号的退化也会分叉）。
 *
 * ## 三条硬性质（与后端 `resume_inline_marks` 同口径）
 *
 * 1. 成对插入/成对删除：落单的 `*` 原样保留，不吞用户输入；
 * 2. 先 `**` 再 `*`：斜体判定要跳过已成对的加粗标记，否则 `**a**` 会被当成两个斜体；
 * 3. 链接只接受 `http(s)://`、无空白、长度 ≤512：`javascript:` 之类的 scheme 一律拒绝。
 *
 * ## 不支持 ≠ 假装支持
 *
 * 精确 PDF 没有真斜体（fpdf2 只注册 regular/bold），Word 与 HTML 支持；能力矩阵在
 * `utils/resumeFormatProbe.INLINE_MARK_CAPABILITY`，界面按那份说明标注。
 */

export interface InlineRange {
  start: number;
  end: number;
}

export interface InlineEdit extends InlineRange {
  text: string;
}

/** 链接 URL 的最大长度（与后端 `resume_inline_marks` 一致）。 */
export const MAX_LINK_URL_LENGTH = 512;

const LINK_URL = /^https?:\/\/[^\s]+$/i;

/** 合法链接：只允许 http(s)、无空白、长度受限（防 `javascript:` 注入）。 */
export function isValidLinkUrl(url: string): boolean {
  const text = url.trim();
  if (!text || text.length > MAX_LINK_URL_LENGTH) return false;
  return LINK_URL.test(text);
}

function clampRange(length: number, range: InlineRange): InlineRange {
  const start = Math.max(0, Math.min(length, range.start));
  const end = Math.max(start, Math.min(length, range.end));
  return { start, end };
}

/**
 * 选区是否贴着一段 `**` 加粗标记（开标记在选区左、闭标记在选区右，或紧邻）。
 *
 * 斜体切换必须**先让过加粗**：`**ab**` 里选中 `ab` 时，单星判定会把它当成一对斜体，
 * 去掉一颗星就把加粗拆坏了（协议 §2.7"先切 `**` 再切 `*`"）。
 */
function touchesBoldRun(text: string, range: InlineRange): boolean {
  if (range.start >= 2 && text.slice(range.start - 2, range.start) === "**") return true;
  if (text.slice(range.end, range.end + 2) === "**") return true;
  return wrappedBy(text, { start: range.start - 1, end: range.end + 1 }, "**");
}

/** 选区两侧是否恰好是同一对标记（用于"再点一次取消"）。 */
function wrappedBy(text: string, range: InlineRange, marker: string): boolean {
  const width = marker.length;
  if (range.start < width) return false;
  return (
    text.slice(range.start - width, range.start) === marker &&
    text.slice(range.end, range.end + width) === marker
  );
}

/**
 * 切换一种成对标记：已包住选区 → 去掉；否则包上；空选区 → 插入一对并把光标放中间。
 *
 * 斜体（`*`）必须**先检查加粗**（`**`）：否则 `**abc**` 会被当成"斜体包着 `*abc`"，
 * 再点斜体就会把加粗拆坏（契约 §2.7 的"先切 `**` 再切 `*`"）。
 */
export function toggleInlineMark(text: string, range: InlineRange, marker: string): InlineEdit {
  const safe = clampRange(text.length, range);
  if (marker === "*" && touchesBoldRun(text, safe)) {
    // 选区贴着 `**`（加粗的开/闭标记）：斜体按钮不拆加粗，返回未修改交给调用方提示。
    return { text, ...safe };
  }
  if (wrappedBy(text, safe, marker)) {
    const next =
      text.slice(0, safe.start - marker.length) +
      text.slice(safe.start, safe.end) +
      text.slice(safe.end + marker.length);
    return { text: next, start: safe.start - marker.length, end: safe.end - marker.length };
  }
  const selected = text.slice(safe.start, safe.end);
  const next = text.slice(0, safe.start) + marker + selected + marker + text.slice(safe.end);
  return { text: next, start: safe.start + marker.length, end: safe.end + marker.length };
}

/** 行内样式标记（R-11）：`{@size=0.9}…{@}`。收口串与后端 `resume_inline_style` 逐字一致。 */
export const STYLE_CLOSE = "{@}";

/**
 * 字号系数的合法区间（与后端 `resume_inline_style.MIN_SIZE / MAX_SIZE` 同一口径）。
 *
 * 前端必须先夹一遍：后端对超区间的开标记**按字面保留**（宁可整段不生效，也不猜），
 * 用户会看到纸面上原样印出的 `{@size=3}`。守卫测试把这两个数钉在后端常量上。
 */
export const MIN_INLINE_SIZE = 0.5;
export const MAX_INLINE_SIZE = 1.6;

/** 工具条上的常用字号档（80% / 90% / 110% / 125% / 150%）；100% 是「清除」。 */
export const INLINE_SIZE_STEPS = [0.8, 0.9, 1.1, 1.25, 1.5] as const;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const STYLE_ATTR = /^\s*(size|color)\s*=\s*(.+?)\s*$/i;

/** 字号系数夹到合法区间（非数字按 1 处理，调用方只传滑杆/输入框的值）。 */
export function clampInlineSize(size: number): number {
  if (!Number.isFinite(size)) return 1;
  return Math.min(MAX_INLINE_SIZE, Math.max(MIN_INLINE_SIZE, size));
}

/** `0.9 → "0.9"`、`1.2500001 → "1.25"`：标记里的数字不该出现浮点尾巴。 */
function formatSizeValue(size: number): string {
  return String(Number(clampInlineSize(size).toFixed(2)));
}

/**
 * 颜色规范化：只接受 `#rgb` / `#rrggbb`（后端 `_HEX_RE` 的口径），统一小写、三字母展开。
 *
 * ColorPicker 的 `onChange` 会给 `rgba(...)` 形式的 css 串；直接写进标记后端会判非法、
 * 整份样式作废。所以取值一律先 `toHexString()` 再走这里。
 */
export function normalizeInlineColor(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (!HEX_COLOR.test(text)) return null;
  if (text.length !== 4) return text;
  return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
}

/**
 * ColorPicker 的取值 → 标记里的 `#rrggbb`。
 *
 * 用结构化类型（只要 `toHexString()`）而不是 `import type { AggregationColor } from "antd"`：
 * 这条规则是纯函数，单测不该为了构造一个颜色对象去拉整个 antd。
 * 返回值 `null` = 这个颜色不能写进标记（调用方保持原文不变）。
 */
export function inlineColorValue(color: { toHexString(): string }): string | null {
  return normalizeInlineColor(color.toHexString());
}

/** 一条样式区间的属性表（已规范化）；`null` 表示这一项被显式清除。 */
export interface InlineStylePatch {
  size?: number | null;
  color?: string | null;
}

interface StyleRun {
  /** 开标记起点。 */
  start: number;
  /** 开标记之后的正文起点。 */
  contentStart: number;
  contentEnd: number;
  /** 收口标记之后的位置。 */
  end: number;
  attrs: Record<string, string>;
}

/** `size=0.9,color=#c00` → 属性表；有任何非法项整份作废（与后端 `parse_style` 同规则）。 */
function parseStyleAttrs(attributes: string): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  for (const piece of attributes.split(",")) {
    if (!piece.trim()) continue;
    const match = STYLE_ATTR.exec(piece);
    if (!match) return null;
    const key = match[1].toLowerCase();
    const value = match[2];
    if (key === "size") {
      const number = Number(value);
      if (!Number.isFinite(number) || number < MIN_INLINE_SIZE || number > MAX_INLINE_SIZE) {
        return null;
      }
      attrs.size = formatSizeValue(number);
      continue;
    }
    const hex = normalizeInlineColor(value);
    if (!hex) return null;
    attrs.color = hex;
  }
  return Object.keys(attrs).length > 0 ? attrs : null;
}

/**
 * 找出文本里所有**成对**的样式区间（按栈配对，支持嵌套，与后端 `mask_inline_styles` 同序）。
 *
 * 落单的开标记（没有 `{@}` 收口）不产出区间：后端也按字面保留，前端不该假装它生效。
 */
function parseStyleRuns(text: string): StyleRun[] {
  const runs: StyleRun[] = [];
  const stack: { start: number; contentStart: number; attrs: Record<string, string> }[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith(STYLE_CLOSE, index)) {
      const open = stack.pop();
      if (open) {
        runs.push({
          start: open.start,
          contentStart: open.contentStart,
          contentEnd: index,
          end: index + STYLE_CLOSE.length,
          attrs: open.attrs,
        });
      }
      index += STYLE_CLOSE.length;
      continue;
    }
    if (text.startsWith("{@", index)) {
      const close = text.indexOf("}", index);
      if (close > 0) {
        const attrs = parseStyleAttrs(text.slice(index + 2, close));
        if (attrs) stack.push({ start: index, contentStart: close + 1, attrs });
        index = close + 1;
        continue;
      }
    }
    index += 1;
  }
  return runs;
}

function openerOf(attrs: Record<string, string>): string {
  const parts: string[] = [];
  if (attrs.size) parts.push(`size=${attrs.size}`);
  if (attrs.color) parts.push(`color=${attrs.color}`);
  return `{@${parts.join(",")}}`;
}

/** 把一次补丁叠到现有属性上：**同值再点一次 = 去掉**（"再点一次取消"），`null` 也去掉。 */
function mergeAttrs(
  current: Record<string, string>,
  patch: InlineStylePatch,
): Record<string, string> {
  const next = { ...current };
  if (patch.size !== undefined) {
    if (patch.size === null) delete next.size;
    else {
      const value = formatSizeValue(patch.size);
      if (next.size === value) delete next.size;
      else next.size = value;
    }
  }
  if (patch.color !== undefined) {
    if (patch.color === null) delete next.color;
    else {
      const hex = normalizeInlineColor(patch.color);
      if (hex) {
        if (next.color === hex) delete next.color;
        else next.color = hex;
      }
    }
  }
  return next;
}

/**
 * 用新的开标记替换一条区间：正文不动，选区按开标记长度差平移。
 *
 * `keep` 是"用户看得见、希望继续被选中的那段"，坐标为**改动前**的偏移：
 * 整体拆/换标记时传区间正文，局部改属性时传用户原本的选区。
 */
function replaceRunOpener(
  text: string,
  run: StyleRun,
  attrs: Record<string, string>,
  keep: InlineRange,
): InlineEdit {
  const content = text.slice(run.contentStart, run.contentEnd);
  const opener = attrs.size || attrs.color ? openerOf(attrs) : "";
  const next =
    text.slice(0, run.start) + opener + content + (opener ? STYLE_CLOSE : "") + text.slice(run.end);
  const delta = opener.length - (run.contentStart - run.start);
  return { text: next, start: keep.start + delta, end: keep.end + delta };
}

/**
 * 给选区加/改/去一种行内样式（字号、颜色或两者）。
 *
 * 四条规则（与后端协议对齐，UI 的"下拉选字号"和"右键菜单"共用这一份）：
 *
 * 1. 选区正好就是一个完整区间 → 拆标记（再点一次取消）；
 * 2. 选区落在某个区间内部 → **改那个区间的开标记**（不是再套一层）：同属性覆盖、
 *    未涉及的属性保留。这条就是"同属性嵌套拍平"；
 * 3. 已经带了同值属性 → 去掉该属性（`size` 与 `color` 各自独立）；
 * 4. 都不满足 → 用 `{@size=…,color=…}` 包住选区；两个字段都为空则什么都不做。
 */
export function applyStyleMark(
  text: string,
  range: InlineRange,
  patch: InlineStylePatch,
): InlineEdit {
  const safe = clampRange(text.length, range);
  if (safe.start === safe.end) return { text, ...safe };
  const runs = parseStyleRuns(text);

  const exact = runs.find((run) => run.start === safe.start && run.end === safe.end);
  if (exact) {
    const content = { start: exact.contentStart, end: exact.contentEnd };
    return replaceRunOpener(text, exact, mergeAttrs(exact.attrs, patch), content);
  }

  // 最内层（start 最大）的包含区间
  const containing = runs
    .filter((run) => run.contentStart <= safe.start && safe.end <= run.contentEnd)
    .sort((left, right) => right.start - left.start)[0];
  if (containing) {
    return replaceRunOpener(text, containing, mergeAttrs(containing.attrs, patch), safe);
  }

  const attrs = mergeAttrs({}, patch);
  if (!attrs.size && !attrs.color) return { text, ...safe };
  const opener = openerOf(attrs);
  const selected = text.slice(safe.start, safe.end);
  return {
    text: text.slice(0, safe.start) + opener + selected + STYLE_CLOSE + text.slice(safe.end),
    start: safe.start + opener.length,
    end: safe.end + opener.length,
  };
}

/** 小一号（0.9×）：常用档，等价于字号选 90%。 */
export function toggleSmallMark(text: string, range: InlineRange): InlineEdit {
  return applyStyleMark(text, range, { size: 0.9 });
}

/** 强调色（红）：等价于颜色选 `#c0392b`。 */
export function toggleEmphasisMark(text: string, range: InlineRange): InlineEdit {
  return applyStyleMark(text, range, { color: "#c0392b" });
}

/**
 * 去掉选区里的行内格式（右键菜单「清除行内格式」）。
 *
 * 只处理**成对**的样式标记（`{@…}…{@}`，含嵌套）与成对的 `**` 加粗；落单的 `{@` / `**`
 * 原样保留——用户真的想印出来的花括号与星号不该被这条菜单吞掉。链接标记（`[字](url)`）
 * 不在清除范围内：那里承载了不可从文字恢复的 URL。
 */
export function clearInlineMarks(text: string, range: InlineRange): InlineEdit {
  const safe = clampRange(text.length, range);
  if (safe.start === safe.end) return { text, ...safe };
  const selected = text.slice(safe.start, safe.end);
  const runs = parseStyleRuns(selected).sort((left, right) => left.start - right.start);
  let inner = "";
  let cursor = 0;
  for (const run of runs) {
    if (run.start < cursor) continue; // 嵌套区间已随外层一起处理
    inner += selected.slice(cursor, run.start) + selected.slice(run.contentStart, run.contentEnd);
    cursor = run.end;
  }
  inner += selected.slice(cursor);
  // 成对 `**` 才去掉：`String.replace` 会把落单的星号也吞掉，那是两回事。
  const boldPairs = inner.match(/\*\*/g)?.length ?? 0;
  if (boldPairs % 2 === 0) inner = inner.replace(/\*\*/g, "");
  const next = text.slice(0, safe.start) + inner + text.slice(safe.end);
  return { text: next, start: safe.start, end: safe.start + inner.length };
}

/** 加粗（`**`）：与既有右键菜单的标记一致。 */
export function toggleBoldMark(text: string, range: InlineRange): InlineEdit {
  return toggleInlineMark(text, range, "**");
}

// #5d：斜体标记的写入入口已移除；单星号在解析侧仍按"去标记"剥壳（存量内容不冒裸星号）。

/**
 * 把选区变成链接：`[文字](url)`。
 *
 * - 选区文字作 label；空选区用 URL 本身作 label（用户仍能看到完整地址）；
 * - URL 不合法返回 `null`（调用方给错误提示，不写入内容）；
 * - label 里不再解析其它标记（契约 §2.7），所以不在这里做嵌套处理。
 */
export function insertLinkMark(text: string, range: InlineRange, url: string): InlineEdit | null {
  if (!isValidLinkUrl(url)) return null;
  const safe = clampRange(text.length, range);
  const trimmedUrl = url.trim();
  const label = text.slice(safe.start, safe.end) || trimmedUrl;
  const inserted = `[${label}](${trimmedUrl})`;
  const next = text.slice(0, safe.start) + inserted + text.slice(safe.end);
  return {
    text: next,
    start: safe.start,
    end: safe.start + inserted.length,
  };
}

/**
 * 选区是否落在一段链接标记内部（用于"进入链接时把 URL 放回输入框"）。
 *
 * 只做**局部**判定：返回包住选区的最近一个 `[label](url)` 的范围，不做全文解析
 * （全文解析用于渲染，唯一实现在后端）。
 */
export function linkMarkAround(
  text: string,
  range: InlineRange,
): { range: InlineRange; label: string; url: string } | null {
  const close = text.indexOf(")", range.end);
  if (close < 0) return null;
  const openBracket = text.lastIndexOf("[", range.start);
  if (openBracket < 0) return null;
  const mid = text.indexOf("](", openBracket);
  if (mid < 0 || mid > close) return null;
  const label = text.slice(openBracket + 1, mid);
  const url = text.slice(mid + 2, close);
  if (!isValidLinkUrl(url)) return null;
  return {
    range: { start: openBracket, end: close + 1 },
    label,
    url,
  };
}
