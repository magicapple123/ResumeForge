// SPDX-License-Identifier: Apache-2.0
/**
 * 图表调色板（R18）：自绘 SVG 图表用的颜色，深 / 浅各一套。
 *
 * 为什么不在组件里写十六进制：
 *  1. SVG 的 `fill` / `stroke` 是 presentation attribute，**不认 `var()`**——所以只能把
 *     "按主题解析好的字符串"传进去；
 *  2. 深色主题下最扎眼的是"亮线"：`#f0f2f5` 的全宽轨道会变成一块白板、`#d9e2ec` 的基线
 *     会变成一条发光的线，`#333` 的计数几乎看不见。这些都随主题换一套值。
 *
 * 新增图表请从这里取色，不要在组件里再写色值（`theme/inlineColorGuard.test.ts` 管内联样式，
 * 这里管的是"传给 SVG 属性的色板"）。
 */
import { useResolvedTheme, type ResolvedTheme } from "../features/theme/themeStore";

export interface ChartPalette {
  /** 多系列配色（柱状图每根柱子、排行榜每行）。顺序固定，索引取模使用。 */
  series: readonly string[];
  /** 中性色：非阶段类图表（轨道、骨架）用。 */
  neutral: string;
  /**
   * 阶段色：与 CSS 的 `--rf-stage-*` **同名同值**（SVG 的 fill 不认 var()，只能把解析好的
   * 字符串传进来）。漏斗必须按阶段取色，而不是按序号取 `series`——否则同一个"面试"
   * 在求职进度是紫色、在统计页是黄色，用户没法把它们当成同一件事。
   * `theme/stagePalette.test.ts` 会读 tokens.css 逐值比对，防止两边漂移。
   */
  stage: Readonly<Record<string, string>>;
  /** 横向条的全宽轨道底色。深色下必须暗下去，否则整块图表是白的。 */
  track: string;
  /** 柱状图的基线（网格线）。 */
  grid: string;
  /** 阶段 / 横轴标签。 */
  labelText: string;
  /** 计数这类要读的数字。 */
  valueText: string;
  /** 次级小字（百分比、单位）。 */
  mutedText: string;
}

export const CHART_PALETTES: Record<ResolvedTheme, ChartPalette> = {
  light: {
    series: ["#5b8ff9", "#61ddaa", "#65789b", "#f6bd16", "#7262fd", "#78d3f8"],
    neutral: "#8c8c8c",
    // 浅色：亮彩（与 `--rf-stage-bar-*` 同值）——条形是大色块，亮一点才看得清层次。
    stage: {
      applied: "#6b7c93",
      screening: "#4f8ff7",
      assessment: "#2ec4b6",
      interview: "#7c6cf5",
      offer: "#3fbf7f",
      rejected: "#e05c5c",
    },
    track: "#f0f2f5",
    grid: "#d9e2ec",
    labelText: "#555555",
    valueText: "#333333",
    mutedText: "#999999",
  },
  dark: {
    // 深底上用**同一色相降饱和**的暗彩色：**顺序必须与 light.series 一一对应**
    // （第 1 根柱子永远是蓝、第 2 根永远是薄荷……）。上一版直接套了阶段色，
    // 于是"周一的蓝"在深色下变成了灰、"周四的黄"变成了紫——颜色语义整体错位。
    series: ["#7f9fd8", "#79c2a4", "#8fa3bd", "#d1b46a", "#a79ad6", "#8fc4d8"],
    neutral: "#8d99a8",
    stage: {
      applied: "#94a3b8",
      screening: "#7fa8cc",
      assessment: "#6fb3b3",
      interview: "#a79ad6",
      offer: "#6cc79a",
      rejected: "#d98a8a",
    },
    // track / grid 对齐深色表面阶梯（A2）：track 比卡片面 #1a1e24 亮一档，
    // 才看得出"这是没填满的轨道"；grid 取边框色 #2a2f37，不发光。
    track: "#242b35",
    grid: "#2a2f37",
    labelText: "#aab5c4",
    valueText: "#e8ecf2",
    mutedText: "#909bab",
  },
};

/** 按解析后的主题取调色板（纯函数，测试与不依赖 hook 的场景可用）。 */
export function chartPaletteFor(theme: ResolvedTheme): ChartPalette {
  return CHART_PALETTES[theme];
}

/** 组件里用这个：主题切换时图表会跟着重渲染。 */
export function useChartPalette(): ChartPalette {
  return chartPaletteFor(useResolvedTheme());
}
