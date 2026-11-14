// SPDX-License-Identifier: Apache-2.0
/**
 * 「上下文用量」的纯展示计算（需求 #6）。
 *
 * 单独成文件有两个原因：
 * 1. 这些函数是**纯函数**（输入数字、输出字符串/对象），可以毫秒级单测；
 * 2. 数字缩写与百分比的口径只在这里有一份——弹层、chip、界面文案里的数字必须同源，
 *    否则"chip 26%"与弹层里"25.9%"会被读成两个不同的值。
 *
 * 口径（与后端 `assistant_context_usage.py` 对齐）：
 * - 百分比 = 该值 / 上下文窗口 × 100，保留 1 位；
 * - 窗口为 0（未设置）= **没有分母**，返回 `null` 而不是 0——0% 会被读成"一点都没用"。
 */

import type { ContextUsage } from "../../types";

/** 百分比小数位。与后端一致，改要两边一起改。 */
const PERCENT_DECIMALS = 1;
/**
 * chip 上环形进度的分档阈值（弧与数字**同时**变色）。
 *
 * 导出给测试用：85/95 这两个数字被断言写死，散在组件里改一个就悄悄失效。
 * 100 不是分档线——>100% 仍按 danger 处理，弧只夹到整圈。
 */
export const CONTEXT_WARN_PERCENT = 85;
export const CONTEXT_DANGER_PERCENT = 95;
/** 千分位缩写：259500 → "259.5K"（1000000 也显示 "1000.0K"，不换算成 M）。 */
const THOUSAND = 1000;
/** 精确值的分组格式化：服务商实测 token 不大，直接用千分位更好核对。 */
const GROUPING = "en-US";
/**
 * 「算不出来」的占位符：一个破折号。
 *
 * 它不是文案（任何语言里都是同一个字形），所以不进语言包——放语言包反而会被
 * "英文与中文相同 = 未翻译"的契约守卫判成漏翻。
 */
const NO_PERCENT = "—";

/**
 * 五个桶的图形色槽位（`--rf-cat-1..5`）。
 *
 * 为什么用槽位名而不是"蓝/紫/青"这类具体颜色：深浅主题各有一套取值（见
 * `theme/design-tokens.css` 与 `dark-tokens.css`），组件只认槽位，换配色不用改组件。
 */
export type ContextUsageBucketColor = "cat1" | "cat2" | "cat3" | "cat4" | "cat5";

/** 桶 key → 色槽位。未知 key 落到 cat1（后端新增桶时不至于渲染成透明）。 */
const BUCKET_COLORS: Record<string, ContextUsageBucketColor> = {
  system: "cat1",
  tools: "cat2",
  conversation: "cat3",
  connectors: "cat4",
  skills: "cat5",
};

/** 取某个桶的色槽位；未知 key 用第一档。 */
export function bucketColor(bucketKey: string): ContextUsageBucketColor {
  return BUCKET_COLORS[bucketKey] ?? "cat1";
}

/** 保留 1 位的百分比数值；窗口为 0 时是 `null`。 */
export function percentOf(tokens: number, windowTokens: number): number | null {
  if (!windowTokens || windowTokens <= 0) return null;
  const scale = 10 ** PERCENT_DECIMALS;
  return Math.round((tokens / windowTokens) * 100 * scale) / scale;
}

/** 百分比文本：`25.9%`；没有分母时是 `—`（不显示 0%）。 */
export function formatPercent(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return NO_PERCENT;
  return `${percent.toFixed(PERCENT_DECIMALS)}%`;
}

/** chip 用的整数百分比：`26%`（窄栏只有数字，小数位没有可读性）。 */
export function formatPercentShort(percent: number | null): string {
  if (percent === null || !Number.isFinite(percent)) return NO_PERCENT;
  return `${Math.round(percent)}%`;
}

/** chip 环形的三档：常态 / 提醒 / 危险。值即 CSS 类后缀。 */
export type ContextUsageLevel = "normal" | "warn" | "danger";

/** 按百分比分档；没有分母（null）算常态——空轨道不该是警告色。 */
export function contextUsageLevel(percent: number | null): ContextUsageLevel {
  if (percent === null || !Number.isFinite(percent)) return "normal";
  if (percent >= CONTEXT_DANGER_PERCENT) return "danger";
  if (percent >= CONTEXT_WARN_PERCENT) return "warn";
  return "normal";
}

/**
 * 环形的弧长（0–100），**只夹弧不夹数字**。
 *
 * 数字保留真实值（可以显示 120%，那是真事），弧最多画满一圈。
 */
export function contextArcPercent(percent: number | null): number {
  if (percent === null || !Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

/** 千分位缩写：`259.5K` / `985`。用于「已使用 / 窗口」这类头行。 */
export function formatTokenCount(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safe >= THOUSAND) {
    return `${(safe / THOUSAND).toFixed(1)}K`;
  }
  return String(Math.round(safe));
}

/** 精确分组：`12,345`。用于「上一轮实测输入」——那里要看得出具体数字。 */
export function formatExactTokens(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return Math.round(safe).toLocaleString(GROUPING);
}

/**
 * 五个桶的百分比 + 总百分比，**五桶之和恒等于总百分比**（最大余额法）。
 *
 * 与后端 `assistant_context_usage._consistent_percents` 同一套算法：各自独立
 * `toFixed(1)` 时五个桶的舍入误差最多累积 ±0.25，会让"五行相加 = 顶部总占比"对不上。
 * 这里先把总数定死（同样是 `total / window × 100` 保留 1 位），再把小数余量按余额
 * 大小逐格补给各桶。窗口为 0 时全部是 `null`。
 */
export function distributePercents(
  tokensList: number[],
  windowTokens: number,
): { percents: (number | null)[]; total: number | null } {
  if (!windowTokens || windowTokens <= 0) {
    return { percents: tokensList.map(() => null), total: null };
  }
  const scale = 10 ** PERCENT_DECIMALS;
  const exact = tokensList.map((tokens) => (tokens / windowTokens) * 100);
  const totalUnits = Math.round(exact.reduce((sum, value) => sum + value, 0) * scale);
  const floors = exact.map((value) => Math.floor(value * scale));
  const usedUnits = floors.reduce((sum, value) => sum + value, 0);
  const remainder = Math.min(exact.length, Math.max(0, totalUnits - usedUnits));
  const order = exact
    .map((value, index) => ({ index, fraction: value * scale - floors[index] }))
    .sort((left, right) => right.fraction - left.fraction);
  const units = [...floors];
  for (const item of order.slice(0, remainder)) {
    units[item.index] += 1;
  }
  return {
    percents: units.map((value) => value / scale),
    total: totalUnits / scale,
  };
}

/**
 * 窗口改了之后本地立刻重算一份用量（保存成功后不重新请求，面板当场就对）。
 *
 * 只重算百分比：各桶 tokens 与窗口无关，没必要为了一次设置写入把整份载荷丢掉重取。
 * 用 `distributePercents` 而不是逐桶 `percentOf`，是为了保住"五行相加 = 顶部总占比"。
 */
export function withWindowTokens(usage: ContextUsage, windowTokens: number): ContextUsage {
  const { percents, total } = distributePercents(
    usage.buckets.map((bucket) => bucket.tokens),
    windowTokens,
  );
  return {
    ...usage,
    window: windowTokens,
    window_source: "manual",
    default_trigger_tokens: Math.min(
      Math.round(
        windowTokens *
          ((usage.default_trigger_tokens ?? usage.trigger_tokens ?? usage.window * 0.75) /
            Math.max(1, usage.window)),
      ),
      Math.floor(windowTokens * 0.9),
    ),
    percent: total,
    buckets: usage.buckets.map((bucket, index) => ({ ...bucket, percent: percents[index] })),
  };
}

/**
 * 压缩前后的 token 区间文本：`180.0K → 24.0K`（问题清单 #10）。
 *
 * 为什么放在这里而不是组件里：`formatTokenCount` 的缩写口径只在这一个文件里有一份，
 * 面板与确认弹层两处都要显示同一组数字，分头格式化必然漂移。
 */
export function formatTokenRange(tokensBefore: number, tokensAfter: number): string {
  return `${formatTokenCount(tokensBefore)} → ${formatTokenCount(tokensAfter)}`;
}

/**
 * 压缩省下的比例（0–100 的整数）；没有可省的量时是 0 而不是负数。
 *
 * 用于面板上的「省下 N%」：它是**实测**（tokens_before / tokens_after 都来自落库状态），
 * 与上面那些估算百分比不是一回事，所以单独算而不是复用 `percentOf`。
 */
export function savedPercent(tokensBefore: number, tokensAfter: number): number {
  if (!Number.isFinite(tokensBefore) || tokensBefore <= 0) return 0;
  const safeAfter = Number.isFinite(tokensAfter) ? Math.max(0, tokensAfter) : 0;
  const saved = ((tokensBefore - safeAfter) / tokensBefore) * 100;
  return Math.max(0, Math.round(saved));
}
