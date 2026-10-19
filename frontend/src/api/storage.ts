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

/** 清理候选（R19）：超期备份与滚动日志；preview 不删任何东西。 */
export interface CleanupCandidate {
  label: string;
  path: string;
  size: number;
  modified: string;
}

export interface CleanupPlan {
  older_than_days: number;
  totals: { files: number; bytes: number };
  candidates: CleanupCandidate[];
}

export interface CleanupResult {
  moved: number;
  freed_bytes: number;
  failed: string[];
  /** 文件被移到了这个回收目录（相对数据目录）；没移动时为空串。 */
  trash_dir: string;
}

export function previewCleanup(olderThanDays = 30): Promise<CleanupPlan> {
  return request(`/stats/storage/cleanup-preview?older_than_days=${olderThanDays}`);
}

/** 执行清理：服务端把候选移进 `.cleanup-trash/<时间戳>/`，不永久删除。 */
export function runCleanup(olderThanDays = 30): Promise<CleanupResult> {
  return request("/stats/storage/cleanup", {
    method: "POST",
    body: JSON.stringify({ older_than_days: olderThanDays }),
  });
}
