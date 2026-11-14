// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的**分组表**：九个分组、三档导航标题、以及旧深链键的别名。
 *
 * 这张表是导航、深链解析、搜索索引三处共用的唯一来源——三份各自维护一张清单，
 * 迟早会出现"导航里有、深链进不去"或"搜得到、切不过去"。
 *
 * 分组按「你改的是什么」划分，不是按组件目录：
 * - AI 与助手：模型 → 助手行为 → 记忆与技能 → 语音与面试
 * - 界面与操作：外观与语言 → 操作习惯
 * - 数据与应用：数据与存储 → 备份与隐私 → 更新与帮助
 */
import type { MessageKey } from "../../i18n";

export type SettingsSectionKey =
  | "model"
  | "assistant-behavior"
  | "memory-skills"
  | "voice"
  | "appearance"
  | "interaction"
  | "data"
  | "backup"
  | "about";

/** 左侧导航的分档标题（只影响导航的视觉分组，不影响深链）。 */
export type SettingsNavGroupKey = "ai" | "interface" | "data";

export interface SettingsNavGroup {
  key: SettingsNavGroupKey;
  titleKey: MessageKey;
}

export interface SettingsSection {
  key: SettingsSectionKey;
  navGroup: SettingsNavGroupKey;
  /** 导航项文字。 */
  titleKey: MessageKey;
  /** 右侧内容区顶部那句说明。 */
  introKey: MessageKey;
}

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  { key: "ai", titleKey: "settings.nav.group.ai" },
  { key: "interface", titleKey: "settings.nav.group.interface" },
  { key: "data", titleKey: "settings.nav.group.data" },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: "model",
    navGroup: "ai",
    titleKey: "settings.tab.model",
    introKey: "settings.model.intro",
  },
  {
    key: "assistant-behavior",
    navGroup: "ai",
    titleKey: "settings.tab.assistant",
    introKey: "settings.assistant.intro",
  },
  {
    key: "memory-skills",
    navGroup: "ai",
    titleKey: "settings.tab.memorySkills",
    introKey: "settings.memorySkills.intro",
  },
  {
    key: "voice",
    navGroup: "ai",
    titleKey: "settings.tab.voice",
    introKey: "settings.voice.intro",
  },
  {
    key: "appearance",
    navGroup: "interface",
    titleKey: "settings.tab.appearance",
    introKey: "settings.appearance.intro",
  },
  {
    key: "interaction",
    navGroup: "interface",
    titleKey: "settings.tab.interaction",
    introKey: "settings.interaction.intro",
  },
  {
    key: "data",
    navGroup: "data",
    titleKey: "settings.tab.data",
    introKey: "settings.data.intro",
  },
  {
    key: "backup",
    navGroup: "data",
    titleKey: "settings.tab.backup",
    introKey: "settings.backup.intro",
  },
  {
    key: "about",
    navGroup: "data",
    titleKey: "settings.tab.about",
    introKey: "settings.about.intro",
  },
];

/** 默认落在「AI 模型」：多数人进设置页是为了改模型或看用量。 */
export const DEFAULT_SETTINGS_SECTION: SettingsSectionKey = "model";

/**
 * 旧 `?tab=` 键里只有 `assistant` 需要别名：其余五个旧键（model / appearance /
 * data / backup / about）本身就是正式分组键，所以旧链接一个都不会失效。
 */
const LEGACY_TAB_ALIASES: Readonly<Record<string, SettingsSectionKey>> = {
  assistant: "assistant-behavior",
};

/** 深链 `?tab=` 的解析：先查正式分组，再查旧键别名，都不中回默认（不报错）。 */
export function parseSettingsSection(value: string | null): SettingsSectionKey {
  const direct = SETTINGS_SECTIONS.find((section) => section.key === value);
  if (direct) return direct.key;
  if (value !== null && value in LEGACY_TAB_ALIASES) return LEGACY_TAB_ALIASES[value];
  return DEFAULT_SETTINGS_SECTION;
}

/** 按导航分档取分组（保持 SETTINGS_SECTIONS 里的顺序）。 */
export function sectionsOfGroup(group: SettingsNavGroupKey): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => section.navGroup === group);
}

/** 取分组元数据。键一定来自类型，这里的兜底只是为了让调用方不必写非空断言。 */
export function settingsSection(key: SettingsSectionKey): SettingsSection {
  return SETTINGS_SECTIONS.find((section) => section.key === key) ?? SETTINGS_SECTIONS[0];
}
