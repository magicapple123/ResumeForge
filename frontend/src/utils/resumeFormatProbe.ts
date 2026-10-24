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

// ── W07 局部排版：角色 / 对象覆盖的探针（D02 的直接反馈）────────────────────

/** 探针作用目标：角色（同类段落）或对象（单条内容）。 */
export interface StyleProbeTarget {
  /** 角色名（`name` / `body` …）；与后端模板里的 `data-role` 同名。 */
  role?: string;
  /** 条目稳定 id（W00/W01 的 `document_identity` 形状）。 */
  objectId?: string;
}

/** 探针可接受的属性值（未设过的键不出现，空对象 → 空串）。 */
export type StyleProbeValues = Partial<Record<string, number | string | boolean>>;

/** 探针选项：角色字号需要模板基准比例（后端语义是"系数 × 基准"）。 */
export interface StyleProbeOptions {
  /** 角色 → 模板基准比例（目录 `template_role_defaults[template][role].font_scale`）。 */
  baseRatios?: Partial<Record<string, number>>;
}

/** 声明顺序与后端 `resume_style_schema.STYLE_PROPS` 一致（属性面板行序同源）。 */
const PROBE_PROP_ORDER = [
  "font_scale",
  "color",
  "bold",
  "italic",
  "space_before",
  "space_after",
  "line_height",
  "indent",
  "bullet",
  "align",
  "meta_align",
  "letter_spacing",
] as const;

/** 对象 id 只允许稳定身份字符集：探针 CSS 的字符串里不接受任意用户输入。 */
const PROBE_OBJECT_ID = /^[A-Za-z0-9_-]{8,32}$/;

/** 给探针选一个选择器；对象优先于角色（对象覆盖在角色之上）。 */
function styleProbeSelector(target: StyleProbeTarget): string | null {
  if (target.objectId) {
    return PROBE_OBJECT_ID.test(target.objectId) ? `[data-object-id="${target.objectId}"]` : null;
  }
  if (target.role) {
    return /^[a-z_]+$/.test(target.role) ? `[data-role="${target.role}"]` : null;
  }
  return null;
}

/** 单个属性 → 一条 CSS 声明；不支持 / 值非法时返回 `null`（不产生半条规则）。 */
function styleDeclaration(
  prop: string,
  value: number | string | boolean,
  target: StyleProbeTarget,
  options: StyleProbeOptions,
): string | null {
  if (typeof value === "boolean") {
    if (prop === "bold") return `font-weight: ${value ? 700 : 400}`;
    if (prop === "italic") return `font-style: ${value ? "italic" : "normal"}`;
    return null;
  }
  if (prop === "color") {
    const text = String(value).trim();
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text) ? `color: ${text}` : null;
  }
  if (prop === "font_scale") {
    // 后端语义（resume_style._role_rule）：calc(var(--fs) * 系数 * 基准)。
    // 面板传入的是**显示值**（系数 × 基准），所以这里除回系数再保留两层结构。
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const base = target.role ? options.baseRatios?.[target.role] : target.objectId ? 1 : undefined;
    if (typeof base === "number" && Number.isFinite(base) && base > 0) {
      return `font-size: calc(var(--fs) * ${formatG(value / base)} * ${formatG(base)})`;
    }
    // 目录没给基准（旧后端）：退回数值等价形式，拖动中看到的字号仍然正确。
    return `font-size: calc(var(--fs) * ${formatG(value)})`;
  }
  if (prop === "bullet") {
    // 与后端 \`_role_rule\` 的 bullet_css 逐字一致。
    if (value === "dot") return "list-style-type: disc";
    if (value === "dash") return "list-style-type: '–'";
    if (value === "none") return "list-style-type: none";
    return null;
  }
  if (prop === "align") {
    return ["left", "center", "right", "justify"].includes(String(value))
      ? `text-align: ${value}`
      : null;
  }
  if (prop === "meta_align") {
    // 后端：right → space-between，inline → flex-start（逐字一致）。
    if (value === "right") return "justify-content: space-between";
    if (value === "inline") return "justify-content: flex-start";
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (prop === "space_before") return `margin-top: calc(var(--fs) * ${formatG(value)})`;
  if (prop === "space_after") return `margin-bottom: calc(var(--fs) * ${formatG(value)})`;
  if (prop === "line_height") return `line-height: ${formatG(value)}`;
  if (prop === "indent") return `padding-left: calc(var(--fs) * ${formatG(value)})`;
  if (prop === "letter_spacing") return `letter-spacing: calc(var(--fs) * ${formatG(value)})`;
  return null;
}

/**
 * 局部排版的即时探针 CSS：拖动滑杆/步进时注入预览 iframe，零网络往返。
 *
 * 空覆盖 / 非法目标 → 空串（调用方据此清掉探针）。每条规则都带 `!important`：探针要
 * 盖过模板自己的角色尺寸，否则拖了没反应。
 *
 * **它不是渲染契约**：落库后的真实渲染由后端 `role_style_css` / `format_css` 决定
 * （wave2 契约 §2.5 的唯一实现）。两者数值等价，同一条值在"拖动中"与"松手后"看到的
 * 几何一致；差异只在 CSS 写法的细节（选择器与声明顺序），值本身不做二次换算。
 */
export function styleProbeCss(
  target: StyleProbeTarget,
  style: StyleProbeValues,
  options: StyleProbeOptions = {},
): string {
  const selector = styleProbeSelector(target);
  if (!selector) return "";
  const declarations: string[] = [];
  for (const prop of PROBE_PROP_ORDER) {
    const value = style[prop];
    if (value === undefined) continue;
    const declaration = styleDeclaration(prop, value, target, options);
    if (declaration) declarations.push(`${declaration} !important;`);
  }
  if (declarations.length === 0) return "";
  // 两空格缩进与后端 role_style_css 的规则行一致（探针与真实 CSS 更容易对照）。
  return `  ${selector} { ${declarations.join(" ")} }`;
}

/**
 * 一段文字里"斜体 / 链接"标记在各格式上的能力（机器可读）。
 *
 * 放在探针文件里而不是控件里：这句话是跨格式事实（PDF 没有真斜体、Word 有），
 * 界面在角色面板底部与格式刷旁边引用同一份，避免两处各写一套"支持情况"。
 */
export const INLINE_MARK_CAPABILITY = {
  italic: { html: "full", pdf: "approximate", word: "full" },
  link: { html: "full", pdf: "text-only", word: "full" },
} as const;
