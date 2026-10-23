// SPDX-License-Identifier: Apache-2.0
/**
 * 三个"乘在模板基准上"的系数：`name_scale` / `section_title_scale` / `entry_gap`。
 *
 * ## 为什么单独成文件
 *
 * 这三项**不在**后端 `FORMAT_FIELDS` 里（它们不进「自制版式」编辑器，也不参与"导入版式
 * 缺哪些键"的判定），所以目录下发不了它们的区间——区间与步长只能在前端写一次，写在这里，
 * 控件里不许再各自硬编码 min/max（`LineHeightControl` / `PagePaddingControl` 的既有教训：
 * 一处放宽、另一处没跟上，用户就会拖到后端静默丢弃的值，表现为"松手后跳回去"）。
 *
 * ## 语义：乘在模板基准上，1 = 没设过 = 删键
 *
 * 后端 `format_css` 只在 `≠ 1` 时才往 `:root` 写 `--name-scale` 等变量（模板侧写
 * `calc(var(--fs) * 1.86 * var(--name-scale, 1))` 兜底）。所以：
 *
 * - 读：缺键 → `DEFAULT_SCALE`；越界 → 夹紧（与 `pageMargins.clampPageMargin` 同一契约）；
 * - 写：`withScale(config, key, null)` 或写成 1 → **删键**（不写回默认值），
 *   这样以后模板基准调整时这些简历跟着变。
 *
 * 区间与后端 `resume_layout_overrides._SCALE_MIN_MAX` / `SCALE_STEPS` 逐键相等，
 * 两端各钉一次：后端 `tests/test_export_format_config.py`，前端 `resumeScaleParams.test.ts`。
 */
import type { ResumeFormatConfig, ResumeTemplateCatalog } from "../types";

/** 三个系数键。书写顺序就是 `:root` 声明的产出顺序（后端 `SCALE_KEYS_ORDER`）。 */
export const SCALE_KEYS = ["name_scale", "section_title_scale", "entry_gap"] as const;

export type ScaleKey = (typeof SCALE_KEYS)[number];

/** 一个系数的滑杆区间与步长。 */
export interface ScaleBounds {
  min: number;
  max: number;
  step: number;
}

/**
 * 区间与步长的**唯一**来源。
 *
 * 与后端 `_SCALE_MIN_MAX` / `SCALE_STEPS` 逐键相等（`resumeScaleParams.test.ts` 钉住）；
 * 上下限取"还能救回一行、但比例不崩"的那一档，理由见后端那份注释。
 */
export const SCALE_BOUNDS: Record<ScaleKey, ScaleBounds> = {
  name_scale: { min: 0.8, max: 1.3, step: 0.02 },
  section_title_scale: { min: 0.85, max: 1.25, step: 0.02 },
  entry_gap: { min: 0.6, max: 1.8, step: 0.05 },
};

/** CSS 变量名：与后端 `SCALE_CSS_VARS` 和 8 个模板里的字面量逐字一致。 */
export const SCALE_CSS_VARS: Record<ScaleKey, string> = {
  name_scale: "--name-scale",
  section_title_scale: "--section-title-scale",
  entry_gap: "--entry-gap",
};

/** "没设过"的系数值。写成常量而不是各处 `1`，让"缺键 = 不变"只有一个出处。 */
export const DEFAULT_SCALE = 1;

/** 浮点比较容差：滑杆步长 0.02，序列化后可能出现 1.1500000000000001 这样的尾巴。 */
const EPSILON = 1e-9;

/** `section_gap` 的兜底区间：正常情况下取目录 `format_fields` 的值，这里只是旧目录的回落。 */
export const SECTION_GAP_FALLBACK_BOUNDS: ScaleBounds = { min: 0.6, max: 2.2, step: 0.1 };

/** `section_gap` 的兜底默认值（各模板基准 0.85–1.45，缺目录时用经典模板的 1.3）。 */
export const SECTION_GAP_FALLBACK_DEFAULT = 1.3;

/** 三个系数 + 区块间距的键型 → 是不是本模块管的系数键。 */
export function isScaleKey(key: string): key is ScaleKey {
  return (SCALE_KEYS as readonly string[]).includes(key);
}

/**
 * 把系数收进自己的区间（滑杆**夹紧**，与后端"越界丢弃"是同一件事的两侧）。
 *
 * 非有限数按 `DEFAULT_SCALE` 返回：一个 NaN 喂给滑杆会让它整块渲染不出来，
 * 而"这一项没设过"是可接受且可解释的降级。
 */
export function clampScale(key: ScaleKey, value: number): number {
  const { min, max } = SCALE_BOUNDS[key];
  if (!Number.isFinite(value)) return DEFAULT_SCALE;
  return Math.min(max, Math.max(min, value));
}

/** 读某个系数：缺键 / 非数字 → `DEFAULT_SCALE`；越界 → 夹紧。 */
export function resolveScale(
  config: ResumeFormatConfig | Record<string, unknown> | undefined | null,
  key: ScaleKey,
): number {
  const raw = (config as Record<string, unknown> | undefined | null)?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_SCALE;
  return clampScale(key, raw);
}

/**
 * 写某个系数：数值 = 写入（夹紧后落库）；`null` 或 ≈1 = **删键**（回到随模板）。
 *
 * 删键而不是写回 1：存储里"没调过"与"调成 1"应当是同一形态，否则以后模板基准调整时，
 * 这些简历不会跟着变——与行距 / 页边距的"删键即随模板"是同一条语义。
 */
export function withScale(
  config: ResumeFormatConfig | undefined | null,
  key: ScaleKey,
  value: number | null,
): ResumeFormatConfig {
  const next: ResumeFormatConfig = { ...(config ?? {}) };
  if (value === null || Math.abs(value - DEFAULT_SCALE) <= EPSILON) {
    delete next[key];
    return next;
  }
  next[key] = clampScale(key, value);
  return next;
}

/** 用户是否调过某个系数（决定"随模板"胶囊与复位按钮的可用性）。 */
export function isScaleCustomized(
  config: ResumeFormatConfig | undefined | null,
  key: ScaleKey,
): boolean {
  const raw = (config as Record<string, unknown> | undefined | null)?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return false;
  return Math.abs(raw - DEFAULT_SCALE) > EPSILON;
}

/**
 * 读目录里某个 `FORMAT_FIELDS` 数值项的区间（`section_gap` 用）。
 *
 * `section_gap` 是后端已有字段（6 项之一），区间随目录下发——前端再抄一份 0.6/2.2 就是
 * 第二份真相。目录没下发（旧后端）时回落到 `SECTION_GAP_FALLBACK_BOUNDS`。
 */
export function catalogNumberBounds(
  catalog: ResumeTemplateCatalog | undefined,
  key: string,
  fallback: ScaleBounds,
): ScaleBounds {
  const field = catalog?.format_fields?.find((item) => item.key === key);
  if (!field || field.type !== "number") return fallback;
  const min = typeof field.min === "number" ? field.min : fallback.min;
  const max = typeof field.max === "number" ? field.max : fallback.max;
  const step = typeof field.step === "number" ? field.step : fallback.step;
  return { min, max, step };
}

/**
 * 读目录里某个模板的 `section_gap` 基准（"区块间距"滑杆的默认位置）。
 *
 * 各模板基准 0.85–1.45 不等，写死一个数字会让滑杆停在与渲染不同的位置；目录已下发
 * （`templates_routes.py` 的 `template_layouts`），缺失时才回落到 1.3。
 */
export function templateSectionGap(
  catalog: ResumeTemplateCatalog | undefined,
  template: string,
): number {
  const value = catalog?.template_layouts?.[template]?.section_gap;
  return typeof value === "number" ? value : SECTION_GAP_FALLBACK_DEFAULT;
}

/**
 * 把数值规整到「步长网格 + 固定小数位」，避免浮点尾巴漏到读数与落库值里。
 *
 * `0.02` 步长下 `0.8 + 0.02 * 3` 会得到 `0.8600000000000001`；这个值既不该出现在读数里，
 * 也不该进 `format_config`（后端会 round 到 3 位，前端显示就与存下的差一点点）。
 * 小数位由步长推出，所以 0.1 步长的 `section_gap` 也走同一个函数。
 */
export function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
