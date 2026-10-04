// ===== ⑩ 招聘网站（当前站点）=====

/**
 * 一个已注册的招聘网站。
 *
 * **前端不写死站点清单**：这里的字段全部来自后端 `GET /api/apply/sites`。以后后端注册表里
 * 多加一个站点，界面自动跟着多出一个选项，前端一行都不用改。
 */
export interface SiteOption {
  key: string;
  display_name: string;
  host: string;
  entry_url: string;
  supports_collect: boolean;
  supports_apply: boolean;
}

export interface SiteList {
  /** 当前选中的站点 key（对应 ApplyConfig.site_key）。 */
  current: string;
  sites: SiteOption[];
}

/** 按 key 找站点展示名；找不到时回退 key 本身，绝不显示空串。 */
export function siteDisplayName(list: SiteList | undefined, key: string): string {
  const found = list?.sites.find((site) => site.key === key);
  return found?.display_name ?? key;
}

// ===== ⑫ 站点健康度（degraded 标记）=====

/**
 * 站点健康度状态：`ok` 正常；`degraded` 疑似改版（采集悄悄抓不到东西）。
 *
 * 判据完全在后端（`app/services/site_health.py`）。前端**只读** `status` 与 `reasons`，
 * 绝不在这里再判一次——否则两处判据迟早漂移。
 */
export type SiteHealthStatus = "ok" | "degraded";

/** 一次采集运行的摘要（供界面展开对照「采集记录」）。 */
export interface CollectRunSummary {
  status: string;
  failure_category: string;
  succeeded: number;
  detail_missing: number;
  created_at: string;
}

export interface SiteHealth {
  site_key: string;
  display_name: string;
  status: SiteHealthStatus;
  /** 人类可读、可操作的中文原因（来自后端）。degraded 时非空。 */
  reasons: string[];
  sampled: number;
  selector_failures: number;
  detail_drift_runs: number;
  recent: CollectRunSummary[];
}

export interface SiteHealthList {
  sites: SiteHealth[];
}

/** 取当前站点的健康度；找不到时回退 undefined（前端不自行判定，只如实展示后端结论）。 */
export function siteHealthFor(
  list: SiteHealthList | undefined,
  siteKey: string,
): SiteHealth | undefined {
  return list?.sites.find((site) => site.site_key === siteKey);
}
