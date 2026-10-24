// SPDX-License-Identifier: Apache-2.0
/**
 * W07 局部排版（P1-02 / D02 / D03 / D06）的**属性表**：区间、步长、枚举、继承兜底值。
 *
 * ## 为什么单独成文件
 *
 * 与 `utils/resumeScaleParams.ts` 同一定位：控件里不许再各自硬编码 min/max/step。
 * 一处放宽、另一处没跟上，用户就会拖到后端静默丢弃的值，表现为"松手后跳回去"。
 *
 * ## 与后端的关系（唯一真相在后端）
 *
 * 区间与步长必须与后端 `services/resume/resume_style_schema.py` 的 `PROP_BOUNDS` /
 * `STYLE_PROPS` **逐键相等**（wave2 契约 §2.2 / §2.5）。后端 W07-BE 落地后由
 * `resumeStyleParams.test.ts` 与后端测试各钉一份字面量表、注释互指（与
 * `_SCALE_MIN_MAX` / `SCALE_BOUNDS` 同一既有做法）。
 *
 * ## 单位：内部值就是契约值，不在这里做换算
 *
 * `font_scale` / `space_before` / `space_after` / `indent` / `letter_spacing` 都是
 * **乘在字号基准上的系数**（展示为 `×`），`line_height` 是倍数。字号控件要显示 pt
 * 对照时，只能由调用方传 `base_px` 走 `ptComparison()` **显示**，落库值一个字都不换。
 */
import type { MessageKey } from "../i18n";

/** 12 个可覆盖属性（与后端 `STYLE_PROPS` 的键逐字相等）。 */
export type StylePropKey =
  | "font_scale"
  | "color"
  | "bold"
  | "italic"
  | "space_before"
  | "space_after"
  | "line_height"
  | "indent"
  | "bullet"
  | "align"
  | "meta_align"
  | "letter_spacing";

/** 数值属性的键（其余是颜色 / 布尔 / 枚举）。 */
export type StyleNumberPropKey =
  "font_scale" | "space_before" | "space_after" | "line_height" | "indent" | "letter_spacing";

export type StylePropKind = "number" | "color" | "bool" | "enum";

export interface StyleNumberBounds {
  min: number;
  max: number;
  step: number;
}

/** 属性的控件形态（数值走 InputNumber + 滑杆，其余走取色 / 开关 / 下拉）。 */
export const STYLE_PROP_KINDS: Record<StylePropKey, StylePropKind> = {
  font_scale: "number",
  color: "color",
  bold: "bool",
  italic: "bool",
  space_before: "number",
  space_after: "number",
  line_height: "number",
  indent: "number",
  bullet: "enum",
  align: "enum",
  meta_align: "enum",
  letter_spacing: "number",
};

/**
 * 区间与步长的**唯一**来源（与后端 `PROP_BOUNDS` 逐键相等）。
 *
 * 越界值在后端是**丢弃该属性**（不夹紧），所以控件必须在入口夹紧——否则会出现
 * "滑杆停在 3.2、后端存的是没有这个键"的假象。
 */
export const STYLE_PROP_BOUNDS: Record<StyleNumberPropKey, StyleNumberBounds> = {
  font_scale: { min: 0.7, max: 2.4, step: 0.02 },
  space_before: { min: 0, max: 3, step: 0.05 },
  space_after: { min: 0, max: 3, step: 0.05 },
  line_height: { min: 1, max: 2.6, step: 0.01 },
  indent: { min: 0, max: 4, step: 0.05 },
  letter_spacing: { min: -0.1, max: 0.3, step: 0.01 },
};

/** 枚举属性的可选值 + 词条键（值就是落库字面量，顺序即界面顺序）。 */
export const STYLE_ENUM_OPTIONS: Partial<
  Record<StylePropKey, readonly { value: string; labelKey: MessageKey }[]>
> = {
  bullet: [
    { value: "dot", labelKey: "typography.enum.bullet.dot" },
    { value: "dash", labelKey: "typography.enum.bullet.dash" },
    { value: "none", labelKey: "typography.enum.bullet.none" },
  ],
  align: [
    { value: "left", labelKey: "typography.enum.align.left" },
    { value: "center", labelKey: "typography.enum.align.center" },
    { value: "right", labelKey: "typography.enum.align.right" },
    { value: "justify", labelKey: "typography.enum.align.justify" },
  ],
  meta_align: [
    { value: "right", labelKey: "typography.enum.metaAlign.right" },
    { value: "inline", labelKey: "typography.enum.metaAlign.inline" },
  ],
};

/** 属性的界面名（角色面板 / 对象面板 / 格式刷共用同一份词条键）。 */
export const STYLE_PROP_LABELS: Record<StylePropKey, MessageKey> = {
  font_scale: "typography.prop.font_scale",
  color: "typography.prop.color",
  bold: "typography.prop.bold",
  italic: "typography.prop.italic",
  space_before: "typography.prop.space_before",
  space_after: "typography.prop.space_after",
  line_height: "typography.prop.line_height",
  indent: "typography.prop.indent",
  bullet: "typography.prop.bullet",
  align: "typography.prop.align",
  meta_align: "typography.prop.meta_align",
  letter_spacing: "typography.prop.letter_spacing",
};

/**
 * 继承值的兜底表：**只用于滑杆/开关的停靠位置**，不代表模板真实值。
 *
 * 真实值来自目录 `template_role_defaults`（后端 W07-BE 下发）。旧后端没有这一项时
 * 控件仍要能画出来，所以这里给一组中性值；来源胶囊仍显示"来自模板"，不会把兜底值
 * 说成模板值。
 */
export const STYLE_PROP_FALLBACKS: Partial<Record<StylePropKey, number | string | boolean>> = {
  font_scale: 1,
  bold: false,
  italic: false,
  space_before: 0,
  space_after: 0,
  line_height: 1.7,
  indent: 0,
  bullet: "dot",
  align: "left",
  meta_align: "right",
  letter_spacing: 0,
};

/** 合法十六进制颜色（与后端 `_HEX_COLOR_RE` 同宽：3 位或 6 位）。 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** 浮点尾巴的容差：0.02 步长下 0.8 + 0.02 * 3 = 0.8600000000000001。 */
const EPSILON = 1e-9;

/** 规整到「步长网格 + 固定小数位」，避免浮点尾巴漏到读数与落库值里。 */
export function roundToStyleStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !(step > 0)) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - EPSILON));
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * 四位小数规整：**只给 `font_scale` 用**。
 *
 * 角色字号存的是"乘在模板基准上的系数"（后端语义），而面板显示的是"系数 × 基准"的
 * 两位小数比例——若系数也按 0.02 步长落库（1.88/1.86 → 1.01），显示会跳成
 * 1.86*1.01=1.88 附近却回不到用户刚拖到的值。系数按四位小数存，显示与存量都能对上。
 */
export function roundStyleCoefficient(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

export function isNumberStyleProp(prop: StylePropKey): prop is StyleNumberPropKey {
  return STYLE_PROP_KINDS[prop] === "number";
}

/** 数值属性的步长（非数值属性返回 0）。 */
export function styleNumberStep(prop: StylePropKey): number {
  return isNumberStyleProp(prop) ? STYLE_PROP_BOUNDS[prop].step : 0;
}

function enumValue(prop: StylePropKey, raw: unknown): string | null {
  const options = STYLE_ENUM_OPTIONS[prop] ?? [];
  return options.some((option) => option.value === raw) ? (raw as string) : null;
}

/**
 * **写入路径**的取值归一：数值越界**夹紧**并落到步长网格；类型不对返回 `null`。
 *
 * 与后端同一口径：后端越界丢弃，前端在写入口就夹紧，用户不会看到"松手后跳回去"。
 */
export function coerceStylePropValue(
  prop: StylePropKey,
  raw: unknown,
): number | string | boolean | null {
  const kind = STYLE_PROP_KINDS[prop];
  if (kind === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    const bounds = STYLE_PROP_BOUNDS[prop as StyleNumberPropKey];
    const clamped = Math.min(bounds.max, Math.max(bounds.min, raw));
    // font_scale 是派生系数（显示值 = 系数 × 模板基准），按四位小数存；其余按步长网格。
    return prop === "font_scale"
      ? roundStyleCoefficient(clamped)
      : roundToStyleStep(clamped, bounds.step);
  }
  if (kind === "color") return isHexColor(raw) ? raw.toLowerCase() : null;
  if (kind === "bool") return typeof raw === "boolean" ? raw : null;
  return enumValue(prop, raw);
}

/**
 * **读取路径**的属性值：越界 / 类型不对返回 `null`（当作未设置）。
 *
 * 与 `coerceStylePropValue` 的分工：写入口用 coerce（夹紧后落库），读取路径用本函数
 * （越界**丢弃**，与后端 `validated_format_config` 的"越界丢弃"同口径——不能把库里
 * 一个 99 读成 2.6 再显示成"已调整"）。
 */
export function readStylePropValue(
  prop: StylePropKey,
  raw: unknown,
): number | string | boolean | null {
  const kind = STYLE_PROP_KINDS[prop];
  if (kind === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    const bounds = STYLE_PROP_BOUNDS[prop as StyleNumberPropKey];
    if (raw < bounds.min - EPSILON || raw > bounds.max + EPSILON) return null;
    return prop === "font_scale" ? roundStyleCoefficient(raw) : roundToStyleStep(raw, bounds.step);
  }
  if (kind === "color") return isHexColor(raw) ? raw.toLowerCase() : null;
  if (kind === "bool") return typeof raw === "boolean" ? raw : null;
  return enumValue(prop, raw);
}

/** 这一条显式覆盖里是否设过某个属性（设过且值合法）。 */
export function isStylePropSet(
  style: Readonly<Record<string, unknown>> | undefined,
  prop: StylePropKey,
): boolean {
  if (!style || !(prop in style)) return false;
  return readStylePropValue(prop, style[prop]) !== null;
}

/** 一条覆盖是否为空（三个域都靠它决定"键要不要落库"，契约 §1.2 R3）。 */
export function styleIsEmpty(style: Readonly<Record<string, unknown>> | undefined): boolean {
  if (!style) return true;
  return !Object.keys(style).some((key) => isStylePropSet(style, key as StylePropKey));
}

/** 数值属性的读数格式：系数带 `×`，行距是裸倍数。 */
export function formatStyleNumber(prop: StylePropKey, value: number): string {
  if (prop === "line_height") return Number(value.toFixed(2)).toString();
  return `${Number(value.toFixed(2))}×`;
}

/**
 * 字号比例的 **pt 对照读数**（只用于显示）：CSS `1px = 0.75pt`。
 *
 * 内部契约单位是"乘在模板基准上的系数"，不做静默换算；这里返回的是给用户看的近似值，
 * 调用方必须把"约"字带上（词条 `typography.value.pt`）。
 */
export function ptComparison(fontScale: number, basePx: number): number {
  if (!Number.isFinite(fontScale) || !Number.isFinite(basePx)) return 0;
  return Math.round(fontScale * basePx * 0.75 * 10) / 10;
}
