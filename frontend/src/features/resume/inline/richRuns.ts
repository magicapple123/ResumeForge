// SPDX-License-Identifier: Apache-2.0
/**
 * `item.rich.runs` 的**唯一模型与纯函数**（I-12 · P2 / I-13）。
 *
 * ## 它是什么
 *
 * 磁盘形态（后端 `schemas/resume_document.RichText` 同形）：
 *
 * ```json
 * { "value": "带 8 人团队", "rich": { "runs": [{ "start": 0, "end": 5, "bold": true }] } }
 * ```
 *
 * `start` / `end` 是**纯文本下标**（左闭右开、UTF-16 码元），与后端
 * `resume_rich_marks.RichRun` 逐项对应。**只写非缺省键**：`bold=None`（没有这一项覆盖）
 * 与 `bold=false`（用户明确取消加粗）在磁盘上是两个意思，所以这里的 run 用
 * "键存在 = 覆盖，键缺省 = 不覆盖"，`false` 只在显式取消时出现。
 *
 * ## 为什么单独一处
 *
 * 编辑器（中栏文本域）与纸面（草稿模式右键菜单）都要"按区间改样式"，而它们一个在
 * `editor/`、一个在 `preview/`。模型放在两边任一侧都会让另一侧反向依赖；放在 `inline/`
 * 是唯一的共同祖先。**任何"再写一份标签解析/再拼一次标记串"的做法都是错的**——那正是
 * I-12 要消灭的多份实现。
 *
 * ## 三条性质（测试钉住）
 *
 * 1. **不产生标记字符**：本模块的所有输出都不含 `**` / `{@` / `[`（除非用户正文本来就有）；
 * 2. **区间合法**：`0 <= start < end <= text.length`，互不重叠，按 start 升序；
 * 3. **不丢样式**：`applyRunPatch` 只改被 `[start, end)` 覆盖的部分，区间外的 run 逐字节不变。
 */

import type { RichRun, RichText } from "../../../types/resumeDocument";

export type { RichRun, RichText };

/** 一份完整值：纯文本 + 旁挂样式。 */
export interface RichValue {
  text: string;
  runs: RichRun[];
}

/** 可以用补丁改的属性。`null` = 删掉这一项覆盖（回到"不覆盖"）。 */
export interface RichRunPatch {
  bold?: boolean | null;
  link?: string | null;
  size?: number | null;
  color?: string | null;
}

/** 样式键的顺序固定，便于签名比较与快照。 */
export const RICH_ATTRIBUTES = ["bold", "link", "size", "color"] as const;

export interface InlineRange {
  start: number;
  end: number;
}

/** 空值（无样式）。 */
export function emptyRichValue(text = ""): RichValue {
  return { text, runs: [] };
}

function clampRange(length: number, range: InlineRange): InlineRange {
  const start = Math.max(0, Math.min(length, range.start));
  const end = Math.max(start, Math.min(length, range.end));
  return { start, end };
}

/** run 的"样式签名"：签名相同才能合并（纯优化，不改变语义）。 */
function signatureOf(run: RichRun): string {
  return RICH_ATTRIBUTES.map((key) => (run[key] === undefined ? "" : String(run[key]))).join("|");
}

function hasStyle(run: RichRun): boolean {
  return RICH_ATTRIBUTES.some((key) => run[key] !== undefined);
}

/**
 * 规范化 runs：夹进文本范围、丢掉空区间与无样式区间、按起点排序并合并相邻同一样式。
 *
 * 为什么合并：`{0,2,bold}` + `{2,4,bold}` 与 `{0,4,bold}` 语义相同，但后者在磁盘上更短、
 * 在 diff 里更稳定。后端 `parse_marks` 产出的同样是"顺序切出来的 span"，不会出现重叠，
 * 这里遇到重叠按"先到先得"裁掉后半段（防手改数据把区间叠在一起）。
 */
export function normalizeRuns(runs: readonly RichRun[], textLength: number): RichRun[] {
  const length = Math.max(0, textLength);
  const sorted = runs
    .map((run) => {
      const start = Math.max(0, Math.min(length, Math.trunc(run.start)));
      const end = Math.max(start, Math.min(length, Math.trunc(run.end)));
      const clean: RichRun = { start, end };
      if (run.bold !== undefined) clean.bold = Boolean(run.bold);
      if (run.link) clean.link = run.link;
      if (typeof run.size === "number" && Number.isFinite(run.size)) clean.size = run.size;
      if (run.color) clean.color = run.color.toLowerCase();
      return clean;
    })
    .filter((run) => run.end > run.start && hasStyle(run))
    .sort((left, right) => left.start - right.start);

  const merged: RichRun[] = [];
  for (const run of sorted) {
    const last = merged[merged.length - 1];
    if (last && run.start < last.end) {
      // 重叠：把这一段推到上一段之后，超出部分直接丢掉（不猜用户想要哪一种叠加）。
      continue;
    }
    if (last && last.end === run.start && signatureOf(last) === signatureOf(run)) {
      last.end = run.end;
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
}

/** 覆盖 `[start, end)` 的每一段（含部分重叠的切段）。 */
function splitRuns(runs: readonly RichRun[], range: InlineRange, textLength: number): RichRun[] {
  const pieces: RichRun[] = [];
  for (const run of normalizeRuns(runs, textLength)) {
    if (run.end <= range.start || run.start >= range.end) {
      pieces.push({ ...run });
      continue;
    }
    if (run.start < range.start) pieces.push({ ...run, end: range.start });
    const innerStart = Math.max(run.start, range.start);
    const innerEnd = Math.min(run.end, range.end);
    if (innerEnd > innerStart) pieces.push({ ...run, start: innerStart, end: innerEnd });
    if (run.end > range.end) pieces.push({ ...run, start: range.end });
  }
  return pieces;
}

function applyPatch(run: RichRun, patch: RichRunPatch): RichRun {
  const next: RichRun = { ...run };
  for (const key of RICH_ATTRIBUTES) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null || value === false) {
      // `bold: false` 在磁盘上有意义（明确取消），但"取消"在标记语法里表达不了；
      // 编辑器点第二次加粗的语义是"不再加粗"= 删掉覆盖，所以这里统一删键。
      delete next[key];
      continue;
    }
    if (key === "size") next.size = value as number;
    else if (key === "color") next.color = String(value).toLowerCase();
    else if (key === "link") next.link = String(value);
    else next.bold = true;
  }
  return next;
}

/**
 * 给 `[start, end)` 打补丁；区间外的样式逐字节不变。
 *
 * 空选区直接返回原值（样式是"给一段文字加的"，不是"在光标处插属性"）；链接由
 * `setLinkRuns` 单独处理（它允许空选区 = 插入 URL 文本）。
 */
export function applyRunPatch(
  value: RichValue,
  range: InlineRange,
  patch: RichRunPatch,
): RichValue {
  const safe = clampRange(value.text.length, range);
  if (safe.start === safe.end) return value;
  const pieces = splitRuns(value.runs, safe, value.text.length);
  // 选区里**原本没有 run** 的那些字符也要参与打补丁：不补这一段，第一次加粗会静默无效
  // （`splitRuns` 只遍历已有 run，空值=没有任何东西可切）。
  const patches = fillCovered(pieces, safe);
  const runs = patches.map((run) =>
    run.start >= safe.start && run.end <= safe.end ? applyPatch(run, patch) : run,
  );
  const next = normalizeRuns(runs, value.text.length);
  if (signatureOfList(next) === signatureOfList(value.runs)) return value;
  return { text: value.text, runs: next };
}

/** 把选区里"没有 run 覆盖"的间隙补成无样式 piece，保证补丁能落到每一个字符上。 */
function fillCovered(pieces: RichRun[], range: InlineRange): RichRun[] {
  const covered = pieces
    .filter((run) => run.end > range.start && run.start < range.end)
    .map((run) => [Math.max(run.start, range.start), Math.min(run.end, range.end)] as const)
    .sort((left, right) => left[0] - right[0]);
  const filled = pieces.slice();
  let cursor = range.start;
  for (const [start, end] of covered) {
    if (start > cursor) filled.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < range.end) filled.push({ start: cursor, end: range.end });
  return filled;
}

function signatureOfList(runs: readonly RichRun[]): string {
  return runs.map((run) => `${run.start}-${run.end}-${signatureOf(run)}`).join(";");
}

/** 每段都被 `[start, end)` 完全覆盖时返回该属性值；否则 `undefined`（选区跨了两种样式）。 */
function coveredAttributes(value: RichValue, range: InlineRange, key: keyof RichRun): unknown {
  const safe = clampRange(value.text.length, range);
  if (safe.start === safe.end) return undefined;
  const covered = value.runs.filter((run) => run.start < safe.end && run.end > safe.start);
  if (covered.length === 0) return undefined;
  const first = covered[0][key];
  if (first === undefined) return undefined;
  return covered.every((run) => run[key] === first) ? first : undefined;
}

/** 选区当前是否整段加粗（用于"再点一次取消"）。 */
export function isBoldIn(value: RichValue, range: InlineRange): boolean {
  return coveredAttributes(value, range, "bold") === true;
}

/**
 * 选区当前的颜色：整段同一个 `#rrggbb` 时返回它，否则 `null`（未设色 / 跨了两种颜色）。
 *
 * 只给「自定义颜色…」的拾色面板当**初值**用：显示用户现在看到的那个颜色，
 * 而不是一个与纸面无关的默认色。不参与任何"要不要清除"的判断。
 */
export function colorIn(value: RichValue, range: InlineRange): string | null {
  const color = coveredAttributes(value, range, "color");
  return typeof color === "string" ? color : null;
}

/**
 * 切换加粗：整段已加粗 → 去掉；否则整段加粗。
 *
 * 与标记版 `toggleInlineMark` 的"再点一次取消"同一体感，但不产生任何 `**`。
 */
export function toggleBoldRuns(value: RichValue, range: InlineRange): RichValue {
  const bold = isBoldIn(value, range);
  return applyRunPatch(value, range, { bold: bold ? null : true });
}

/**
 * 切换字号 / 颜色：整段已经是同一档 → 清除该属性；否则整段设成这一档。
 *
 * "同值再点一次 = 去掉"是编辑器工具条既有语义（`inlineMarks.mergeAttrs`），这里保持一致。
 */
export function toggleSizeRuns(value: RichValue, range: InlineRange, size: number): RichValue {
  const same = coveredAttributes(value, range, "size") === size;
  return applyRunPatch(value, range, { size: same ? null : size });
}

export function toggleColorRuns(value: RichValue, range: InlineRange, color: string): RichValue {
  const hex = color.toLowerCase();
  const same = coveredAttributes(value, range, "color") === hex;
  return applyRunPatch(value, range, { color: same ? null : hex });
}

/**
 * 清除选区内的行内格式（加粗 / 字号 / 颜色）。
 *
 * **链接不清**：URL 无法从文字恢复（用户会丢掉目的地），与 `clearInlineMarks` 同一取舍。
 */
export function clearRunStyles(value: RichValue, range: InlineRange): RichValue {
  return applyRunPatch(value, range, { bold: null, size: null, color: null });
}

/** 把 `[start, end)` 变成链接；空选区先插入 URL 文本再挂链接。 */
export function setLinkRuns(value: RichValue, range: InlineRange, url: string): RichValue {
  const safe = clampRange(value.text.length, range);
  if (safe.start === safe.end) {
    const inserted = insertText(value, safe.start, url);
    return applyRunPatch(
      inserted,
      { start: safe.start, end: safe.start + url.length },
      { link: url },
    );
  }
  return applyRunPatch(value, range, { link: url });
}

/**
 * 文本被用户改动后**平移** runs（插入/删除/替换一段）。
 *
 * 只按"公共前缀 + 公共后缀"判定一处连续改动——这是文本域一次 `onChange` 能产生的
 * 全部形态（打字、删除、粘贴、撤回）。改动区间**整体落在里面**的 run 被丢掉（那几段字
 * 已经不存在了），跨边界的收拢到改动后的边界。样式不猜：不试图把格式"延续"到新字上。
 */
export function replaceRichText(value: RichValue, nextText: string): RichValue {
  if (nextText === value.text) return value;
  const oldText = value.text;
  const limit = Math.min(oldText.length, nextText.length);
  let prefix = 0;
  while (prefix < limit && oldText.charAt(prefix) === nextText.charAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    oldText.charAt(oldText.length - 1 - suffix) === nextText.charAt(nextText.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  const removed = oldText.length - prefix - suffix;
  const inserted = nextText.length - prefix - suffix;
  /**
   * 纯插入时，"插在哪"在公共前缀下是**歧义**的：`"team lead"` → `"the team lead"`
   * 既可以读作"在第 0 位插入 `the `"，也可以读作"在第 1 位插入 `he `"（前缀算法给的是后者）。
   * 判据用两端包含关系：
   *
   * - `next` 以 `old` 开头 = **追加**在末尾 → 已有 run 不动；
   * - `next` 以 `old` 结尾 = **插在最前面** → 已有 run 整体右移 `inserted`。
   *
   * 其余（中间插入）沿用公共前缀：边界恰在插入点上的 run 不移动。
   */
  const pureInsert = removed === 0 && inserted > 0;
  const prepend =
    pureInsert && nextText.endsWith(oldText) && !nextText.startsWith(oldText) && oldText.length > 0;
  const anchor = prepend ? 0 : prefix;
  const map = (position: number): number => {
    if (position < anchor) return position;
    if (position === anchor) return prepend ? position + inserted : position;
    if (position >= anchor + removed) return position - removed + inserted;
    return anchor;
  };
  const runs: RichRun[] = [];
  for (const run of normalizeRuns(value.runs, oldText.length)) {
    const start = map(run.start);
    const end = map(run.end);
    if (end <= start) continue;
    runs.push({ ...run, start, end });
  }
  return { text: nextText, runs: normalizeRuns(runs, nextText.length) };
}

/** 在 `at` 处插入文本（内部用，链接的"空选区"路径）。 */
function insertText(value: RichValue, at: number, inserted: string): RichValue {
  const position = Math.max(0, Math.min(value.text.length, at));
  return replaceRichText(
    value,
    `${value.text.slice(0, position)}${inserted}${value.text.slice(position)}`,
  );
}

/** 渲染态的一段（与 `InlineMarkSegment` 结构相同；`link` 在这里叫 `href`）。 */
export interface RichSegment {
  text: string;
  bold?: boolean;
  size?: number;
  color?: string;
  href?: string;
}

/**
 * 把一份值切成**覆盖整段文字**的分段（没有隐藏段——纯文本里没有标记字符）。
 *
 * 契约：`segments.map((s) => s.text).join("") === value.text`。遮罩层按它排版，
 * 与文本域里的纯文本逐字对齐。
 */
export function richSegments(value: RichValue): RichSegment[] {
  const segments: RichSegment[] = [];
  let cursor = 0;
  for (const run of normalizeRuns(value.runs, value.text.length)) {
    if (run.start > cursor) segments.push({ text: value.text.slice(cursor, run.start) });
    const segment: RichSegment = { text: value.text.slice(run.start, run.end) };
    if (run.bold) segment.bold = true;
    if (run.size !== undefined) segment.size = run.size;
    if (run.color) segment.color = run.color;
    if (run.link) segment.href = run.link;
    segments.push(segment);
    cursor = run.end;
  }
  if (cursor < value.text.length) segments.push({ text: value.text.slice(cursor) });
  return segments;
}

/**
 * 把一份值画成 DOM 片段（纸面"立刻看到结果"用）：只有文本节点与 `<strong>` / `<span>`，
 * **绝不输出任何标记字符**。
 *
 * 传 `doc` 而不是用全局 `document`：纸面在 iframe 里，跨 realm 建节点必须用那个文档的工厂
 * （否则节点插进 iframe 会报 `WrongDocumentError`，与 `renderRichFragment` 同一理由）。
 */
export function renderRichValue(doc: Document, value: RichValue): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  for (const segment of richSegments(value)) {
    if (!segment.text) continue;
    if (!segment.bold && !segment.size && !segment.color) {
      fragment.appendChild(doc.createTextNode(segment.text));
      continue;
    }
    const node = doc.createElement(segment.bold ? "strong" : "span");
    node.textContent = segment.text;
    if (segment.size !== undefined) node.style.fontSize = `${Math.round(segment.size * 100)}%`;
    if (segment.color) node.style.color = segment.color;
    fragment.appendChild(node);
  }
  return fragment;
}

export { clampRange as clampRichRange, replaceRichText as replaceTextInValue };
