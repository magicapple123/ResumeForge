// SPDX-License-Identifier: Apache-2.0
/**
 * 设置项索引（F38）的守卫：**索引与页面结构必须一一对应**，深链别名不能失效。
 *
 * 两件事分开守：
 * 1. 结构：把 `SettingsPanels.tsx` 里每个 Panel 渲染了哪些卡片组件抽出来，与
 *    `SETTINGS_INDEX` 的 `id` 集合比对（双向）。加了卡忘记登记索引，搜索就搜不到它；
 *    登记了索引却没挂卡，选中后会跳到一片空白——两种都得红。
 * 2. 行为：`?tab=` 的旧键别名（`assistant` → `assistant-behavior`）与检索命中的分组。
 *
 * 结构比对读源码而不是渲染：31 张卡各自要打十来个接口，渲染整页只为数标题太重，
 * 而且失败信息会指向某个接口而不是"少登记了一张卡"。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTINGS_INDEX, searchSettingsEntries } from "./settingsIndex";
import { SETTINGS_SECTIONS, parseSettingsSection } from "./settingsSections";
import type { SettingsSectionKey } from "./settingsSections";

declare const process: { cwd(): string };

/** Panel 名 → 分组键。九组各一个 Panel。 */
const PANEL_SECTIONS: Record<string, SettingsSectionKey> = {
  ModelPanel: "model",
  AssistantBehaviorPanel: "assistant-behavior",
  MemorySkillsPanel: "memory-skills",
  VoicePanel: "voice",
  AppearancePanel: "appearance",
  InteractionPanel: "interaction",
  DataPanel: "data",
  BackupPanel: "backup",
  AboutPanel: "about",
};

/** 卡片组件名 → 索引 id（顺序无关，比对的是集合）。 */
const CARD_IDS: Record<string, string> = {
  LLMConfigCard: "model-config",
  ModelWindowReferenceButton: "model-window",
  EmbeddingProviderCard: "embedding",
  SettingsProvenanceSection: "provenance",
  SearchCard: "search",
  AssistantRelaxedModeCard: "relaxed",
  AssistantLimitCard: "limits",
  AssistantToolsCard: "tools",
  JobPreferenceCard: "job-preference",
  WebFormRelaxedModeCard: "webform",
  AssistantMemoryCard: "memory",
  AgentTaskEventsCard: "task-events",
  SkillsCard: "skills",
  AsrSettingsCard: "asr",
  InterviewVoiceSettingsCard: "interview-voice",
  InterviewCameraSettingsCard: "interview-camera",
  LocaleSettingsCard: "locale",
  ResumeFontCard: "font",
  NavigationSettingsCard: "navigation",
  AssistantOrbCard: "orb",
  ShortcutSettingsCard: "shortcuts",
  BatchOperationCard: "batch",
  DatasetsCard: "datasets",
  ExportSaveCard: "export-save",
  StorageStatsCard: "storage",
  BackupStatusCard: "backup-status",
  ManualBackupsCard: "manual-backup",
  PrivacyCard: "privacy",
  UpdateCard: "update",
  AnnouncementSettingsCard: "announcement",
  HelpDiagnosticsCard: "diagnostics",
  ReminderPopupCard: "reminders",
};

function panelsSource(): string {
  return readFileSync(
    [process.cwd(), "src", "features", "settings", "SettingsPanels.tsx"].join("/"),
    "utf8",
  );
}

/** 取某个 Panel 函数体里出现的卡片组件（只认 CARD_IDS 里的名字）。 */
function cardsOfPanel(source: string, panel: string): string[] {
  const start = source.indexOf(`export function ${panel}(`);
  if (start < 0) return [];
  // 下一个 Panel 的起点（或文件末尾）就是本 Panel 的边界。
  const nextStarts = Object.keys(PANEL_SECTIONS)
    .map((name) => source.indexOf(`export function ${name}(`, start + 1))
    .filter((index) => index > start);
  const end = nextStarts.length > 0 ? Math.min(...nextStarts) : source.length;
  const body = source.slice(start, end);
  const found = Object.keys(CARD_IDS).filter((component) =>
    new RegExp(`<${component}[\\s/>]`).test(body),
  );
  return found.map((component) => CARD_IDS[component]).sort();
}

describe("设置项索引", () => {
  it("has a unique id per entry and covers all nine sections", () => {
    const ids = SETTINGS_INDEX.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const section of SETTINGS_SECTIONS) {
      const entries = SETTINGS_INDEX.filter((entry) => entry.section === section.key);
      expect(entries.length, `分组 ${section.key} 没有索引项`).toBeGreaterThan(0);
    }
    expect(SETTINGS_SECTIONS).toHaveLength(9);
    expect(SETTINGS_INDEX).toHaveLength(Object.keys(CARD_IDS).length);
  });

  it("matches the cards SettingsPanels actually renders, in both directions", () => {
    const source = panelsSource();
    const rendered = new Set<string>();
    for (const [panel, section] of Object.entries(PANEL_SECTIONS)) {
      const ids = cardsOfPanel(source, panel);
      expect(ids.length, `${panel} 没有渲染任何已登记的卡`).toBeGreaterThan(0);
      for (const id of ids) {
        const entry = SETTINGS_INDEX.find((item) => item.id === id);
        expect(entry, `${panel} 里的 ${id} 没登记进索引`).toBeDefined();
        expect(entry?.section, `${id} 登记的组与 ${panel} 不一致`).toBe(section);
        rendered.add(id);
      }
    }
    const indexed = new Set(SETTINGS_INDEX.map((entry) => entry.id));
    expect([...indexed].filter((id) => !rendered.has(id))).toEqual([]);
  });

  it("keeps spoken-word aliases to the 8-10 cards that need them", () => {
    const aliases = SETTINGS_INDEX.filter((entry) => entry.aliasKey !== undefined);
    expect(aliases.length).toBeGreaterThanOrEqual(8);
    expect(aliases.length).toBeLessThanOrEqual(10);
    // 别名键必须带 settings.search.alias. 前缀，否则会悄悄落到别的命名空间的同名字符串上。
    for (const entry of aliases) {
      expect(entry.aliasKey?.startsWith("settings.search.alias.")).toBe(true);
    }
  });

  it("finds the interview voice card by the word 音色 and the camera card by 镜头", () => {
    expect(searchSettingsEntries("音色").map((entry) => entry.id)).toEqual(["interview-voice"]);
    const camera = searchSettingsEntries("镜头");
    expect(camera.map((entry) => entry.id)).toEqual(["interview-camera"]);
    expect(camera[0].section).toBe("voice");
  });

  it("narrows results with multiple terms and returns nothing for an empty query", () => {
    expect(searchSettingsEntries("   ")).toEqual([]);
    // 两个词都要命中：只有「面试语音」同时落在"语音"与"音色"上。
    expect(searchSettingsEntries("语音 音色").map((entry) => entry.id)).toEqual([
      "interview-voice",
    ]);
    expect(searchSettingsEntries("不存在的设置项")).toEqual([]);
  });
});

describe("设置分组深链", () => {
  it("accepts every current section key", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(parseSettingsSection(section.key)).toBe(section.key);
    }
  });

  it("maps the legacy assistant key and falls back to model for anything else", () => {
    expect(parseSettingsSection("assistant")).toBe("assistant-behavior");
    expect(parseSettingsSection("nope")).toBe("model");
    expect(parseSettingsSection(null)).toBe("model");
  });
});
