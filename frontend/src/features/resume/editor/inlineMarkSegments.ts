// SPDX-License-Identifier: Apache-2.0
/**
 * 行内标记的**分段**（I-12 · P-1 拆出来的第二块）：把标记串切成"覆盖整串"的可见/隐藏段。
 *
 * 为什么它单独一个文件：遮罩层（`InlineMarkOverlay`）要按这些段逐字排版，才能与文本域里
 * "透明但占位"的标记字符逐像素对齐——光标、换行、滚动高度全靠这一点。它与
 * `parseInlineMarkRuns`（只回答"可见文本长什么样"）是两个不同的问题，混在一个文件里
 * 会让 500 行预算先到顶。
 *
 * 依赖方向：本文件 → `inlineMarkRuns`（不是反过来）。`toVisible` / `placedRuns` 为了这一刀
 * 从模块私有变成导出，但**只有本文件用**，不在门面的对外 API 里。
 */

import type { CSSProperties } from "react";

import { placedRuns, toVisible } from "./inlineMarkRuns";
import type { InlineMarkSegment } from "./inlineMarkTypes";

/** 分段的"样式签名"：签名相同才能合并成一段（纯渲染优化，不改变语义）。 */
function signatureOf(segment: InlineMarkSegment): string {
  if (segment.hidden) return "hidden";
  return [
    segment.bold ? "b" : "",
    segment.size ?? "",
    segment.color ?? "",
    segment.href ?? "",
  ].join("|");
}

/**
 * 解析成**覆盖整串**的分段（含被隐藏的标记段），供遮罩层排版。
 *
 * 契约：`segments.map((segment) => segment.text).join("") === raw`。标记段带 `hidden: true`，
 * 遮罩层把它们渲染成"占位但不可见"的字形——正是这一点让两层换行位置与滚动高度逐像素一致。
 */
export function parseInlineMarkSegments(raw: string): InlineMarkSegment[] {
  if (!raw) return [];
  const segments: InlineMarkSegment[] = [];
  const push = (segment: InlineMarkSegment): void => {
    const last = segments[segments.length - 1];
    if (last && signatureOf(last) === signatureOf(segment)) {
      last.text += segment.text;
      return;
    }
    segments.push(segment);
  };
  const pushHidden = (text: string): void => {
    if (text) push({ text, hidden: true });
  };
  let cursor = 0;
  for (const run of placedRuns(raw)) {
    if (run.rawStart > cursor) pushHidden(raw.slice(cursor, run.rawStart));
    push(toVisible(run));
    cursor = run.rawEnd;
  }
  if (cursor < raw.length) pushHidden(raw.slice(cursor));
  return segments;
}

/**
 * 分段的渲染样式：**只服务静态预览块**（`InlineMarkStatic`）。
 *
 * T01 之后遮罩层不再调用它——遮罩层与文本域逐字叠在一起，任何改变前进宽度的属性
 * （字号、字重）都会让光标落在两个字的缝隙里；颜色虽不改宽度，但"打字时字突然变色"
 * 正是这条待办要消除的干扰。静态块不在文本域下面，可以如实渲染。
 */
export function inlineMarkSegmentStyle(segment: InlineMarkSegment): CSSProperties | undefined {
  if (segment.hidden) return undefined;
  const style: CSSProperties = {};
  if (segment.size !== undefined) style.fontSize = `${Math.round(segment.size * 100)}%`;
  if (segment.color) style.color = segment.color;
  return Object.keys(style).length > 0 ? style : undefined;
}
