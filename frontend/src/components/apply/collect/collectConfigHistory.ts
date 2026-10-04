/**
 * 采集条件的历史快照（localStorage 持久化）。
 *
 * 存储键 `rf.collect.configHistory` 被 CollectPanel.test.tsx 直接断言，逐字保留。
 */
import { formatDateTime } from "../../../utils/format";
import type { CollectConfig } from "../../../types";

export const CONFIG_HISTORY_KEY = "rf.collect.configHistory";

const CONFIG_HISTORY_LIMIT = 20;

/** 一份采集条件的完整快照：保存时间与全部字段。 */
export interface CollectConfigSnapshot {
  savedAt: string;
  config: CollectConfig;
}

/** 读取历史条件；缺省/损坏时回退空数组。 */
export function readConfigHistory(): CollectConfigSnapshot[] {
  try {
    const raw = localStorage.getItem(CONFIG_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is CollectConfigSnapshot =>
        entry && typeof entry === "object" && "savedAt" in entry && "config" in entry,
    );
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

/** 历史下拉的展示文案：保存时间 + 关键词/城市/类型摘要。 */
export function historySummaryLabel(snapshot: CollectConfigSnapshot): string {
  const { config, savedAt } = snapshot;
  const keywords = (config.keywords ?? []).slice(0, 3).join("、");
  const keywordText = keywords || "无关键词";
  const cityText = config.city?.trim() || "无城市";
  const typeText = config.job_type?.trim() || "不限";
  return `${formatDateTime(savedAt)} · ${keywordText} / ${cityText} / ${typeText}`;
}
