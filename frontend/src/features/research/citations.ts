// SPDX-License-Identifier: Apache-2.0
/**
 * 简报正文里的编号引用切分（T07）。
 *
 * 单独成文件（而不是放在 `ResearchBrief.tsx` 里）：组件文件只导出组件，
 * 切分逻辑要能被单测直接调用，也不该被 Fast Refresh 的"只导组件"规则盯着。
 */

/** 一个 `[n]` 引用片段。渲染层负责把它变成可点的链接。 */
export interface CitationToken {
  citation: number;
}

export type BriefToken = string | CitationToken;

const CITATION_PATTERN = /\[(\d+)\]/g;

/**
 * 把一行文本切成交替的「普通文字 / 引用编号」。
 *
 * 编号与来源的对应关系错了，用户点开的是另一条资料，而这种错误在视觉上看不出来，
 * 所以它在纯函数里单独可测。
 */
export function splitCitations(text: string): BriefToken[] {
  const tokens: BriefToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) tokens.push(text.slice(cursor, start));
    tokens.push({ citation: Number(match[1]) });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) tokens.push(text.slice(cursor));
  return tokens;
}
