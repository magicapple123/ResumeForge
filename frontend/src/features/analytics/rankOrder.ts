// SPDX-License-Identifier: Apache-2.0
/**
 * 统计页三块榜单的**本地排序**（R13）：投递数 / 面试率 / 名称，三选一。
 *
 * ## 为什么不改后端
 *
 * 这三块榜单是"一次聚合、整块返回"的数组（`channel_stats` / `company_repeats` /
 * `resume_effects`），没有分页。整块数据都在手里，排序就是一次内存排序——下推服务端只会
 * 多一个参数、多一次请求，还要在每个聚合 SQL 里各写一遍 ORDER BY，改动半径远大于收益。
 *
 * ## 为什么口径要与简历中心的 `groupSortState` 一致
 *
 * 同一个产品里两处排序必须"看起来是同一套规则"，否则用户会学到两套直觉：主键按所选字段、
 * **方向只作用于主键**，等值时统一走固定的次序键（这里 = 名称，简历中心 = 最近更新 → id）。
 * 方向不参与次序键，所以同分的一批在切换排序时不会整片倒过来。
 *
 * ## 「柱长与数值跟着排序字段走」
 *
 * 榜单里的柱子曾经恒等于投递数：按面试率排序时，柱子长短与排序无关，读起来像"排序没生效"。
 * 现在柱长与右侧数值都取 :func:`barValueOf`——按面试率排时它们是百分比，**0% 就是 0**，
 * 而 `HorizontalBarChart` 只在 `count > 0` 时画彩色条，所以 0% 不会出现一根假柱子。
 */
import type { MessageKey } from "../../i18n";

/** 排序字段：投递数 / 面试率 / 名称。 */
export type RankMetric = "applications" | "interviewRate" | "name";

/** 控件顺序即数组顺序：**默认第一项**必须是投递数（改造前后端给的就是按投递数降序）。 */
export const RANK_METRICS: readonly RankMetric[] = ["applications", "interviewRate", "name"];

export const DEFAULT_RANK_METRIC: RankMetric = "applications";

/** 三段控件与读屏文案共用这张表。 */
export const RANK_METRIC_LABEL_KEYS: Record<RankMetric, MessageKey> = {
  applications: "analyticsPage.rank.applications",
  interviewRate: "analyticsPage.rank.interviewRate",
  name: "analyticsPage.rank.name",
};

/** 排序与画图只需要这三个字段：结构化类型，`utils` 不反向依赖 `types/analytics`。 */
export interface RankInput {
  /** 显示名（公司名 / 渠道名 / 简历标题），也是名称排序与平局次序键的依据。 */
  name: string;
  total: number;
  interviewCount: number;
}

/** 面试率（0–1）。总数为 0 时算 0：不产生 `NaN`，也不会让排序退化成随机。 */
export function interviewRateOf(row: RankInput): number {
  return row.total > 0 ? row.interviewCount / row.total : 0;
}

/** 柱长与右侧数值：投递数 / 面试率百分比 / （按名称排时仍是投递数）。 */
export function barValueOf(row: RankInput, metric: RankMetric): number {
  return metric === "interviewRate" ? Math.round(interviewRateOf(row) * 100) : row.total;
}

/** 右侧数值的单位：只有面试率带百分号（缺省不写 `%`，否则"12 次投递"会变成"12 %"）。 */
export function barSuffixOf(metric: RankMetric): string | undefined {
  return metric === "interviewRate" ? "%" : undefined;
}

function compareName(left: string, right: string): number {
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}

function comparePrimary(left: RankInput, right: RankInput, metric: RankMetric): number {
  if (metric === "name") return compareName(left.name, right.name);
  if (metric === "interviewRate") return interviewRateOf(right) - interviewRateOf(left);
  return right.total - left.total;
}

/**
 * 排序（不改入参，返回新数组）。
 *
 * 主键按 `metric` 的语义方向（投递数/面试率降序、名称升序），等值时按名称升序，
 * 名称也相同时保留原次序（`index`）——**稳定的定义**在这里：同一份数据反复排，
 * 或者从投递数切到名称再切回来，看到的都是同一条次序。
 */
export function sortRanked<T>(
  items: readonly T[],
  read: (item: T) => RankInput,
  metric: RankMetric,
): T[] {
  return items
    .map((item, index) => ({ item, index, key: read(item) }))
    .sort((left, right) => {
      const primary = comparePrimary(left.key, right.key, metric);
      if (primary !== 0) return primary;
      const byName = compareName(left.key.name, right.key.name);
      if (byName !== 0) return byName;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}
