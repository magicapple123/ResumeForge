// SPDX-License-Identifier: Apache-2.0
/**
 * 设置项的**搜索索引**：卡片标题 + 分组名 + 少量口头词别名。
 *
 * 为什么单独一张表：31 张卡分布在九组里，用户找"音色"时不会先记住它在「语音与面试」；
 * 索引是唯一能搜到它的地方。表是纯数据，匹配逻辑是纯函数，两者都不碰 DOM。
 *
 * 别名的口径：**只给标题里没有用户口头词的卡**（目前 10 张）。标题已经含"搜索""记忆"
 * 这类词的卡不再登记同义词——同义词一多，短查询会命中半个页面，搜索反而更难用。
 * 别名文字放在语言包 `settings.search.alias.<id>`，中英各一份（不在本文件写中文）。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { SETTINGS_SECTIONS, type SettingsSectionKey } from "./settingsSections";

export interface SettingsIndexEntry {
  /** 稳定 id：下拉项的 value，也是测试里的定位锚点。 */
  id: string;
  section: SettingsSectionKey;
  /** 卡片标题键；选中后按它的译文定位并高亮那一张卡。 */
  titleKey: MessageKey;
  /** 口头词别名（可选，见文件头的口径）。 */
  aliasKey?: MessageKey;
}

/** 顺序与 SettingsPanels 的渲染顺序一致：下拉里的同组条目和页面上的顺序相同。 */
export const SETTINGS_INDEX: readonly SettingsIndexEntry[] = [
  // AI 模型
  {
    id: "model-config",
    section: "model",
    titleKey: "llmConfigCard.card.title",
    aliasKey: "settings.search.alias.model-config",
  },
  {
    id: "model-window",
    section: "model",
    titleKey: "contextUsage.window.reference.trigger",
    aliasKey: "settings.search.alias.model-window",
  },
  {
    id: "embedding",
    section: "model",
    titleKey: "embeddingSearch.title",
    aliasKey: "settings.search.alias.embedding",
  },
  { id: "provenance", section: "model", titleKey: "settings.provenance.title" },
  // 助手行为
  { id: "search", section: "assistant-behavior", titleKey: "searchCard.title" },
  { id: "relaxed", section: "assistant-behavior", titleKey: "assistantPermission.settings.title" },
  { id: "limits", section: "assistant-behavior", titleKey: "assistantLimits.settings.title" },
  { id: "tools", section: "assistant-behavior", titleKey: "assistantTools.title" },
  { id: "job-preference", section: "assistant-behavior", titleKey: "jobPreference.title" },
  { id: "webform", section: "assistant-behavior", titleKey: "settingsUi.webFormRelaxed.title" },
  // 记忆与技能
  { id: "memory", section: "memory-skills", titleKey: "assistantMemory.title" },
  { id: "task-events", section: "memory-skills", titleKey: "settingsUi.agentTaskEvents.title" },
  { id: "skills", section: "memory-skills", titleKey: "settingsUi.skills.title" },
  // 语音与面试
  {
    id: "asr",
    section: "voice",
    titleKey: "voiceInput.settings.title",
    aliasKey: "settings.search.alias.asr",
  },
  {
    id: "interview-voice",
    section: "voice",
    titleKey: "interviewVoice.settings.cardTitle",
    aliasKey: "settings.search.alias.interview-voice",
  },
  {
    id: "interview-camera",
    section: "voice",
    titleKey: "interviewCamera.settings.title",
    aliasKey: "settings.search.alias.interview-camera",
  },
  // 外观与语言
  { id: "locale", section: "appearance", titleKey: "settings.locale.title" },
  { id: "font", section: "appearance", titleKey: "fonts.card.title" },
  { id: "navigation", section: "appearance", titleKey: "navigation.settings.title" },
  { id: "orb", section: "appearance", titleKey: "settingsUi.orb.title" },
  // 操作习惯
  {
    id: "shortcuts",
    section: "interaction",
    titleKey: "shortcutSettings.card.title",
    aliasKey: "settings.search.alias.shortcuts",
  },
  { id: "batch", section: "interaction", titleKey: "batchOperation.title" },
  // 数据与存储
  {
    id: "datasets",
    section: "data",
    titleKey: "datasets.card.title",
    aliasKey: "settings.search.alias.datasets",
  },
  { id: "export-save", section: "data", titleKey: "settingsUi.exportSave.title" },
  {
    id: "storage",
    section: "data",
    titleKey: "storageStats.title",
    aliasKey: "settings.search.alias.storage",
  },
  // 备份与隐私
  { id: "backup-status", section: "backup", titleKey: "backupStatus.title" },
  {
    id: "manual-backup",
    section: "backup",
    titleKey: "manualBackups.title",
    aliasKey: "settings.search.alias.manual-backup",
  },
  { id: "privacy", section: "backup", titleKey: "settingsUi.privacy.title" },
  // 更新与帮助
  { id: "update", section: "about", titleKey: "update.card.title" },
  { id: "announcement", section: "about", titleKey: "announcement.settings.title" },
  { id: "diagnostics", section: "about", titleKey: "settingsUi.help.title" },
  { id: "reminders", section: "about", titleKey: "settingsUi.reminderPopup.title" },
];

/** 一条索引项在一门语言下的全部可搜文字（卡片标题 + 分组名 + 别名）。 */
export function indexEntryHaystack(entry: SettingsIndexEntry): string {
  const section = SETTINGS_SECTIONS.find((item) => item.key === entry.section);
  const parts = [
    t(entry.titleKey),
    entry.aliasKey ? t(entry.aliasKey) : "",
    section?.titleKey ? t(section.titleKey) : "",
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * 按关键词过滤索引。空格分词、全部词都命中才算（"语音 音色" 收窄到一张卡），
 * 空串返回空数组——空输入不该把九组全部摊开。
 */
export function searchSettingsEntries(query: string): SettingsIndexEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return SETTINGS_INDEX.filter((entry) => {
    const haystack = indexEntryHaystack(entry);
    return terms.every((term) => haystack.includes(term));
  });
}
