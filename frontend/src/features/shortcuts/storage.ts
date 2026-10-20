// SPDX-License-Identifier: Apache-2.0
/**
 * 快捷键设置的持久化与订阅（R5 / R7）。
 *
 * 存在 localStorage 的 `rf.shortcuts.v1` 里（键名沿用不动，避免升级即丢设置），形状是
 * `{ version: 2, bindings: Record<动作id, 组合键[] | null> }`。
 *
 * **`null` 表示用户显式解绑**——这与"没配过、用默认值"是两件事：默认值是一份会随
 * 版本变化的清单，把它当成"空即默认"会让用户永远关不掉一条快捷键。v1 的数据读取时
 * 自动升级（版本号改 2，数组原样保留）。
 *
 * 读取一律走 `getShortcutSettings()`：它按"原始字符串是否变化"缓存解析结果，
 * 所以既能给 `useSyncExternalStore` 提供引用稳定的快照，又能在测试或另一个标签页
 * 直接改 localStorage 之后自然失效（不需要手工清缓存）。
 *
 * 解析失败、版本不认识、动作不认识、组合键不合法——全部**逐项**回落到默认值，
 * 绝不把整份设置判死：用户改坏一条不该让另外五条也用不了。
 */
import { SHORTCUT_ACTIONS, defaultShortcutBindings, type ShortcutActionId } from "./registry";
import { normalizeBinding, validateShortcut } from "./matchShortcut";

export const SHORTCUT_STORAGE_KEY = "rf.shortcuts.v1";
export const SHORTCUT_STORAGE_VERSION = 2;

/** `null` = 显式解绑；数组 = 生效的组合（空数组在清洗时按"没配过"回落默认）。 */
export type ShortcutBindings = Record<ShortcutActionId, string[] | null>;

export interface ShortcutSettings {
  version: number;
  bindings: ShortcutBindings;
}

export type ShortcutSettingsListener = () => void;

const listeners = new Set<ShortcutSettingsListener>();

/** 上次解析时的原始字符串与结果：两者一起构成"引用稳定的快照缓存"。 */
let cachedRaw: string | null = null;
let cachedSettings: ShortcutSettings | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // 隐私模式下访问 localStorage 本身就会抛错，此时退化成"只在内存里生效"。
    return null;
  }
}

function readRawSettings(): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(SHORTCUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function defaultShortcutSettings(): ShortcutSettings {
  return { version: SHORTCUT_STORAGE_VERSION, bindings: defaultShortcutBindings() };
}

/**
 * 逐动作清洗：丢掉不认识的动作、不合法或互相冲突的组合；某动作一条可用的都不剩
 * 时回落到它的默认组合。
 */
export function sanitizeShortcutBindings(input: unknown): ShortcutBindings {
  const defaults = defaultShortcutBindings();
  const source = isPlainObject(input) ? input : {};
  const used = new Set<string>();
  const result = {} as ShortcutBindings;
  for (const action of SHORTCUT_ACTIONS) {
    const raw = source[action.id];
    if (raw === null) {
      // 显式解绑：不回落到默认值，否则用户永远关不掉这一条。
      result[action.id] = null;
      continue;
    }
    const candidates = Array.isArray(raw) ? raw : [];
    const accepted: string[] = [];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const validation = validateShortcut(candidate);
      if (!validation.ok) continue;
      if (used.has(validation.binding)) continue;
      used.add(validation.binding);
      accepted.push(validation.binding);
    }
    if (accepted.length === 0) {
      // 默认组合也要参与去重：用户可能把另一个动作改成了这个默认键。
      const fallback = defaults[action.id].filter((binding) => !used.has(binding));
      for (const binding of fallback) used.add(binding);
      result[action.id] = fallback;
    } else {
      result[action.id] = accepted;
    }
  }
  return result;
}

export function sanitizeShortcutSettings(input: unknown): ShortcutSettings {
  if (!isPlainObject(input)) return defaultShortcutSettings();
  // v1 → v2：结构兼容（只是多了 null 的语义），旧设置原样保留；不认识的新版本仍退回默认，
  // 避免把未来版本的字段当成当前版本的语义解释。
  if (input.version !== 1 && input.version !== SHORTCUT_STORAGE_VERSION) {
    return defaultShortcutSettings();
  }
  return {
    version: SHORTCUT_STORAGE_VERSION,
    bindings: sanitizeShortcutBindings(input.bindings),
  };
}

/** 坏 JSON → 默认值；这里不抛错，也不把坏数据写回去。 */
export function parseShortcutSettings(raw: string | null): ShortcutSettings {
  if (!raw) return defaultShortcutSettings();
  try {
    return sanitizeShortcutSettings(JSON.parse(raw));
  } catch {
    return defaultShortcutSettings();
  }
}

/** 引用稳定的快照（`useSyncExternalStore` 的 getSnapshot）。 */
export function getShortcutSettings(): ShortcutSettings {
  const raw = readRawSettings();
  if (cachedSettings && raw === cachedRaw) return cachedSettings;
  cachedRaw = raw;
  cachedSettings = parseShortcutSettings(raw);
  return cachedSettings;
}

export function subscribeShortcutSettings(listener: ShortcutSettingsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 广播给所有订阅者（`useShortcutKeymap` 据此立刻用上新组合，无需刷新页面）。 */
export function notifyShortcutSettingsChange(): void {
  for (const listener of Array.from(listeners)) listener();
}

export function saveShortcutSettings(input: unknown): ShortcutSettings {
  const clean = sanitizeShortcutSettings(input);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // 写不进去（配额满/隐私模式）不影响本次会话：内存快照仍然切换到新值。
    }
  }
  cachedRaw = readRawSettings();
  cachedSettings = clean;
  notifyShortcutSettingsChange();
  return clean;
}

/** 单条改键：只替换这个动作的组合。 */
export function updateShortcutBinding(
  settings: ShortcutSettings,
  id: ShortcutActionId,
  /** 传 `null` 表示解绑（该动作不再响应任何组合）。 */
  keys: string[] | null,
): ShortcutSettings {
  return saveShortcutSettings({
    version: SHORTCUT_STORAGE_VERSION,
    bindings: { ...settings.bindings, [id]: keys },
  });
}

/** 单个动作恢复默认。 */
export function restoreShortcutBinding(
  settings: ShortcutSettings,
  id: ShortcutActionId,
): ShortcutSettings {
  const defaults = defaultShortcutBindings();
  return updateShortcutBinding(settings, id, defaults[id]);
}

/** 全部恢复默认。 */
export function resetShortcutSettings(): ShortcutSettings {
  return saveShortcutSettings(defaultShortcutSettings());
}

/**
 * 某个动作当前的组合键（仅用于展示）。
 *
 * `null`（显式解绑）返回空数组——调用方据此显示「未绑定」；**不能**回落到默认值，
 * 否则界面上会说"绑着 Ctrl+K"，而按下去什么都不会发生。
 */
export function shortcutKeysOf(settings: ShortcutSettings, id: ShortcutActionId): string[] {
  const list = settings.bindings[id];
  if (list === null) return [];
  if (!Array.isArray(list) || list.length === 0) return defaultShortcutBindings()[id];
  return list.map((binding) => normalizeBinding(binding)).filter((binding) => binding.length > 0);
}
