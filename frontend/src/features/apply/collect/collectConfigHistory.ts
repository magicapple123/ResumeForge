// SPDX-License-Identifier: Apache-2.0
/**
 * 采集条件的历史快照（localStorage 持久化）。
 *
 * 存储键 `rf.collect.configHistory` 被 CollectPanel.test.tsx 直接断言，逐字保留。
 */
import { formatDateTime } from "../../../utils/format";
import type { CollectConfig } from "../../../types";
import { t } from "../../../i18n";

export const CONFIG_HISTORY_KEY = "rf.collect.configHistory";

const CONFIG_HISTORY_LIMIT = 20;

/** 一份采集条件的完整快照：保存时间与全部字段。 */
export interface CollectConfigSnapshot {
  savedAt: string;
  config: CollectConfig;
}

/**
 * 历史快照里的站点筛选项：旧版本存的是单个字符串（`{"degree": "203"}`），
 * 新版本是编码数组（问题清单 §15.3-A）。读取时统一归一成数组，旧快照照样能用。
 */
export function normalizeFilterValues(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cleaned: Record<string, string[]> = {};
  for (const [rawKey, rawCodes] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key || rawCodes === null || rawCodes === undefined) continue;
    const items = Array.isArray(rawCodes) ? rawCodes : [rawCodes];
    const codes: string[] = [];
    for (const item of items) {
      const code = item === null || item === undefined ? "" : String(item).trim();
      if (code && !codes.includes(code)) codes.push(code);
    }
    if (codes.length) cleaned[key] = codes;
  }
  return cleaned;
}

/** 读取历史条件；缺省/损坏时回退空数组（旧快照的 filters 会归一成编码数组）。 */
export function readConfigHistory(): CollectConfigSnapshot[] {
  try {
    const raw = localStorage.getItem(CONFIG_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is CollectConfigSnapshot =>
          entry && typeof entry === "object" && "savedAt" in entry && "config" in entry,
      )
      .map((entry) => ({
        ...entry,
        config: { ...entry.config, filters: normalizeFilterValues(entry.config?.filters) },
      }));
  } catch {
    return [];
  }
}

/** 把条件快照写成 localStorage（覆盖写）。 */
export function writeConfigHistory(list: CollectConfigSnapshot[]): void {
  localStorage.setItem(CONFIG_HISTORY_KEY, JSON.stringify(list));
}

/** 历史上限（去重后最多保留这么多条）。 */
export const CONFIG_HISTORY_MAX = CONFIG_HISTORY_LIMIT;

/** 历史下拉的展示文案：保存时间 + 关键词/城市摘要（岗位类型已随「采集后筛选」下线）。 */
export function historySummaryLabel(snapshot: CollectConfigSnapshot): string {
  const { config, savedAt } = snapshot;
  // 在函数执行期取文案：模块作用域求值 t() 会把语言固定在 import 那一刻。
  const keywords = (config.keywords ?? [])
    .slice(0, 3)
    .join(t("applyCollect.history.keywordSeparator"));
  const keywordText = keywords || t("applyCollect.history.noKeywords");
  const cityText = config.city?.trim() || t("applyCollect.history.noCity");
  return `${formatDateTime(savedAt)} · ${keywordText} / ${cityText}`;
}
