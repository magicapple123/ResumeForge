// SPDX-License-Identifier: Apache-2.0
/**
 * D11「机器读到的正文」的展示规则：把 `order_diffs` 点名的 token 在抽取文本里高亮。
 *
 * 为什么高亮 token 而不是标红整段：后端给的差异单位就是 token（契约 §4.4
 * `compare_text_order` 返回 token），整段标红会让用户以为"整页都错了"。
 *
 * 双栏顺序差异（`out_of_order`）用"提示"色而不是错误色：契约 §4.2/§4.5 明确这是
 * **已知结构性近似**，不冒充缺陷。
 */
import type { MachineTextPage, OrderDiff, OrderDiffKind } from "./types";

export type ScannerTokenKind = OrderDiffKind;

export interface ScannerToken {
  token: string;
  kind: ScannerTokenKind;
}

/** 从后端 `order_diffs` 收集需要高亮的 token（同 token 取第一个差异类型）。 */
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

/**
 * 把一段文本按 token 切成交替的普通/高亮片段。
 *
 * 长 token 优先匹配（"机器学习" 与 "机器" 同时存在时按长的切），不做大小写折叠：
 * 抽取文本与 token 来自同一个比较函数，折叠反而会把不同 token 混在一起。
 */
export function highlightSegments(
  text: string,
  tokens: readonly ScannerToken[],
): HighlightSegment[] {
  if (!text) return [];
  const ordered = [...tokens]
    .filter((item) => item.token.length > 0)
    .sort((left, right) => right.token.length - left.token.length);
  if (ordered.length === 0) return [{ text, kind: "normal" }];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let matched: ScannerToken | null = null;
    let matchedIndex = -1;
    for (const token of ordered) {
      const index = text.indexOf(token.token, cursor);
      if (index === -1) continue;
      if (matchedIndex === -1 || index < matchedIndex) {
        matched = token;
        matchedIndex = index;
      }
    }
    if (!matched || matchedIndex === -1) {
      segments.push({ text: text.slice(cursor), kind: "normal" });
      break;
    }
    if (matchedIndex > cursor) {
      segments.push({ text: text.slice(cursor, matchedIndex), kind: "normal" });
    }
    segments.push({ text: matched.token, kind: matched.kind });
    cursor = matchedIndex + matched.token.length;
  }
  return segments.filter((segment) => segment.text.length > 0);
}

/** 是否有可展示的机器读正文（没有就让视图显示"未提供"而不是空白）。 */
export function hasMachineText(pages: readonly MachineTextPage[] | null | undefined): boolean {
  return Boolean(pages && pages.some((page) => page.text.trim().length > 0));
}
