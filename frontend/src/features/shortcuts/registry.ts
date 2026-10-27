// SPDX-License-Identifier: Apache-2.0
/**
 * 快捷键动作注册表（R5）。
 *
 * 这张表是所有快捷键相关代码的唯一事实源：keymap 的匹配、设置页的表格、localStorage
 * 的校验都从它取「有哪些动作、默认组合是什么、作用域在哪」。
 *
 * 新增动作的前提是**有真实落点**：先在一个页面或组件里用 `useShortcut(id, handler)`
 * 注册好行为，再回这里登记。快捷键表里出现"按了没反应"的条目，比少一条更糟——
 * 用户会以为是应用坏了。
 */
import type { MessageKey } from "../../i18n";

/** 动作的作用域：只用于设置页展示与代码阅读，拦截判断由"有没有注册 handler"决定。 */
export type ShortcutScope = "form" | "page" | "global" | "jobs";

/** 动作 id（也是 localStorage 里的键）。新增动作必须同时有真实落点（见文件头）。 */
export type ShortcutActionId =
  | "undo"
  | "redo"
  | "save"
  | "search"
  | "assistant"
  | "newJob"
  | "toggleTheme"
  | "openSettings"
  | "openSkills"
  | "exportPdf"
  | "newResume"
  | "switchDataset"
  | "prevPage"
  | "nextPage"
  | "focusAssistant"
  | "commandPalette";

export interface ShortcutAction {
  id: ShortcutActionId;
  /** 设置页展示名（语言包 key）；显示时走 `t(action.labelKey)`。 */
  labelKey: MessageKey;
  /** 默认组合（`mod` 在 macOS 上是 Command，其它平台是 Ctrl）。 */
  defaultKeys: string[];
  scope: ShortcutScope;
}

/** 作用域显示名（协议值是 `ShortcutScope`，这里的值只是语言包 key）。 */
export const SCOPE_LABEL_KEYS: Record<ShortcutScope, MessageKey> = {
  form: "shortcutSettings.scope.form",
  page: "shortcutSettings.scope.page",
  global: "shortcutSettings.scope.global",
  jobs: "shortcutSettings.scope.jobs",
};

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  { id: "undo", labelKey: "shortcutSettings.action.undo", defaultKeys: ["mod+z"], scope: "form" },
  {
    id: "redo",
    labelKey: "shortcutSettings.action.redo",
    defaultKeys: ["mod+shift+z", "mod+y"],
    scope: "form",
  },
  { id: "save", labelKey: "shortcutSettings.action.save", defaultKeys: ["mod+s"], scope: "page" },
  {
    id: "search",
    labelKey: "shortcutSettings.action.search",
    defaultKeys: ["mod+k"],
    scope: "global",
  },
  {
    id: "assistant",
    labelKey: "shortcutSettings.action.assistant",
    defaultKeys: ["mod+j"],
    scope: "global",
  },
  {
    id: "newJob",
    labelKey: "shortcutSettings.action.newJob",
    defaultKeys: ["mod+alt+n"],
    scope: "jobs",
  },
  // 下面四个是 R8 新增的"全局动作"：都在 `GlobalShortcuts` / 预览组件里有真实落点，
  // 不是只占一行表（按了没反应的快捷键比没有更糟）。
  {
    id: "toggleTheme",
    labelKey: "shortcutSettings.action.toggleTheme",
    defaultKeys: ["mod+alt+d"],
    scope: "global",
  },
  {
    id: "openSettings",
    labelKey: "shortcutSettings.action.openSettings",
    defaultKeys: ["mod+alt+s"],
    scope: "global",
  },
  {
    id: "openSkills",
    labelKey: "shortcutSettings.action.openSkills",
    defaultKeys: ["mod+alt+k"],
    scope: "global",
  },
  {
    id: "exportPdf",
    labelKey: "shortcutSettings.action.exportPdf",
    defaultKeys: ["mod+shift+e"],
    scope: "page",
  },
  // R8 第二批：落点分别是简历中心、页头数据集菜单、当前列表分页、求职助手。
  {
    id: "newResume",
    labelKey: "shortcutSettings.action.newResume",
    defaultKeys: ["mod+shift+n"],
    scope: "page",
  },
  {
    id: "switchDataset",
    labelKey: "shortcutSettings.action.switchDataset",
    defaultKeys: ["mod+shift+d"],
    scope: "global",
  },
  {
    id: "prevPage",
    labelKey: "shortcutSettings.action.prevPage",
    defaultKeys: ["mod+["],
    scope: "page",
  },
  {
    id: "nextPage",
    labelKey: "shortcutSettings.action.nextPage",
    defaultKeys: ["mod+]"],
    scope: "page",
  },
  {
    id: "focusAssistant",
    labelKey: "shortcutSettings.action.focusAssistant",
    defaultKeys: ["mod+/"],
    scope: "global",
  },
  // W15/D13 命令面板（制作台内）。mod+k 已被全站搜索占用（既有用户习惯与测试），
  // 命令面板采用 VSCode 同款 mod+shift+p；两个动作都能在设置页改键。
  {
    id: "commandPalette",
    // 动作名走语言包；这条以前挂着 i18n-ok 豁免，本项目已迁移。
    labelKey: "shortcutSettings.action.commandPalette",
    defaultKeys: ["mod+shift+p"],
    scope: "page",
  },
];

export const SHORTCUT_ACTION_IDS: readonly ShortcutActionId[] = SHORTCUT_ACTIONS.map(
  (action) => action.id,
);

/** localStorage 里只认这些 id；其它键一律丢弃（旧版本残留、手改坏的数据都走这条路）。 */
export function isShortcutActionId(value: string): value is ShortcutActionId {
  return SHORTCUT_ACTION_IDS.includes(value as ShortcutActionId);
}

export function findShortcutAction(id: string): ShortcutAction | undefined {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

/** 每个动作各自一份默认组合的**副本**，避免调用方原地改到常量。 */
export function defaultShortcutBindings(): Record<ShortcutActionId, string[]> {
  const bindings = {} as Record<ShortcutActionId, string[]>;
  for (const action of SHORTCUT_ACTIONS) {
    bindings[action.id] = [...action.defaultKeys];
  }
  return bindings;
}
