// SPDX-License-Identifier: Apache-2.0
/**
 * 行内标记的**遮罩层**（I-26）：把源串按真实样式画出来，标记语法全程不可见。
 *
 * ## 为什么是"下面一层"而不是"隐藏标记"
 *
 * 文本域（`textarea`）没有任何按字符控制样式的 API，也没有"隐藏这一段字符"的能力。
 * 所以做法是把两层叠起来：
 *
 * ```
 * 上层：<textarea>  color: transparent（字形透明，但**占位**）+ caret-color 可见
 * 下层：<div>      按 `parseInlineMarkSegments` 画出真正的字形，pointer-events: none
 * ```
 *
 * 两层共用 `.rf-inline-mark-layer` 这一个类承担字体/行高/内边距/换行规则，
 * 所以**每个字形的横向位置逐个对应**：光标、选区、换行、滚动高度才不会错位。
 * 这也是本组件必须把 `hidden` 标记段也渲染出来的原因——`{@size=1.1}` 在文本域里
 * 占着 12 个字符的宽度，下层若把这些宽度抹掉，后面的字就全部左移，光标落在两个字的缝隙里。
 *
 * ## 本层**只画四样**：文字 + 隐藏段 + 选区 + 链接下划线
 *
 * T01 之后字号 / 字重 / 颜色**不在这一层画**：
 * - `font-size` 必然改变前进宽度 → 与文本域逐字错位（旧实现的已知漂移，已删除）；
 * - `font-weight: 700` 同样改字宽；
 * - `color` 虽不改宽度，但"编辑时突然变色"正是这条待办要消除的干扰（用户原话：
 *   调完颜色中栏输入框里的字跟着变色，影响输入）。
 *
 * 所以需要看真实样式的场景改由 `InlineMarkStatic` 承担（开关打开 + 失焦 + 有格式），
 * **两种渲染永不同框**。链接下划线保留：它不改字形宽度，且是唯一的链接提示。
 *
 * ## 输入法组合期为什么要把字显形
 *
 * 上层文字是透明的，而拼音/候选词的预编辑串**只画在上层**。若组合期仍保持透明，用户
 * 打不出可见的拼音（中文输入直接不可用）。所以组合期（`is-composing`）由父组件把下层
 * 隐藏、把上层文字显形——此时标记会短暂可见，这是"能用"优先于"好看"的取舍。
 *
 * ## 可访问性
 *
 * 本层 `aria-hidden="true"`，文本域仍是唯一的可访问控件；读屏读到的值仍带标记语法，
 * 没有为它补 `aria-describedby` 说明（需要新增界面文案，属于语言包，未在本文件范围内做）。
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";

import { parseInlineMarkSegments } from "./inlineMarkRuns";
import type { InlineMarkSegment } from "./inlineMarkRuns";
import "../../../styles/inline-mark-overlay.css";

interface Props {
  /** 源串（含标记），与文本域里的值**逐字相同**。 */
  value: string;
  /**
   * I-13：结构化字段的分段（纯文本 + runs，没有隐藏段）。给了它就不再解析 `value`——
   * 那类字段的 `value` 本来就没有标记字符，解析一遍只会得到同样的结果、白白多一份实现。
   */
  segments?: InlineMarkSegment[] | null;
  /** 文本域的纵向滚动量：两层不同步的话，长文本一滚就错位。 */
  scrollTop?: number;
  scrollLeft?: number;
  /**
   * DF-4：文本域的选区，**已换算到可见文字下标**（`visibleRangeOfSelection`）。
   * 遮罩层自绘高亮——`::selection` 画的是源串选区，会把隐形标记也染成一条空蓝带。
   */
  selection?: { start: number; end: number } | null;
}

/**
 * 分段 → 类名。**只有 hidden / link 两种**：加粗与字号颜色都由静态块负责（见文件头）。
 */
function segmentClassName(segment: { hidden?: boolean; href?: string }): string {
  const names = ["rf-inline-mark-segment"];
  if (segment.hidden) names.push("rf-inline-mark-hidden");
  if (segment.href) names.push("rf-inline-mark-link");
  return names.join(" ");
}

/**
 * 给每个分段标上它在**可见文字**里的区间（隐藏段为 -1）。
 *
 * 纯函数、模块级：累加只在函数自己的局部变量上做，渲染期不再改任何闭包变量
 * （`react-hooks/immutability` 与 StrictMode 双渲染都会盯着这一步）。
 */
function placeSegments(
  segments: InlineMarkSegment[],
): { segment: InlineMarkSegment; start: number; end: number }[] {
  const placed: { segment: InlineMarkSegment; start: number; end: number }[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (segment.hidden) {
      placed.push({ segment, start: -1, end: -1 });
      continue;
    }
    const start = cursor;
    cursor += segment.text.length;
    placed.push({ segment, start, end: cursor });
  }
  return placed;
}

export default function InlineMarkOverlay({
  value,
  segments: provided = null,
  scrollTop = 0,
  scrollLeft = 0,
  selection = null,
}: Props) {
  const segments = useMemo(() => provided ?? parseInlineMarkSegments(value), [provided, value]);
  // 滚动的两层同步：遮罩层不滚，而是把内容反向平移（它的盒子和文本域一样大、且 overflow hidden）。
  const mirrorStyle: CSSProperties = useMemo(
    () => ({ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }),
    [scrollLeft, scrollTop],
  );
  // 可见文字下标：只在**非 hidden**段上累加（标记段不占可见位置）。放在 useMemo 里算完
  // 再渲染——渲染期改闭包变量会被 `react-hooks/immutability` 拦下，且 StrictMode 下会算两遍。
  const placed = useMemo(() => placeSegments(segments), [segments]);
  return (
    <div className="rf-inline-mark-overlay" aria-hidden="true">
      <div className="rf-inline-mark-mirror rf-inline-mark-layer" style={mirrorStyle}>
        {placed.map(({ segment, start, end }, index) => {
          const className = segmentClassName(segment);
          if (segment.hidden) {
            return (
              <span key={index} className={className}>
                {segment.text}
              </span>
            );
          }
          const overlaps = selection !== null && selection.end > start && selection.start < end;
          if (!overlaps) {
            return (
              <span key={index} className={className}>
                {segment.text}
              </span>
            );
          }
          const from = Math.max(0, selection.start - start);
          const to = Math.min(segment.text.length, selection.end - start);
          return (
            <span key={index} className={className}>
              {segment.text.slice(0, from)}
              <span className="rf-inline-mark-selection">{segment.text.slice(from, to)}</span>
              {segment.text.slice(to)}
            </span>
          );
        })}
        {/*
          末尾补一个换行：`white-space: pre-wrap` 下文本域会把结尾的换行算成一行空行，
          div 默认不占这一行，补上之后两层的滚动高度才一致。
        */}
        {"\n"}
      </div>
    </div>
  );
}
