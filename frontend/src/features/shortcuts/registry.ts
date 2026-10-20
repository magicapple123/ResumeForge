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
  | "focusAssistant";

export interface ShortcutAction {
  id: ShortcutActionId;
  /** 设置页展示用的中文名。 */
  label: string;
  /** 默认组合（`mod` 在 macOS 上是 Command，其它平台是 Ctrl）。 */
  defaultKeys: string[];
  scope: ShortcutScope;
}

export const SCOPE_LABELS: Record<ShortcutScope, string> = {
  form: "表单",
  page: "页面",
  global: "全局",
  jobs: "岗位广场",
};

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  { id: "undo", label: "撤回", defaultKeys: ["mod+z"], scope: "form" },
  { id: "redo", label: "恢复", defaultKeys: ["mod+shift+z", "mod+y"], scope: "form" },
  { id: "save", label: "保存当前编辑", defaultKeys: ["mod+s"], scope: "page" },
  { id: "search", label: "搜索", defaultKeys: ["mod+k"], scope: "global" },
  { id: "assistant", label: "打开/关闭求职助手", defaultKeys: ["mod+j"], scope: "global" },
  { id: "newJob", label: "新建岗位", defaultKeys: ["mod+alt+n"], scope: "jobs" },
  // 下面四个是 R8 新增的"全局动作"：都在 `GlobalShortcuts` / 预览组件里有真实落点，
  // 不是只占一行表（按了没反应的快捷键比没有更糟）。
  { id: "toggleTheme", label: "切换深色/浅色", defaultKeys: ["mod+alt+d"], scope: "global" },
  { id: "openSettings", label: "打开设置", defaultKeys: ["mod+alt+s"], scope: "global" },
  { id: "openSkills", label: "打开助手技能", defaultKeys: ["mod+alt+k"], scope: "global" },
  { id: "exportPdf", label: "打开导出（简历预览中）", defaultKeys: ["mod+shift+e"], scope: "page" },
  // R8 第二批：落点分别是简历中心、页头数据集菜单、当前列表分页、求职助手。
  { id: "newResume", label: "新建简历", defaultKeys: ["mod+shift+n"], scope: "page" },
  { id: "switchDataset", label: "切换数据集", defaultKeys: ["mod+shift+d"], scope: "global" },
  { id: "prevPage", label: "上一页（列表）", defaultKeys: ["mod+["], scope: "page" },
  { id: "nextPage", label: "下一页（列表）", defaultKeys: ["mod+]"], scope: "page" },
  { id: "focusAssistant", label: "打开助手并聚焦输入", defaultKeys: ["mod+/"], scope: "global" },
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
