// SPDX-License-Identifier: Apache-2.0
/**
 * 版式探针 CSS（项 6 / D10）：把"用户正在拖的值"即时注入预览 iframe，零网络往返。
 *
 * **必须与后端逐字一致**。后端 `FORMAT_FIELDS` 的 `css_rule` 由
 * `backend/app/services/resume/resume_template_format.py` 的 `format_css()`
 * （同文件 `:106`）用 `f"{value:g}"` 格式化：
 *
 * - `line_height` → `"body { line-height: %s !important; }"`（`:36`）
 * - `page_padding` → `"body { padding: %smm !important; }"`（`:45`）
 *
 * 为什么不省事写成 `line-height: 1.7`：存储走的是同一条 `css_rule`，一旦两边的
 * 数字格式不同（`1.7` vs `1.70000`、`14` vs `14.0`），用户会看到"松手后跳一下"
 * ——探针说一套、真实渲染说另一套。**两端各钉一次**（前端本文件 + 后端
 * `tests/test_export_format_config.py`）。
 */
// 只借一个数据形状（`{ top, right, bottom, left }`）：`pageMargins.ts` 不 import 本文件，
// 所以这条依赖是单向的，不会形成循环。
import type { PageMargins } from "./pageMargins";
import { DEFAULT_SCALE, SCALE_CSS_VARS, type ScaleKey } from "./resumeScaleParams";

/**
 * 复刻 Python 的 `f"{value:g}"`：6 位有效数字，去掉无意义尾零与小数点。
 *
 * `:g` 的行为就是"按 6 位有效数字四舍五入，然后按最短形式输出"，所以
 * `Number(value.toPrecision(6))` + `String(...)` 是它的等价物：
 * `1.7 → "1.7"`、`1.70 → "1.7"`、`14 → "14"`、`1.23456789 → "1.23457"`。
 */
export function formatG(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Number(value.toPrecision(6)));
}

/**
 * 行距探针：(value 是倍数，如 1.7)。
 *
 * 与后端 `FORMAT_FIELDS` 的 `line_height.css_rule` 逐字一致
 * （`backend/app/services/resume/resume_template_format.py:36`）——空格、分号、
 * `!important` 的位置都不能改，否则"拖动中看到的"与"松手后存下的"是两条规则。
 */
export function lineHeightProbeCss(value: number): string {
  return `body { line-height: ${formatG(value)} !important; }`;
}

/**
 * 页边距探针：(value 是毫米，如 14)。
 *
 * 与后端 `FORMAT_FIELDS` 的 `page_padding.css_rule` 逐字一致
 * （`backend/app/services/resume/resume_template_format.py:45`）。
 */
export function pagePaddingProbeCss(value: number): string {
  return `body { padding: ${formatG(value)}mm !important; }`;
}

/**
 * 四向页边距探针：四边相等时**转调** `pagePaddingProbeCss`，逐字回到单值形态。
 *
 * 为什么必须转调而不是自己再写一遍 `body { padding: ${v}mm !important; }`：后端
 * `page_padding_rule` 也是"四边相等 → 单值形态"（`len(set(...)) == 1` 那一支）。
 * 前端若在这里统一输出四值形态，用户拖完松手就会看到页边距从
 * `8mm 8mm 8mm 8mm` 跳回 `8mm`——而且"默认参数下的预览字节"会与导出不一致。
 *
 * 非对称时输出 CSS 简写顺序（上右下左）的四值形态，与后端逐字一致：
 * `body { padding: 8mm 12mm 12mm 12mm !important; }`。
 */
export function pageMarginsProbeCss(margins: PageMargins): string {
  const { top, right, bottom, left } = margins;
  if (top === right && right === bottom && bottom === left) return pagePaddingProbeCss(top);
  return (
    `body { padding: ${formatG(top)}mm ${formatG(right)}mm ` +
    `${formatG(bottom)}mm ${formatG(left)}mm !important; }`
  );
}

/**
 * 照片系数探针：写 `:root { --photo-scale: …; }`，与后端 `format_css` 的 `:root` 声明同形。
 *
 * 为什么不是 `body { … }` 规则：照片尺寸由模板写成
 * `calc(var(--fs) * 6.3 * var(--photo-scale, 1))`，系数是**变量**，不是可覆盖的属性——
 * 只有改这个变量才能让"拖动中"和"松手后"是同一套几何。
 *
 * 等于 1 时返回空串（清掉探针）：后端 `photo_scale_css_value` 在 `= 1` 时返回 `None`，
 * 一个字符都不写；探针若写 `--photo-scale: 1;`，虽然视觉等价，但会让"没设过"与
 * "设成 1"在 DOM 上出现差别，属于无意义的漂移。
 */
export function photoScaleProbeCss(scale: number): string {
  const value = Number.isFinite(scale) ? scale : 1;
  if (Math.abs(value - 1) < 1e-9) return "";
  return `:root { --photo-scale: ${formatG(value)}; }`;
}

/**
 * 系数探针：`name_scale` / `section_title_scale` / `entry_gap` 各自写一条 `:root` 声明。
 *
 * 与后端 `resume_layout_overrides.scale_css_vars` **逐字一致**（`:root { --name-scale: 1.1; }`，
 * 数字走 `f"{value:g}"` ↔ `formatG`）。为什么不是 `body { … }` 规则：这三个系数乘在
 * **模板基准**上（`calc(var(--fs) * 1.86 * var(--name-scale, 1))`），只有改变量才能让
 * "拖动中"与"松手后"是同一套几何。
 *
 * ≈1 时返回空串：后端在 1 时一个字符都不写，探针若写 `--name-scale: 1;` 虽然视觉等价，
 * 但会让"没设过"与"设成 1"在 DOM 上出现差别（无意义的漂移）。
 */
export function scaleProbeCss(key: ScaleKey, scale: number): string {
  const cssVar = SCALE_CSS_VARS[key];
  if (!cssVar) return "";
  const value = Number.isFinite(scale) ? scale : DEFAULT_SCALE;
  if (Math.abs(value - DEFAULT_SCALE) < 1e-9) return "";
  return `:root { ${cssVar}: ${formatG(value)}; }`;
}

/**
 * 颜色键 → CSS 变量名。与后端 `FORMAT_FIELDS` 的 `"css"` 字段逐字一致
 * （`resume_template_format.py:41-44`）。
 *
 * 为什么在前端再写一份映射：后端只在目录接口里下发 `format_fields`（含 label），
 * **不含** `css` 变量名——那是渲染内部约定。探针要即时生效就必须知道变量名，
 * 所以这里列一份，并由 `resumeFormatProbe.test.ts` 钉住四个键。
 */
export const COLOR_CSS_VARS: Record<string, string> = {
  accent: "--accent",
  text_color: "--text",
  muted_color: "--muted",
  line_color: "--line",
};

/**
 * 颜色探针：写一条 `:root` 声明，与后端 `format_css` 的 `:root` 同形
 * （`root_parts.append(f"{field['css']}: {value};")`）。
 *
 * 颜色是不可插值的字符串（`#123456`），所以不过 `formatG`：后端也是 `str(value)` 直出。
 * 空值返回空串（清掉探针），与"删键 = 随模板"一致。
 */
export function colorProbeCss(key: string, value: string): string {
  const cssVar = COLOR_CSS_VARS[key];
  const text = value.trim();
  if (!cssVar || !text) return "";
  return `:root { ${cssVar}: ${text}; }`;
}

/**
 * 区块间距探针：`.section { margin-bottom: calc(var(--fs) * 1.3) !important; }`。
 *
 * 与后端 `FORMAT_FIELDS` 的 `section_gap.css_rule` 逐字一致
 * （`resume_template_format.py:90`，数字走 `f"{value:g}"` ↔ `formatG`）。
 * 它和行距/页边距一样是**绝对覆盖**（不是乘在模板基准上的系数），所以走 `body`/选择器规则
 * 而不是 `:root` 变量。
 */
export function sectionGapProbeCss(value: number): string {
  return `.section { margin-bottom: calc(var(--fs) * ${formatG(value)}) !important; }`;
}
