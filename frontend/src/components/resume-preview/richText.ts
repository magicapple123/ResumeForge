// SPDX-License-Identifier: Apache-2.0
/**
 * 简历正文的**字符级加粗标记**（`**`）：前端唯一一份标记解析。
 *
 * ## 为什么前端也要有一份
 *
 * 标记的真源（定义处）在后端 `app/services/resume/resume_rich_text.py`：HTML 预览、PDF、
 * Word、纯文本、ATS、提示词六个消费方都走它。前端的职责只有两件事——**右键加粗时改对那
 * 两个星号**，以及**在 iframe 里立刻看一眼结果**（等整份重渲染要一个网络往返）。两件事都
 * 需要"渲染态字符 ↔ 源串下标"的换算，而这份换算是唯一会让界面与导出**悄悄不一致**的地方，
 * 所以它必须只有一份实现，并且与后端**逐字同规则**：
 *
 * - 成对、不嵌套、不跨字段；
 * - **不配对的 `**` 当普通文字**（占 2 个可见字符）——绝不静默吞掉用户输入的星号；
 * - 不做任何"归一化 / 折叠"（`***` 不会变成别的样子）；
 * - 成对标记之间是空的时候不产出空区间（`****` 的可见文本是空串）。
 *
 * 共享用例放在同目录的 `richText.cases.json`：后端 `test_resume_rich_text.py` 与前端
 * `richText.test.ts` 读同一份数据，任何一侧改了规则都会立刻在另一侧露出来。
 *
 * ## 偏移量用「UTF-16 码元」
 *
 * 后端用 Python 的码点下标；前端只能用 JS 的下标（DOM `Range.toString().length` 也是码元），
 * 所以本模块**全程按 UTF-16 码元**计数。含星形平面字符（emoji 等）时两侧的**下标**不同，
 * 但两侧都只在自己的世界里换算（前端算完直接把新源串交给后端），因此不影响结果。
 *
 * ## 只输出文本与 `<strong>`
 *
 * `renderRichFragment` 绝不把 `**` 写进 DOM：预览里露出星号是"标记解析漏了一段"最直观的
 * 症状，而它一旦出现，用户会以为导出也会这样。
 */
import { clamp } from "../../features/ai-polish/overlayGeometry";

/** 加粗标记。与后端 `resume_rich_text.MARKER` 同一串。 */
export const RICH_MARKER = "**";

const MARKER_LEN = RICH_MARKER.length;

/** 源串里的一段连续区间：`bold` 为真表示它被一对标记包着（区间内不含标记本身）。 */
export interface RichSpan {
  start: number;
  end: number;
  bold: boolean;
}

/** 可见文本的一段（`parseRuns` 的返回值，与后端 `parse_runs` 逐项对应）。 */
export interface RichRun {
  text: string;
  bold: boolean;
}

/**
 * 右键加粗的最小契约（宿主实现，预览只调用）。
 *
 * 三个方法都**必须**在拿不到当前值时给出空结果而不是抛错：菜单是一次点击，抛错会让整个
 * 预览白屏，而用户只是右键了一下。
 */
export interface RichTextEditAdapter {
  /** 读这条路径当前的源串（含 `**`）。读不到返回 `null`（菜单不劫持原生右键）。 */
  read: (path: string) => string | null;
  /** 写入新的源串；`base` 是加粗前的原文，宿主用它判断"这条 overlay 是否已过期"。 */
  toggle: (path: string, next: string, base: string) => void;
  /** 菜单里的「编辑这一栏」。缺省时退化为宿主的 `onPickField`（同一个动作）。 */
  onPick?: (path: string) => void;
}

/** `**` 在文中的起点（按出现顺序，互不重叠）。与后端 `_marker_positions` 同规则。 */
function markerPositions(raw: string): number[] {
  const positions: number[] = [];
  let cursor = 0;
  for (;;) {
    const found = raw.indexOf(RICH_MARKER, cursor);
    if (found < 0) return positions;
    positions.push(found);
    cursor = found + MARKER_LEN;
  }
}

/**
 * 把源串切成 `(起, 止, 是否加粗)`；可见文本 = 各区间原文的拼接。
 *
 * 与后端 `_spans` 逐条对应：成对标记两两取用，落单的最后一个标记留在末尾的普通区间里
 * （原样可见），成对但中间为空的标记不产出区间。
 */
export function parseSpans(raw: string): RichSpan[] {
  if (!raw) return [];
  const positions = markerPositions(raw);
  const spans: RichSpan[] = [];
  let cursor = 0;
  let index = 0;
  while (index + 1 < positions.length) {
    const start = positions[index];
    const end = positions[index + 1];
    if (start > cursor) spans.push({ start: cursor, end: start, bold: false });
    const innerStart = start + MARKER_LEN;
    // 成对标记之间是空的（`****`）时不产出空区间：空 run / 空 `<strong>` 对渲染没有意义。
    if (end > innerStart) spans.push({ start: innerStart, end, bold: true });
    cursor = end + MARKER_LEN;
    index += 2;
  }
  if (cursor < raw.length) spans.push({ start: cursor, end: raw.length, bold: false });
  return spans;
}

/** 把源串切成 `(片段, 是否加粗)`；**不修改文本**。 */
export function parseRuns(raw: string): RichRun[] {
  return parseSpans(raw).map((span) => ({
    text: raw.slice(span.start, span.end),
    bold: span.bold,
  }));
}

/** 移除**成对**的加粗标记，落单的星号原样保留。 */
export function stripMarkers(raw: string): string {
  if (!raw.includes(RICH_MARKER)) return raw;
  return parseRuns(raw)
    .map((run) => run.text)
    .join("");
}

/** 渲染态字符数（标记不计）。 */
export function visibleLength(raw: string): number {
  let total = 0;
  for (const span of parseSpans(raw)) total += span.end - span.start;
  return total;
}

/** 渲染态下标 → 源串下标：长度 = `visibleLength(raw)`，值 = 该可见字符在源串里的位置。 */
export function renderIndexToSource(raw: string): number[] {
  const result: number[] = [];
  for (const span of parseSpans(raw)) {
    for (let index = span.start; index < span.end; index += 1) result.push(index);
  }
  return result;
}

/**
 * 源串下标 → 渲染态位置：长度 = `raw.length + 1`，值 = 该位置**之前**有多少个可见字符。
 *
 * 标记内部的那些位置没有"自己的"渲染态下标，统一记成标记之前的可见偏移（与"标记不计"
 * 这条规则一致）。区间边界换算全靠它。
 */
export function sourceToRenderIndex(raw: string): number[] {
  const result = new Array<number>(raw.length + 1).fill(0);
  let visible = 0;
  let cursor = 0;
  for (const span of parseSpans(raw)) {
    for (let index = cursor; index < span.start; index += 1) result[index] = visible;
    for (let index = span.start; index < span.end; index += 1) {
      result[index] = visible + (index - span.start);
    }
    visible += span.end - span.start;
    cursor = span.end;
  }
  for (let index = cursor; index <= raw.length; index += 1) result[index] = visible;
  return result;
}

/** 选区 `[start, end)`（渲染态）是否**整段**都加粗（空选区恒为 `false`）。 */
export function isBoldVisible(raw: string, start: number, end: number): boolean {
  const total = visibleLength(raw);
  const first = clamp(Math.min(start, end), 0, total);
  const second = clamp(Math.max(start, end), 0, total);
  if (first === second) return false;
  const covered: boolean[] = [];
  let visible = 0;
  for (const span of parseSpans(raw)) {
    const spanStart = visible;
    const spanEnd = visible + (span.end - span.start);
    visible = spanEnd;
    if (spanStart < second && spanEnd > first) covered.push(span.bold);
  }
  return covered.length > 0 && covered.every(Boolean);
}

/** 把选区边界推到**标记边界**上，避免在半对标记里切一刀（后端 `_aligned`）。 */
function alignToSpans(spans: RichSpan[], first: number, second: number): [number, number] {
  let left = first;
  let right = second;
  for (const span of spans) {
    if (!span.bold) continue;
    if (span.start < left && left < span.end) left = span.start;
    if (span.start < right && right < span.end) right = span.end;
  }
  return [left, right];
}

/** 把**部分重叠**选区的区间切开，让每个区间要么整段在内、要么整段在外（后端 `_split_at`）。 */
function splitAt(spans: RichSpan[], first: number, second: number): RichSpan[] {
  const result: RichSpan[] = [];
  for (const span of spans) {
    const inside = span.start >= first && span.end <= second;
    const outside = span.end <= first || span.start >= second;
    if (inside || outside) {
      result.push(span);
      continue;
    }
    if (span.start < first) result.push({ start: span.start, end: first, bold: span.bold });
    const innerStart = Math.max(span.start, first);
    const innerEnd = Math.min(span.end, second);
    if (innerEnd > innerStart) result.push({ start: innerStart, end: innerEnd, bold: span.bold });
    if (span.end > second) result.push({ start: second, end: span.end, bold: span.bold });
  }
  return result;
}

/** 源串偏移版的"是否全粗"（后端 `is_bold`），只在本模块内部用。 */
function isBoldSource(spans: RichSpan[], first: number, second: number): boolean {
  if (first === second) return false;
  const covered = spans
    .filter((span) => span.start < second && span.end > first)
    .map((span) => span.bold);
  return covered.length > 0 && covered.every(Boolean);
}

/**
 * 在**渲染态偏移**上切换加粗：已全粗则取消，否则整段加粗。
 *
 * 与后端 `toggle_bold` 同规则（后端收源串偏移，这里多一步换算），返回新的源串与新的
 * 渲染态区间——菜单点完之后要靠这个区间把选区放回去，否则用户的选区会跳到别处。
 *
 * 只增删标记，可见文本一个字节都不变，也不会留下空标记（`****`）；相邻同态区间自动合并，
 * 免得产出 `**a****b**` 这种"能解析但看起来像坏了"的东西。
 */
export function toggleBold(
  raw: string,
  start: number,
  end: number,
): { next: string; range: [number, number] } {
  const total = visibleLength(raw);
  const firstVisible = clamp(Math.min(start, end), 0, total);
  const secondVisible = clamp(Math.max(start, end), 0, total);
  if (firstVisible === secondVisible) return { next: raw, range: [firstVisible, secondVisible] };

  const map = renderIndexToSource(raw);
  const sourceFirst = map[firstVisible];
  const sourceSecond = map[secondVisible - 1] + 1;
  const spans = parseSpans(raw);
  const [first, second] = alignToSpans(spans, sourceFirst, sourceSecond);
  const target = !isBoldSource(spans, first, second);

  const merged: RichRun[] = [];
  for (const span of splitAt(spans, first, second)) {
    const inside = span.start >= first && span.end <= second;
    const bold = inside ? target : span.bold;
    const text = raw.slice(span.start, span.end);
    const last = merged[merged.length - 1];
    if (last && last.bold === bold) last.text += text;
    else merged.push({ text, bold });
  }
  const next = merged
    .map((run) => (run.bold ? `${RICH_MARKER}${run.text}${RICH_MARKER}` : run.text))
    .join("");

  // 新区间用**原串**的"源串下标 → 可见偏移"表换算：可见文本本来就没变，边界搬过去仍然成立。
  // 极端情况（选区里含落单的 `*`）会让新串的可见长度变化，夹一下防止越界。
  const visibleBefore = sourceToRenderIndex(raw);
  const nextTotal = visibleLength(next);
  const range: [number, number] = [
    clamp(visibleBefore[first], 0, nextTotal),
    clamp(visibleBefore[second], 0, nextTotal),
  ];
  return { next, range };
}

/**
 * 把一段源串渲染成 DOM 片段：**只有文本节点与 `<strong>`**，绝不输出 `**` 字面量。
 *
 * 传 `doc` 而不是用全局 `document`：纸面在 iframe 里，跨 realm 建节点必须用那个文档的
 * 工厂（否则节点插进 iframe 会报 `WrongDocumentError`）。
 */
export function renderRichFragment(doc: Document, raw: string): DocumentFragment {
  const fragment = doc.createDocumentFragment();
  for (const run of parseRuns(raw)) {
    if (!run.text) continue;
    if (run.bold) {
      const strong = doc.createElement("strong");
      strong.textContent = run.text;
      fragment.appendChild(strong);
    } else {
      fragment.appendChild(doc.createTextNode(run.text));
    }
  }
  return fragment;
}

/**
 * 把一个 `[data-resume-path]` 元素的内容就地换成 `raw` 的渲染结果。
 *
 * 菜单点完加粗后先走这一步（立即看到粗体），再由宿主把内容标脏、交给整份重渲染收口。
 * 元素已经脱离文档（iframe 在此期间重载过）时什么都不做。
 */
export function paintRichField(element: Element | null, raw: string): void {
  if (!element || !element.isConnected) return;
  const doc = element.ownerDocument;
  while (element.firstChild) element.removeChild(element.firstChild);
  element.appendChild(renderRichFragment(doc, raw));
}
