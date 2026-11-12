// SPDX-License-Identifier: Apache-2.0
/**
 * 打印检查（D10）：灰度/细线/强调色的**只读**对比度诊断。
 *
 * ## 只读
 *
 * 本模块只读 iframe 里**实际渲染后**的颜色（`--accent` / `--line` / body color），
 * 计算 WCAG 对比度后返回提示；没有写回 `format_config`、没有"自动改成可打印颜色"的
 * 分支——任务要求是"只提示风险，不自动改稿"。
 *
 * ## 为什么先转灰度再算细线
 *
 * 用户要检查的是**黑白打印**效果。彩色强调色与黑色文字的对比度可能很高，转成灰度后
 * 却与正文糊在一起；所以强调色/细线的判定基准是"灰度化之后的亮度差"，不是原色差。
 */
import { parseColor, type RgbColor } from "./colorMath";

/** 正文（常规字号）对比度门槛：WCAG AA。 */
export const TEXT_CONTRAST_MIN = 4.5;
/** 强调色多用于大字号/加粗，按 WCAG 大字门槛。 */
export const ACCENT_CONTRAST_MIN = 3;
/** 1px 细线在打印中最容易消失：灰度亮度比低于这个值就提示。 */
export const LINE_CONTRAST_MIN = 1.5;

export type DiagnosticItem = "text" | "accent" | "line";

export interface ColorSample {
  text?: string | null;
  accent?: string | null;
  line?: string | null;
  background?: string | null;
}

export interface DiagnosticFinding {
  item: DiagnosticItem;
  /** 实测对比度（保留一位小数由 UI 层格式化）。 */
  ratio: number;
  ok: boolean;
}

export interface DiagnosticResult {
  measured: boolean;
  findings: DiagnosticFinding[];
}

/** 相对亮度（WCAG 2.x）：线性化后加权平均。 */
function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: RgbColor): number {
  return (
    0.2126 * channelLuminance(color.r) +
    0.7152 * channelLuminance(color.g) +
    0.0722 * channelLuminance(color.b)
  );
}

/** 两色对比度（1–21）。 */
export function contrastRatio(foreground: RgbColor, background: RgbColor): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 按亮度压成灰度（模拟黑白打印，不做色彩管理）。 */
export function grayscaleOf(color: RgbColor): RgbColor {
  const gray = Math.round(0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b);
  return { r: gray, g: gray, b: gray };
}

const WHITE: RgbColor = { r: 255, g: 255, b: 255 };

function ratioOrNull(foreground: string | null | undefined, background: RgbColor): number | null {
  const color = parseColor(foreground);
  if (!color) return null;
  return contrastRatio(grayscaleOf(color), grayscaleOf(background));
}

/**
 * 诊断一次颜色采样。
 *
 * `measured` 为假 = 一个颜色都没读到（预览还没加载完 / 文档被卸载），UI 据此显示
 * "暂时量不到纸面颜色"，而不是显示"未发现问题"——后者会让用户误以为已经检查过。
 */
export function diagnoseColors(sample: ColorSample): DiagnosticResult {
  const background = parseColor(sample.background) ?? WHITE;
  const findings: DiagnosticFinding[] = [];
  const textRatio = ratioOrNull(sample.text, background);
  if (textRatio !== null) {
    findings.push({ item: "text", ratio: textRatio, ok: textRatio >= TEXT_CONTRAST_MIN });
  }
  const accentRatio = ratioOrNull(sample.accent, background);
  if (accentRatio !== null) {
    findings.push({ item: "accent", ratio: accentRatio, ok: accentRatio >= ACCENT_CONTRAST_MIN });
  }
  const lineRatio = ratioOrNull(sample.line, background);
  if (lineRatio !== null) {
    findings.push({ item: "line", ratio: lineRatio, ok: lineRatio >= LINE_CONTRAST_MIN });
  }
  return { measured: findings.length > 0, findings };
}

/** 从渲染后的纸面读取颜色采样（只读；读不到就给 `null` 字段）。 */
export function readColorSample(doc: Document | null): ColorSample {
  const view = doc?.defaultView;
  const root = doc?.documentElement;
  if (!doc || !view || !root) return {};
  const rootStyle = view.getComputedStyle(root);
  const bodyStyle = doc.body ? view.getComputedStyle(doc.body) : null;
  const cssVar = (name: string): string | null => {
    const value = rootStyle.getPropertyValue?.(name)?.trim() ?? "";
    return value.length > 0 ? value : null;
  };
  const firstColor = (selector: string): string | null => {
    const node = doc.querySelector(selector);
    if (!node) return null;
    const color = view.getComputedStyle(node).color ?? "";
    return color.length > 0 ? color : null;
  };
  return {
    text: cssVar("--text") ?? bodyStyle?.color ?? null,
    accent: cssVar("--accent") ?? firstColor(".section-title, h1, .name"),
    line: cssVar("--line") ?? firstColor(".entry-head, hr"),
    background: bodyStyle?.backgroundColor ?? null,
  };
}
