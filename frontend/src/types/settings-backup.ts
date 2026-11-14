// SPDX-License-Identifier: Apache-2.0

/** 自动备份保护状态摘要（RF-05，GET /api/settings/backup-status）。 */
export interface BackupStatusSnapshot {
  name: string;
  size_bytes: number;
  modified_at: number;
}

/** 自动备份间隔（天）：设置页可调的运行时值，保存后下次调度检查生效。 */
export interface AutoBackupIntervalSetting {
  interval_days: number;
}

export interface BackupStatus {
  dataset_id: string;
  /**
   * 上次成功备份存在、当前没有连续失败**且当前目录里确有可用快照**——"受保护"的唯一定义。
   * 只有 last_success 的快照已被移走/清理不算受保护。
   * 范围仅指**数据库快照**（不含附件文件，也不含异地灾备），UI 文案需注明。
   */
  protected: boolean;
  last_success: number | null;
  last_attempt: number | null;
  consecutive_failures: number;
  last_error: string;
  interval_days: number;
  /** 有过成功但已超过间隔未再成功（调度线程还没跑到或被阻断）。 */
  overdue: boolean;
  /**
   * 快照目录的可判定状态（审计 F2/A02）：
   * - `"ok"`：目录可读且至少有一份 `.db` 快照；
   * - `"empty"`：目录可读但没有快照（没备份过，或被清理/移走）；
   * - `"unreadable"`：目录读不了（权限/IO/路径断开）——**无法确认**，不等于没有。
   *
   * 旧后端没有这个字段（可选），此时按 `snapshot_count` 推断，界面不得因缺字段崩。
   */
  snapshot_state?: "ok" | "empty" | "unreadable";
  snapshot_count: number;
  snapshots: BackupStatusSnapshot[];
  /**
   * 备份覆盖范围。`"database_only"` 表示自动备份**只保护数据库快照**——附件文件与
   * 自定义字体（`data/fonts/`）都不在其中，需要完整备份请手动「导出数据集/导出全部数据集」。
   * 旧后端没有这个字段（可选），此时界面按既有文案不倒推范围。
   */
  coverage?: "database_only";
  /**
   * 自动备份是否被**部署配置**启用（A02 扩展；旧后端没有这个字段）。
   * 无 UI 开关：关闭只由部署配置决定，界面只能如实说明，不能给用户一个点不动的假开关。
   */
  auto_backup_enabled?: boolean;
  /** 与 auto_backup_enabled 等价的显式禁用标记（任一为真即禁用；后端同时下发）。 */
  disabled?: boolean;
  /**
   * 后端统一给的状态枚举（A02）：protected/overdue/never/empty/unreadable/failing/disabled。
   * 旧后端没有这个字段，界面按旧字段推断；disabled 时 protected 必须为假。
   */
  state?: "protected" | "overdue" | "never" | "empty" | "unreadable" | "failing" | "disabled";
}
