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
  /** 中性色：漏斗第一阶段（"全部岗位"）不该抢眼，用灰而不是彩色。 */
  neutral: string;
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
    track: "#f0f2f5",
    grid: "#d9e2ec",
    labelText: "#555555",
    valueText: "#333333",
    mutedText: "#999999",
  },
  dark: {
    // 深底上把同一组色相提亮一档：保持"哪个阶段是哪个颜色"的语义不变，
    // 同时让 #15181d 的背景上仍看得清边界。
    series: ["#7ea6ff", "#6fd9ab", "#8fa3bd", "#f6c85f", "#9a8cff", "#8fd8f8"],
    neutral: "#8d99a8",
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
