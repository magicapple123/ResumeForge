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
