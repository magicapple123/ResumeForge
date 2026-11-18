// SPDX-License-Identifier: Apache-2.0
/**
 * 行内标记的**渲染态解析**（前端唯一一份）。
 *
 * ## 它解决什么
 *
 * 用户给几个字加了字号/颜色/加粗/链接之后，编辑框里原本显示的是
 * `{@size=1.5}**{@color=#2f6fd0}教育部{@}**{@}` 这种源串——用户看到的是自己的标记语法。
 * 本模块把源串解析成**渲染态**（可见文字 + 它的样式），让遮罩层（`InlineMarkOverlay`）
 * 按真实样式把文字画出来，标记字符全部不可见。
 *
 * ## 为什么前端要复刻一份解析
 *
 * 标记的真源在后端（`resume_rich_text_parse.py` + `resume_inline_style.py`），五个导出出口
 * 都走它；编辑框需要**本地、同步**地画出结果（等一次网络往返等于"打字时框里是空的"）。
 * 两份实现的一致性靠**同一份 fixture** 双边校验：`backend/tests/fixtures/
 * inline_marks_cases.json` 的期望值由后端生成，后端 `test_inline_marks_fixture.py` 与
 * 前端 `inlineMarkRuns.test.ts` 都读它。
 *
 * ## 与后端逐条对齐的规则（改动前先读后端那两个模块）
 *
 * 1. 四类标记：成对 `**` 加粗、成对单 `*` 斜体（**只剥壳不倾斜**，`#5d`）、
 *    `[label](url)` 链接、`{@size=…,color=…}` … `{@}` 样式区间；
 * 2. **未闭合 / 属性非法一律按字面文本保留**：简历里的星号与花括号多半是用户真想印出来的
 *    符号，猜错比不猜更糟；整串样式未配平时一个样式都不生效，这里也一个字都不藏；
 * 3. 分层顺序 = 加粗 → 斜体剥壳 → 链接 → 样式区间拆解（`expand_runs` 的占位符语义）；
 *    **样式栈是"区间局部"的**：包在加粗之外的 `{@size}` 到不了加粗里的文字上——这是后端
 *    `split_masked` 的实际行为，前端必须跟着它，否则编辑框里的字号与导出结果不一致；
 * 4. URL 白名单只有一条（http/https/mailto、≤512、无空白、无 `<">`），与后端逐字一致。
 * 5. 偏移量全程按 **UTF-16 码元**（后端是码点）；两边都只在自己的世界里换算，
 *    所以含 emoji 时下标不同也不影响结果。
 *
 * ## 两种投影
 *
 * - `parseInlineMarkRuns`：**只有可见文字**，拼起来恒等于 `stripInlineMarks(raw)`；
 * - `parseInlineMarkSegments`：**覆盖整串**（含标记，标记段带 `hidden`）；遮罩层按它排版，
 *   字形位置才与文本域里那些"透明但占位"的字逐个对应——光标、换行、滚动高度都靠这一点。
 */
export {
  ATTRIBUTE,
  HEX_COLOR,
  HREF_UNSAFE,
  LINK_SCHEMES,
  MAX_INLINE_SIZE,
  MAX_LINK_URL_LENGTH,
  MIN_INLINE_SIZE,
  PLACEHOLDER,
  STYLE_CLOSE,
} from "./inlineMarkTypes";
export type {
  Atom,
  InlineMarkRun,
  InlineMarkSegment,
  InlineStyleAttributes,
  Piece,
} from "./inlineMarkTypes";
import {
  ATTRIBUTE,
  HEX_COLOR,
  HREF_UNSAFE,
  LINK_SCHEMES,
  MAX_INLINE_SIZE,
  MAX_LINK_URL_LENGTH,
  MIN_INLINE_SIZE,
  PLACEHOLDER,
  STYLE_CLOSE,
} from "./inlineMarkTypes";
import type { Atom, InlineMarkRun, InlineStyleAttributes, Piece } from "./inlineMarkTypes";

/**
 * `size=0.9,color=#c00` → 属性对象；**任何一项非法就整份作废**（返回 `null`）。
 * 与后端 `parse_style` 同规则：只认 size（0.5–1.6）与 color（`#rgb`/`#rrggbb`）。
 */
export function parseInlineStyleAttributes(attributes: string): InlineStyleAttributes | null {
  let size: number | undefined;
  let color: string | undefined;
  let found = false;
  for (const piece of attributes.split(",")) {
    if (!piece.trim()) continue;
    const match = ATTRIBUTE.exec(piece);
    if (!match) return null;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === "size") {
      const number = Number(value);
      if (!Number.isFinite(number) || number < MIN_INLINE_SIZE || number > MAX_INLINE_SIZE) {
        return null;
      }
      size = number;
      found = true;
      continue;
    }
    if (!HEX_COLOR.test(value)) return null;
    color = value.toLowerCase();
    found = true;
  }
  return found ? { size, color } : null;
}

/** 链接 URL 是否可安全渲染（与后端 `is_valid_link_url` 逐条一致）。 */
export function isValidInlineLinkUrl(url: string): boolean {
  const text = url.trim();
  if (!text || text.length > MAX_LINK_URL_LENGTH) return false;
  const lowered = text.toLowerCase();
  if (!LINK_SCHEMES.some((scheme) => lowered.startsWith(scheme))) return false;
  if (/\s/.test(text)) return false;
  return !HREF_UNSAFE.test(text);
}

/**
 * 把源串拆成原子序列。只有"属性合法且有收口"的 `{@…}` 才是标记；未闭合、属性非法、以及
 * 没有对应起始标记的 `{@}` 一律退回**普通字符**（用户看得见自己写了什么）。
 */
function tokenize(raw: string): Atom[] {
  const atoms: Atom[] = [];
  let depth = 0;
  let cursor = 0;
  const pushChar = (position: number): void => {
    atoms.push({ rawStart: position, rawEnd: position + 1, char: raw.charAt(position) });
  };
  while (cursor < raw.length) {
    if (raw.startsWith(STYLE_CLOSE, cursor)) {
      if (depth > 0) {
        atoms.push({
          rawStart: cursor,
          rawEnd: cursor + STYLE_CLOSE.length,
          char: null,
          close: true,
        });
        depth -= 1;
      } else {
        for (let offset = 0; offset < STYLE_CLOSE.length; offset += 1) pushChar(cursor + offset);
      }
      cursor += STYLE_CLOSE.length;
      continue;
    }
    if (raw.startsWith("{@", cursor)) {
      const close = raw.indexOf("}", cursor + 2);
      const body = close > 0 ? raw.slice(cursor + 2, close) : "";
      if (close > 0 && !body.includes("{") && !body.includes("}")) {
        const style = parseInlineStyleAttributes(body);
        if (style) {
          atoms.push({ rawStart: cursor, rawEnd: close + 1, char: null, style });
          depth += 1;
          cursor = close + 1;
          continue;
        }
        for (let position = cursor; position <= close; position += 1) pushChar(position);
        cursor = close + 1;
        continue;
      }
    }
    pushChar(cursor);
    cursor += 1;
  }
  if (depth > 0) {
    // 有开没收：整串按字面处理，一个样式都不生效（与后端 `mask_inline_styles` 的退化一致）。
    return raw.split("").map((char, position) => ({
      rawStart: position,
      rawEnd: position + 1,
      char,
    }));
  }
  return atoms;
}

/** 原子序列的"字符投影"：样式标记用一个占位字符顶位，保证下标与原子一一对应。 */
function atomText(atoms: Atom[]): string {
  return atoms.map((atom) => atom.char ?? PLACEHOLDER).join("");
}

/** 源串里是否存在任何标记（用来跳过整条遮罩层，普通字段零开销）。 */
export function hasInlineMarks(raw: string): boolean {
  return raw.includes("*") || raw.includes("{@") || raw.includes("[");
}

/**
 * 第 1 层：加粗。成对 `**` 之间是加粗区间，区间**连续覆盖整串**（含样式标记原子）；
 * 落单的最后一个标记留在末尾的普通区间里（原样可见），成对但中间为空的不产出区间。
 * 与后端 `_spans` 逐条对应。
 */
function boldPieces(text: string): Piece[] {
  const positions: number[] = [];
  let search = 0;
  for (;;) {
    const found = text.indexOf("**", search);
    if (found < 0) break;
    positions.push(found);
    search = found + 2;
  }
  const pieces: Piece[] = [];
  let cursor = 0;
  let index = 0;
  for (; index + 1 < positions.length; index += 2) {
    const start = positions[index];
    const end = positions[index + 1];
    if (start > cursor) pieces.push({ start: cursor, end: start, bold: false });
    const innerStart = start + 2;
    if (end > innerStart) pieces.push({ start: innerStart, end, bold: true });
    cursor = end + 2;
  }
  if (cursor < text.length) pieces.push({ start: cursor, end: text.length, bold: false });
  return pieces;
}

/**
 * 第 2 层：单星号剥壳（`#5d`：标记仍剥离，但**不产出倾斜效果**）。只有不与另一颗星号相邻的
 * 单星号算标记（`**` 是加粗字面量），成对两颗之间是保留区间，落单的原样留在可见文字里。
 */
function italicPieces(piece: Piece, text: string): Piece[] {
  const local = text.slice(piece.start, piece.end);
  const markers: number[] = [];
  for (let index = 0; index < local.length; index += 1) {
    if (local.charAt(index) !== "*") continue;
    if (local.charAt(index - 1) === "*" || local.charAt(index + 1) === "*") continue;
    markers.push(index);
  }
  if (markers.length < 2) return [piece];
  const pieces: Piece[] = [];
  let cursor = 0;
  let index = 0;
  for (; index + 1 < markers.length; index += 2) {
    const start = markers[index];
    const end = markers[index + 1];
    if (start > cursor) {
      pieces.push({ start: piece.start + cursor, end: piece.start + start, bold: piece.bold });
    }
    if (end > start + 1) {
      pieces.push({ start: piece.start + start + 1, end: piece.start + end, bold: piece.bold });
    }
    cursor = end + 1;
  }
  if (cursor < local.length) {
    pieces.push({ start: piece.start + cursor, end: piece.end, bold: piece.bold });
  }
  return pieces;
}

/**
 * 第 3 层：链接 `[label](url)`。非法 scheme / 落单括号 / 空 label 一律按字面保留（那部分
 * 字符不进保留区间，于是也**不会**被遮罩层藏起来）。label 里不再解析其它标记，与后端一致。
 */
function linkPieces(piece: Piece, text: string): Piece[] {
  const local = text.slice(piece.start, piece.end);
  if (!local.includes("[") || !local.includes("](")) return [piece];
  const pieces: Piece[] = [];
  let cursor = 0;
  let search = 0;
  for (;;) {
    const open = local.indexOf("[", search);
    if (open < 0) break;
    const mid = local.indexOf("]", open + 1);
    if (mid < 0) break;
    if (local.slice(mid + 1, mid + 2) !== "(") {
      search = open + 1;
      continue;
    }
    const close = local.indexOf(")", mid + 2);
    if (close < 0) {
      search = open + 1;
      continue;
    }
    const label = local.slice(open + 1, mid);
    const url = local.slice(mid + 2, close);
    if (!label || !isValidInlineLinkUrl(url)) {
      search = open + 1;
      continue;
    }
    if (open > cursor) {
      pieces.push({ start: piece.start + cursor, end: piece.start + open, bold: piece.bold });
    }
    pieces.push({
      start: piece.start + open + 1,
      end: piece.start + mid,
      bold: piece.bold,
      href: url,
    });
    cursor = close + 1;
    search = cursor;
  }
  if (cursor < local.length) {
    pieces.push({ start: piece.start + cursor, end: piece.end, bold: piece.bold });
  }
  return pieces;
}

/** 样式栈合并：内层覆盖同名字段，未设置的沿用外层（后端 `_merge`）。 */
function mergeStack(stack: InlineStyleAttributes[]): InlineStyleAttributes {
  let size: number | undefined;
  let color: string | undefined;
  for (const entry of stack) {
    if (entry.size !== undefined) size = entry.size;
    if (entry.color) color = entry.color;
  }
  return { size, color };
}

/** 一段可见 run：除了样式，还带着它在源串里的区间（遮罩层要用）。 */
interface PlacedRun extends InlineMarkRun {
  rawStart: number;
  rawEnd: number;
}

/** 去掉内部区间，只留可见文字与样式（两种投影共用这一处）。 */
export function toVisible(run: PlacedRun): InlineMarkRun {
  const visible: InlineMarkRun = { text: run.text, bold: run.bold };
  if (run.size !== undefined) visible.size = run.size;
  if (run.color) visible.color = run.color;
  if (run.href) visible.href = run.href;
  return visible;
}

/**
 * 把一层 piece 按样式标记切开：标记即"样式栈变化点"，切出来的每一段共享同一份样式。
 *
 * 对应后端 `split_masked` —— 它**从 piece 起点重新压栈**，所以"包在 piece 外面的样式区间
 * 不生效"。这是后端真实输出的行为（编辑框必须与导出一致），不是这里的选择。
 */
function styleRuns(atoms: Atom[], piece: Piece): PlacedRun[] {
  const runs: PlacedRun[] = [];
  const stack: InlineStyleAttributes[] = [];
  let buffer: string[] = [];
  let rawStart = -1;
  let rawEnd = -1;
  const flush = (): void => {
    if (buffer.length === 0) return;
    const style = mergeStack(stack);
    const run: PlacedRun = {
      text: buffer.join(""),
      bold: piece.bold,
      rawStart,
      rawEnd,
    };
    if (style.size !== undefined) run.size = style.size;
    if (style.color) run.color = style.color;
    if (piece.href) run.href = piece.href;
    runs.push(run);
    buffer = [];
    rawStart = -1;
    rawEnd = -1;
  };
  for (let index = piece.start; index < piece.end; index += 1) {
    const atom = atoms[index];
    if (atom.char === null) {
      flush();
      if (atom.close) stack.pop();
      else if (atom.style) stack.push(atom.style);
      continue;
    }
    if (rawStart < 0) rawStart = atom.rawStart;
    rawEnd = atom.rawEnd;
    buffer.push(atom.char);
  }
  flush();
  return runs;
}

/** 全部可见 run（含源串区间），按源串顺序排列。 */
export function placedRuns(raw: string): PlacedRun[] {
  if (!raw) return [];
  const atoms = tokenize(raw);
  const text = atomText(atoms);
  const runs: PlacedRun[] = [];
  for (const bold of boldPieces(text)) {
    for (const italic of italicPieces(bold, text)) {
      for (const link of linkPieces(italic, text)) {
        runs.push(...styleRuns(atoms, link));
      }
    }
  }
  return runs;
}

/**
 * 解析成**可见文字**的样式片段：各片段的 `text` 拼接恒等于 `stripInlineMarks(raw)`。
 * 空串返回空数组；纯函数（同一输入两次调用结果相同）。
 */
export function parseInlineMarkRuns(raw: string): InlineMarkRun[] {
  return placedRuns(raw).map(toVisible);
}

/**
 * 可读纯文本：**剪掉已识别的标记区间、其余原样保留**；链接只留 label（URL 不印刷）。
 *
 * 为什么是"剪区间"而不是"拼可见片段"：`tokenize` 对未闭合 / 属性非法 / 落单收口的
 * `{@…}` **一律退回普通字符**（第 2 条规则），所以它们本来就落在某个 run 里，
 * 原样出现；反过来，标记原子与四层标记语法永远不在 runs 里。两条合起来等于
 * "只删认出来的标记"——与后端 `strip_style_markers` 的保守剥离同一口径
 * （共享用例 `inlineMarks.cases.json` 双边断言）。
 *
 * 直接从源串切片（而不是 `run.text`）是刻意的：切片的字节一定等于原文那一段，
 * 不会因为缓冲拼装引入任何重排。
 */
export function stripInlineMarks(raw: string): string {
  if (!hasInlineMarks(raw)) return raw;
  let visible = "";
  for (const run of placedRuns(raw)) visible += raw.slice(run.rawStart, run.rawEnd);
  return visible;
}

/** 可见字符数（标记不计）。与 `stripInlineMarks` 同一口径：只删认出来的标记。 */
export function visibleInlineMarkLength(raw: string): number {
  return stripInlineMarks(raw).length;
}

export { inlineMarkSegmentStyle, parseInlineMarkSegments } from "./inlineMarkSegments";
