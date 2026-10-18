/**
 * 无级字号：绝对像素 ←→「档位 + `font_scale_adjust` 系数」的映射（纯函数，便于单测）。
 *
 * **为什么复用 `font_scale_adjust` 而不是新增一个"字号像素"字段**：它本来就是
 * `format_config` 里的标准字段，HTML 与 PDF 渲染时都会把所选档位的基准字号乘上它
 * （见 `services/exporter.py` 与 `pdf_exporter/`，同一个乘数）。复用它可以做到
 * **不改数据库列、不改 Pydantic 枚举、已有简历零迁移**；而且预览 / 浏览器打印 /
 * 直出 PDF 天然走同一条乘数路径——"同一口径"这正是我们反复修过的那类 bug 的防线。
 * 自动一页也已经在用这个字段生成候选阶梯，所以滑块与它共用同一份语义。
 *
 * **映射语义**：滑块给的是**绝对字号**（5px ~ 最大档位基准像素）；提交时落到**最近的
 * 档位**，再用系数补齐与档位基准之间的差。于是后端与数据库仍然只是"枚举档位 + 一个系数"，
 * 不需要新增列或枚举值。相邻档位之间的间距由系数吸收：往上最大约 ×1.083（标准档
 * 14→15.5），往下**可以一直到 5/11 ≈ 0.455**（最小档基准 11px 时拖到 5px）——
 * 因此后端 `font_scale_adjust` 的字段下限已经从 0.88 放宽到 0.35，与 `ADJUST_MIN` 对齐。
 */
import type { ResumeFontScale, ResumeFontScaleOption, ResumeLayout } from "../types";
import type { ResumeFormatConfig } from "../types/resumeFormat";

/** `format_config` 里字号系数的键，与后端 `FORMAT_FIELDS` 一致。 */
export const FONT_SCALE_ADJUST_KEY = "font_scale_adjust";

/**
 * 滑块能拖到的最小绝对字号（px）。
 *
 * 5px 是"再小就没有打印意义"的界线，而不是"刚好还行"：A4 打印下 5px 约等于 3.75pt。
 * 之所以敢放到这么小，是因为下半段有**显式提示**（< 8px 时读数旁出现警告），
 * 而不是靠滑块拦着——用户偶尔确实需要把某一版压进一页，但必须知道代价。
 *
 * 由此推出的系数下限是 5/11 ≈ 0.455（最小档基准 11px），后端 `font_scale_adjust`
 * 的字段 min 已同步放宽到 0.35，所以拖到底也不会被 `validated_format_config` 丢掉。
 */
export const MIN_FONT_PX = 5;

/**
 * 低于这个字号就在读数旁提示"打印可能看不清"。
 *
 * 8px ≈ 6pt：这是屏幕上"还看得清"与"打印出来会糊"之间比较公认的分界。提示而不禁用，
 * 理由同上——这是用户自己的判断题，我们的责任是把代价说清楚。
 */
export const SMALL_FONT_WARNING_PX = 8;

/**
 * 后端下发的档位缺 `base_px`（旧目录 / 契约漂移）时的兜底，与后端 `FONT_SCALES` 对齐。
 *
 * 兜底只为"别让控件崩"，**不代表可以静默**：`fontTiers` 一旦真的用到这里（目录里
 * 有档位、却一个合法 `base_px` 都没有）就会 `console.warn`。否则前端的 12/14/15.5
 * 就成了与后端 `FONT_SCALES` 并存的第二份真相，改档位时两边会悄悄分叉。
 */
const FALLBACK_TIERS: FontTier[] = [
  { name: "small", basePx: 11.0, label: "小字号" },
  { name: "standard", basePx: 14.0, label: "标准字号" },
  { name: "large", basePx: 18.0, label: "大字号" },
];
const DEFAULT_TIER: ResumeFontScale = "standard";

/**
 * 系数安全区间，镜像后端 `FORMAT_FIELDS` 的 `font_scale_adjust` min/max。
 *
 * `ADJUST_MIN` 已从 0.88 放宽到 0.35：滑块最左端是 5px，最小档基准 11px 时系数是
 * 5/11 ≈ 0.455；留 0.35 的余量是为了"档位表被别人改小"时仍不越界。取整后的系数只要
 * 落在后端范围内就不会被 `validated_format_config` **静默丢弃**——那个函数对越界数值
 * 是直接跳过（等于悄悄丢掉用户的设置），所以这边必须先夹住。
 */
const ADJUST_MIN = 0.35;
const ADJUST_MAX = 1.16;

export interface FontTier {
  name: ResumeFontScale;
  basePx: number;
  label: string;
}

/** 把后端下发的档位整理成按基准像素升序的档位表；缺 `base_px` 时退回内置三档并告警。 */
export function fontTiers(options: ResumeFontScaleOption[] = []): FontTier[] {
  const tiers = options
    .filter((option) => Number.isFinite(option.base_px) && option.base_px > 0)
    .map((option) => ({ name: option.name, basePx: Number(option.base_px), label: option.label }));
  if (tiers.length > 0) return [...tiers].sort((a, b) => a.basePx - b.basePx);
  // 目录里已有档位、却一个合法 `base_px` 都没有：这是后端字段缺失的信号（契约漂移），
  // 退回内置三档只为"别崩"，但**不能静默**——`console.warn` 把它顶到台面上。
  // 注意：目录尚未加载时这里是空数组（正常态），不告警，否则每次首屏渲染都会刷屏。
  if (options.length > 0) {
    console.warn(
      "[resumeFontScale] 后端下发的字号档位缺少可用的 base_px，已退回内置默认值；" +
        "请确认 GET /api/resumes/templates 的 font_scales 是否包含 base_px。",
    );
  }
  return FALLBACK_TIERS;
}

/** 滑块的可选范围：**最小 5px**（可打印性下限），最大取所有档位基准像素的最大值。 */
export function fontPxBounds(tiers: FontTier[]): { min: number; max: number } {
  const list = tiers.length > 0 ? tiers : FALLBACK_TIERS;
  return { min: MIN_FONT_PX, max: list[list.length - 1].basePx };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readAdjust(formatConfig: ResumeLayout["format_config"]): number | undefined {
  const raw = formatConfig?.[FONT_SCALE_ADJUST_KEY];
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 按名字取档位；名字未知时退回默认档，再退回第一个。 */
export function tierByName(tiers: FontTier[], name: ResumeFontScale): FontTier {
  const list = tiers.length > 0 ? tiers : FALLBACK_TIERS;
  return (
    list.find((tier) => tier.name === name) ?? list.find((t) => t.name === DEFAULT_TIER) ?? list[0]
  );
}

/** 当前 layout 实际对应的绝对字号（px）：档位基准 × 系数。 */
export function layoutToFontPx(layout: ResumeLayout, tiers: FontTier[]): number {
  const tier = tierByName(tiers, layout.font_scale);
  return round(tier.basePx * (readAdjust(layout.format_config) ?? 1), 2);
}

function nearestTier(px: number, tiers: FontTier[]): FontTier {
  return tiers.reduce(
    (best, tier) => (Math.abs(px - tier.basePx) < Math.abs(px - best.basePx) ? tier : best),
    tiers[0],
  );
}

/**
 * 把滑块的绝对 px 映射成新的 layout：**最近档位 + 系数**。
 *
 * 系数恰好为 1 时不写这个键（而不是写 1.0）：否则每份简历都会多出一条无意义的覆盖，
 * 且"恢复默认"和"恰好落在档位上"会留下不同的存储形态。保留其它覆盖（强调色等）。
 */
export function layoutForFontPx(layout: ResumeLayout, px: number, tiers: FontTier[]): ResumeLayout {
  const list = tiers.length > 0 ? tiers : FALLBACK_TIERS;
  const bounds = fontPxBounds(list);
  const clampedPx = round(Math.min(bounds.max, Math.max(bounds.min, px)), 2);
  const tier = nearestTier(clampedPx, list);
  const coefficient = round(Math.min(ADJUST_MAX, Math.max(ADJUST_MIN, clampedPx / tier.basePx)), 3);
  return {
    ...layout,
    font_scale: tier.name,
    format_config: withFontAdjust(layout.format_config, coefficient),
  };
}

/** 写入（或清除）字号系数，保留 `format_config` 里的其它覆盖。 */
export function withFontAdjust(
  formatConfig: ResumeLayout["format_config"],
  coefficient: number,
): ResumeFormatConfig {
  const next: ResumeFormatConfig = { ...(formatConfig ?? {}) };
  if (Math.abs(coefficient - 1) < 1e-6) delete next[FONT_SCALE_ADJUST_KEY];
  else next[FONT_SCALE_ADJUST_KEY] = coefficient;
  return next;
}

/**
 * 拖动过程中的即时反馈 CSS。
 *
 * 与模板里 `--fs` 的写法（`calc({{ base_px }}px * var(--fit-scale, 1))`）**逐字一致**，
 * 只把基准像素换成拖动值：这样无论浏览器如何解析 `var(--fit-scale)`，探针看到的缩放关系
 * 都和"真按这个字号重新渲染"完全一样——中间态因此不会与最终态不一致地跳动。
 */
export function fontProbeCss(px: number): string {
  return `:root { --fs: calc(${round(px, 2)}px * var(--fit-scale, 1)); }`;
}
