/**
 * 采集批次的 task.config 账目纯函数：把后端写进 `task.config` 的筛选账目解析为界面文案。
 *
 * 这些函数不碰网络、不碰状态——「后端记的账」与「界面怎么摆出来」之间的唯一转换层。
 */
import type { ApplyTaskDetail } from "../../../types";

export function unmappedConditions(task: ApplyTaskDetail | null): string[] {
  const raw = task?.config?.unmapped_conditions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export interface FilterSummary {
  /** 按条件明确筛掉的条数。 */
  filtered: number;
  /** 这次实际启用的本地筛选条件。 */
  applied: string[];
  /** 有岗位缺字段、没能判断的条件（那些岗位已保留）。 */
  undecided: string[];
  undecidedCount: number;
  /** 用户填了但没能识别的条件——**必须明说**，否则等于静默失效。 */
  unapplied: string[];
}

/** 从批次 config 里读出本地筛选的账目（后端写在 task.config，不新增数据库列）。 */
export function filterSummary(task: ApplyTaskDetail | null): FilterSummary | null {
  const config = task?.config;
  if (!config) return null;
  const applied = stringList(config.filter_applied);
  if (applied.length === 0) return null;
  return {
    filtered: Number(config.filtered_out) || 0,
    applied,
    undecided: stringList(config.filter_undecided),
    undecidedCount: Number(config.filter_undecided_count) || 0,
    unapplied: stringList(config.filter_unapplied),
  };
}

export interface SiteFilterSummary {
  /** 这次真正生效的站点筛选条件（形如「学历要求：本科」）。 */
  applied: string[];
  /** 选了、但没能生效的——**必须说出来**，否则用户以为筛过了。 */
  unapplied: string[];
}

/**
 * 站点侧筛选的账目。
 *
 * 后端把「哪几条生效 / 哪几条没生效」写进了 `task.config`，这里只是把它摆到用户眼前。
 * **不显示就等于没记账**：用户选了「公司规模：1000人以上」却拿到各种规模的岗位时，
 * 这句话是唯一的解释来源。
 */
export function siteFilterSummary(task: ApplyTaskDetail | null): SiteFilterSummary | null {
  const config = task?.config;
  if (!config) return null;
  const applied = stringList(config.site_filter_applied);
  const unapplied = stringList(config.site_filter_unapplied);
  if (applied.length === 0 && unapplied.length === 0) return null;
  return { applied, unapplied };
}
