// SPDX-License-Identifier: Apache-2.0
/**
 * D11「机器读到的正文」的展示规则：把后端给出的**字符区间**在抽取文本里切成高亮片段。
 *
 * 为什么按区间而不是按 token 找子串（22b）：后端 `compare_text_order` 在比较时**已经知道**
 * 每个差异 token 落在产物里的哪一处，以前把这个位置丢了，前端只能 `indexOf` 猜——片段是
 * 常见字（「与」「内容」）时，正文里每一个同名片段都被涂上，`missing` 的片段甚至会把
 * 别处的正常文字涂成"缺失"。现在位置由后端下发（`order_highlights`），前端只做切片。
 *
 * 双栏顺序差异（`out_of_order`）用"提示"色而不是错误色：契约 §4.2/§4.5 明确这是
 * **已知结构性近似**，不冒充缺陷。
 */
import type { MachineTextPage, OrderDiff, OrderDiffKind, TextOrderHighlight } from "./types";

export type ScannerTokenKind = OrderDiffKind;

export interface ScannerToken {
  token: string;
  kind: ScannerTokenKind;
}

/**
 * 从后端 `order_diffs` 收集差异片段（同 token 取第一个差异类型）。
 *
 * 22b 起**不再参与涂色**（涂色只认 `order_highlights` 的区间）：保留是因为差异清单与
 * 图例仍按"片段 → kind"展示，且这是前端唯一一处 token 归一化口径。
 */
export function tokensFromOrderDiffs(
  diffs: readonly OrderDiff[] | null | undefined,
): ScannerToken[] {
  const tokens = new Map<string, ScannerToken>();
  for (const diff of diffs ?? []) {
    const token = diff.token.trim();
    // 过长的 token 是整段说明而不是词：不参与高亮，避免把整页刷成高亮。
    if (!token || token.length > 40) continue;
    if (!tokens.has(token)) tokens.set(token, { token, kind: diff.kind });
  }
  return [...tokens.values()];
}

/** 差异类型里出现过哪些 kind（图例只显示用到的颜色，少而准）。 */
export function diffKindsPresent(diffs: readonly OrderDiff[] | null | undefined): OrderDiffKind[] {
  const seen = new Set<OrderDiffKind>();
  for (const diff of diffs ?? []) seen.add(diff.kind);
  return [...seen];
}

export type HighlightSegment = { text: string; kind: "normal" | ScannerTokenKind };

/** 区间是否可用于切片（后端应保证；前端防御脏数据/老响应）。 */
function usableRange(range: TextOrderHighlight, length: number): boolean {
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    range.start >= 0 &&
    range.end > range.start &&
    range.end <= length
  );
}

/**
 * 按后端给的角色区间切成交替的普通/高亮片段（22b）。
 *
 * **偏移基准**：`start` / `end` 是该段文本的**码点**偏移（后端按 Python `str` 索引算）。
 * 这里一律先 `Array.from(text)` 拆成码点数组再切——`String.prototype.slice` 按 UTF-16
 * 码元走，一个 emoji 就占 2 个码元，直接切会把高亮涂到相邻的字上（而且不报错）。
 *
 * 区间按 `start` 升序；遇到与前一条重叠（含包含）的区间就丢弃后一条——后端保证不重叠，
 * 这里只是防御，宁可不涂也不要把同一段文字涂两遍。
 */
export function sliceByHighlights(
  text: string,
  ranges: readonly TextOrderHighlight[] | null | undefined,
): HighlightSegment[] {
  if (!text) return [];
  const chars = Array.from(text);
  const usable = (ranges ?? [])
    .filter((range) => usableRange(range, chars.length))
    .sort((left, right) => left.start - right.start);
  if (usable.length === 0) return [{ text, kind: "normal" }];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of usable) {
    if (range.start < cursor) continue; // 重叠：丢弃后一条
    if (range.start > cursor) {
      segments.push({ text: chars.slice(cursor, range.start).join(""), kind: "normal" });
    }
    segments.push({ text: chars.slice(range.start, range.end).join(""), kind: range.kind });
    cursor = range.end;
  }
  if (cursor < chars.length) {
    segments.push({ text: chars.slice(cursor).join(""), kind: "normal" });
  }
  return segments.filter((segment) => segment.text.length > 0);
}

/** 是否有可展示的机器读正文（没有就让视图显示"未提供"而不是空白）。 */
export function hasMachineText(pages: readonly MachineTextPage[] | null | undefined): boolean {
  return Boolean(pages && pages.some((page) => page.text.trim().length > 0));
}
