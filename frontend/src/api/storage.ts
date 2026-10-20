// SPDX-License-Identifier: Apache-2.0
/** 存储占用与手动备份接口（RF-25）。 */
import { request } from "./client";

export interface StorageStatsItem {
  key: string;
  label: string;
  size_bytes: number;
  file_count: number;
}

export interface StorageStats {
  data_dir: string;
  items: StorageStatsItem[];
  total_bytes: number;
  total_file_count: number;
}

export interface ManualBackupItem {
  name: string;
  size_bytes: number;
  modified_at: number;
}

export interface ManualBackups {
  directory: string;
  items: ManualBackupItem[];
  trashed_count: number;
}

export function getStorageStats(): Promise<StorageStats> {
  return request("/stats/storage");
}

export function listManualBackups(): Promise<ManualBackups> {
  return request("/backups/manual");
}

/** 可恢复删除：服务端把它移进 backups/.trash/，不永久删除。 */
export function trashManualBackup(name: string): Promise<{ name: string; trash_path: string }> {
  return request(`/backups/manual/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/** 清理类别（R19）：后端 `cleanup.CATEGORY_KEYS` 的镜像，用作 `categories` 参数取值。 */
export type CleanupCategoryKey = "backups" | "backup-trash" | "auto-backups" | "logs" | "old-logs";

/** 清理候选（R19）：超期备份与滚动日志；preview 不删任何东西。 */
export interface CleanupCandidate {
  category: CleanupCategoryKey;
  /** 类别的展示名（如「自动备份」）。 */
  label: string;
  path: string;
  size: number;
  modified: string;
}

/** 被保留策略挡下来的文件（目前只有「最近 3 份备份」）：**不会**出现在清单里。 */
export interface CleanupSkipped {
  category: CleanupCategoryKey;
  label: string;
  path: string;
  reason: string;
  size: number;
}

/** 按类别的汇总：`files` / `bytes` 是该类别本次**可清理**的量。 */
export interface CleanupCategoryStat {
  label: string;
  files: number;
  bytes: number;
}

export interface CleanupPlan {
  older_than_days: number;
  totals: { files: number; bytes: number };
  candidates: CleanupCandidate[];
  /** 被保留策略跳过的文件（最近 3 份备份）。 */
  skipped: CleanupSkipped[];
  /** 全部类别的汇总（不受 `categories` 过滤影响）。 */
  by_category: Partial<Record<CleanupCategoryKey, CleanupCategoryStat>>;
  /** 合法类别清单，顺序即展示顺序。 */
  categories: { key: CleanupCategoryKey; label: string }[];
}

export interface CleanupResult {
  moved: number;
  freed_bytes: number;
  failed: string[];
  /** 文件被移到了这个回收目录（相对数据目录）；没移动时为空串。 */
  trash_dir: string;
  /** 本次没有移动的「最近 3 份备份」，原样回报，界面据此说明。 */
  skipped: CleanupSkipped[];
  by_category: Partial<Record<CleanupCategoryKey, CleanupCategoryStat>>;
  older_than_days: number;
}

/**
 * 把类别拼成查询串。
 *
 * `categories === undefined` = 不传（后端按"全部类别"处理）；
 * `categories === []` = 显式传空（后端按"什么都不清"处理）。
 * 这两种语义必须区分，否则取消全选会变成"更彻底地清"。
 */
function cleanupQuery(olderThanDays: number, categories?: CleanupCategoryKey[]): string {
  const params = new URLSearchParams({ older_than_days: String(olderThanDays) });
  if (categories) {
    if (categories.length === 0) params.append("categories", "");
    for (const key of categories) params.append("categories", key);
  }
  return params.toString();
}

export function previewCleanup(
  olderThanDays = 30,
  categories?: CleanupCategoryKey[],
): Promise<CleanupPlan> {
  return request(`/stats/storage/cleanup-preview?${cleanupQuery(olderThanDays, categories)}`);
}

/** 执行清理：服务端把候选移进 `.cleanup-trash/<时间戳>/`，不永久删除。 */
export function runCleanup(
  olderThanDays = 30,
  categories?: CleanupCategoryKey[],
): Promise<CleanupResult> {
  return request("/stats/storage/cleanup", {
    method: "POST",
    body: JSON.stringify({
      older_than_days: olderThanDays,
      ...(categories ? { categories } : {}),
    }),
  });
}
