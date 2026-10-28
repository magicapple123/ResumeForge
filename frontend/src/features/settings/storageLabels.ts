// SPDX-License-Identifier: Apache-2.0
/**
 * 存储占用里**后端下发的中文展示名** → 语言包 key。
 *
 * 为什么要有这一层：`GET /api/stats/storage` 的 `items[].label` 与清理预览的
 * `categories[].label` 都是后端直接写的中文展示名，不是协议值——英文界面下会原样露出
 * 中文。协议值是稳定的 `key`，前端按它映射；映射不到（后端新增了分项或类别）时调用方
 * 回退后端原文，不丢信息。
 *
 * 只放常量与纯函数：不在模块作用域求值 `t()`（那会把首帧语言钉死）。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";

/** 分项 key（`storage_stats._ITEM_SPECS[].key`）→ 文案 key。 */
const ITEM_LABEL_KEYS: Record<string, MessageKey> = {
  database: "storageStats.item.database",
  datasets: "storageStats.item.datasets",
  backups: "storageStats.item.backups",
  auto_backups: "storageStats.item.auto_backups",
  user_files: "storageStats.item.user_files",
  exports: "storageStats.item.exports",
  captures: "storageStats.item.captures",
  share_packages: "storageStats.item.share_packages",
  referral_images: "storageStats.item.referral_images",
  logs: "storageStats.item.logs",
  browser_profile: "storageStats.item.browser_profile",
  webform_browser_profile: "storageStats.item.webform_browser_profile",
  restore: "storageStats.item.restore",
  pre_update: "storageStats.item.pre_update",
  uncategorized: "storageStats.item.uncategorized",
};

/** 清理类别 key（`cleanup.CATEGORIES[].key`）→ 文案 key。 */
const CLEANUP_CATEGORY_KEYS: Record<string, MessageKey> = {
  backups: "storageStats.cleanupCategory.backups",
  "backup-trash": "storageStats.cleanupCategory.backup-trash",
  "auto-backups": "storageStats.cleanupCategory.auto-backups",
  logs: "storageStats.cleanupCategory.logs",
};

/** 分项展示名：已知 key 走语言包，未知 key 回退后端原文。 */
export function storageItemLabel(item: { key: string; label: string }): string {
  const key = ITEM_LABEL_KEYS[item.key];
  return key ? t(key) : item.label;
}

/** 清理类别展示名：与分项同一套判据。 */
export function storageCategoryLabel(item: { key: string; label: string }): string {
  const key = CLEANUP_CATEGORY_KEYS[item.key];
  return key ? t(key) : item.label;
}
