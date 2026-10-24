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

/** 加粗（`**`）：与既有右键菜单的标记一致。 */
export function toggleBoldMark(text: string, range: InlineRange): InlineEdit {
  return toggleInlineMark(text, range, "**");
}

/** 斜体（`*`）：成对、不跨字段、不嵌套；落单星号原样保留。 */
export function toggleItalicMark(text: string, range: InlineRange): InlineEdit {
  return toggleInlineMark(text, range, "*");
}

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
