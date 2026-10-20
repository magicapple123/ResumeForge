// SPDX-License-Identifier: Apache-2.0
/**
 * 快捷键匹配的纯函数层（R5）。
 *
 * 这里只做字符串运算与事件读取，不碰 React、不碰 localStorage，因此可以逐分支做
 * 单测（平台差异、保留键、无修饰键字母）。副作用（拦截默认行为、调用 handler）在
 * `useShortcutKeymap` 里。
 *
 * 组合键的规范形式是 `mod+shift+z` 这样的字符串：
 * - `mod` 在 macOS 上是 Command（metaKey），其它平台是 Ctrl（ctrlKey）；
 * - macOS 上按 Ctrl 不会被折叠成 `mod`，而是独立记成 `ctrl+…`（Windows 上的 Win 键
 *   同理记成 `meta+…`）——两者本来就是不同的组合，悄悄合并会让用户按了没反应；
 * - 修饰键顺序固定为 `mod` → `ctrl` → `meta` → `alt` → `shift` → 主键，保证
 *   "同一个物理组合只有一种写法"。
 */
import { SHORTCUT_ACTIONS, isShortcutActionId, type ShortcutActionId } from "./registry";

export interface ShortcutOptions {
  /** 强制按 macOS 规则解析（测试用；默认读平台）。 */
  mac?: boolean;
}

/** 纯修饰键：按下它们本身不构成组合键，录制时应当继续等待。 */
const MODIFIER_KEYS = new Set([
  "shift",
  "control",
  "ctrl",
  "alt",
  "altgraph",
  "meta",
  "os",
  "super",
  "hyper",
  "fn",
  "capslock",
  "numlock",
  "scrolllock",
  "dead",
  "unidentified",
  "process",
]);

const MODIFIER_PARTS = new Set(["mod", "ctrl", "meta", "alt", "shift"]);

/** 修饰键的书写顺序（同时用于 normalize 与 format）。 */
const MODIFIER_ORDER = ["mod", "ctrl", "meta", "alt", "shift"] as const;

/**
 * 浏览器/窗口保留键：绑上去要么被浏览器先抢走、要么关掉窗口，永远到不了页面。
 * 默认值里不能出现，用户改键时同样拒绝。
 */
const RESERVED_BINDINGS = new Set(["mod+w", "mod+r", "mod+t", "mod+n"]);

/** 展示用键名（覆盖常用非字符键，其余按主键原样大写）。 */
const KEY_LABELS: Record<string, string> = {
  escape: "Esc",
  esc: "Esc",
  enter: "Enter",
  return: "Enter",
  space: "Space",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
  home: "Home",
  end: "End",
};

const MAC_MODIFIER_LABELS: Record<string, string> = {
  mod: "⌘",
  ctrl: "⌃",
  meta: "⌘",
  alt: "⌥",
  shift: "⇧",
};

const PC_MODIFIER_LABELS: Record<string, string> = {
  mod: "Ctrl",
  ctrl: "Ctrl",
  meta: "Win",
  alt: "Alt",
  shift: "Shift",
};

/** 拒绝改键的原因码（UI 侧负责翻译成中文，便于测试直接断言原因）。 */
export type ShortcutRejectionReason = "empty" | "modifierOnly" | "reserved" | "noModifier";

export interface ShortcutValidation {
  ok: boolean;
  /** 规范化之后的组合键（`ok` 为 false 时也给出，方便调用方回显）。 */
  binding: string;
  reason?: ShortcutRejectionReason;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = typeof navigator.platform === "string" ? navigator.platform : "";
  const userAgent = typeof navigator.userAgent === "string" ? navigator.userAgent : "";
  return /mac|iphone|ipad|ipod/i.test(platform) || /mac os x|iphone|ipad/i.test(userAgent);
}

/** macOS 判定：显式传 `mac` 优先（测试与"用户手动选了 mac 键位"都走这里）。 */
function resolveMac(options: ShortcutOptions): boolean {
  return options.mac ?? isMacPlatform();
}

/**
 * 事件里的主键名。
 *
 * 优先读 `event.code`（物理键位）：中文/日文/俄文输入法激活时 `event.key` 会是
 * 本地化字符，`KeyZ` 却始终是同一个物理键，用它才能让"Cmd+Z 撤回"在各输入法下一致。
 * `event.code` 缺失（部分合成事件、jsdom 手写事件）时回退到 `event.key`。
 */
export function normalizeKeyName(event: KeyboardEvent): string {
  const code = typeof event.code === "string" ? event.code : "";
  if (code) {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) return letter[1].toLowerCase();
    const digit = /^Digit(\d)$/.exec(code);
    if (digit) return digit[1];
    const numpad = /^Numpad(\d)$/.exec(code);
    if (numpad) return numpad[1];
    // 字母/数字之外的物理键名（Escape / ArrowUp / F5…）交给下面的 key 分支统一小写，
    // 因为 code 与 key 的拼写并不总是等价（如 Space vs code "Space"）。
  }
  const key = typeof event.key === "string" ? event.key : "";
  if (!key) return "";
  if (key === " ") return "space";
  if (key === "Spacebar") return "space";
  return key.toLowerCase();
}

/** 事件本身是"只按了修饰键"（按下 Cmd 的瞬间）——不是组合键，录制时应继续等。 */
export function isModifierOnlyEvent(event: KeyboardEvent): boolean {
  const key = typeof event.key === "string" ? event.key : "";
  return key === "" || MODIFIER_KEYS.has(key.toLowerCase());
}

/**
 * AltGraph（欧洲键盘的 AltGr 输入 €@ 等字符）参与时会同时置 ctrl+alt，若不排除，
 * 在德语键盘上打 `@` 就会被当成 Ctrl+Alt+Q 这样的快捷键。
 */
export function hasAltGraph(event: KeyboardEvent): boolean {
  if (typeof event.getModifierState !== "function") return false;
  try {
    return event.getModifierState("AltGraph");
  } catch {
    return false;
  }
}

/** 把任意写法的组合键规范成 `mod+shift+z`。无法解析时返回空串。 */
export function normalizeBinding(binding: string): string {
  if (typeof binding !== "string") return "";
  const parts = binding
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "";
  const modifiers: string[] = [];
  const others: string[] = [];
  for (const part of parts) {
    if (MODIFIER_PARTS.has(part)) {
      if (!modifiers.includes(part)) modifiers.push(part);
    } else {
      others.push(part);
    }
  }
  modifiers.sort(
    (left, right) =>
      MODIFIER_ORDER.indexOf(left as (typeof MODIFIER_ORDER)[number]) -
      MODIFIER_ORDER.indexOf(right as (typeof MODIFIER_ORDER)[number]),
  );
  return [...modifiers, ...others].join("+");
}

/**
 * 键盘事件 → 规范组合键。纯修饰键、AltGraph、空键名返回 null（调用方应忽略）。
 */
export function normalizeEvent(event: KeyboardEvent, options: ShortcutOptions = {}): string | null {
  if (isModifierOnlyEvent(event)) return null;
  if (hasAltGraph(event)) return null;
  const key = normalizeKeyName(event);
  if (!key) return null;
  const mac = resolveMac(options);
  const parts: string[] = [];
  const modPressed = mac ? event.metaKey : event.ctrlKey;
  if (modPressed) parts.push("mod");
  // 非本位修饰键独立记录（见文件头说明）。
  if (mac && event.ctrlKey) parts.push("ctrl");
  if (!mac && event.metaKey) parts.push("meta");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

/**
 * 校验一个组合键能否被保存。
 *
 * 三条硬规则：
 * 1. 必须带 Ctrl / ⌘ / Alt 之一——只用 Shift（或干脆不带修饰键）的话，绑定它等于把
 *    正常打字变成快捷键；
 * 2. 不能是浏览器/窗口保留组合（`Ctrl+W` 之类）；
 * 3. 必须真的有一个主键（只按修饰键不构成组合）。
 */
export function validateShortcut(binding: string): ShortcutValidation {
  const normalized = normalizeBinding(binding);
  if (!normalized) return { ok: false, binding: normalized, reason: "empty" };
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  if (MODIFIER_PARTS.has(key)) {
    return { ok: false, binding: normalized, reason: "modifierOnly" };
  }
  const hasStrongModifier = modifiers.some(
    (modifier) =>
      modifier === "mod" || modifier === "ctrl" || modifier === "meta" || modifier === "alt",
  );
  if (!hasStrongModifier) {
    return { ok: false, binding: normalized, reason: "noModifier" };
  }
  if (RESERVED_BINDINGS.has(normalized)) {
    return { ok: false, binding: normalized, reason: "reserved" };
  }
  return { ok: true, binding: normalized };
}

/** 事件是否命中某条组合键。 */
export function matches(
  event: KeyboardEvent,
  binding: string,
  options: ShortcutOptions = {},
): boolean {
  const target = normalizeBinding(binding);
  if (!target) return false;
  return normalizeEvent(event, options) === target;
}

/**
 * 新组合是否与其它动作冲突。`exceptId` 用于"改自己"的场景——否则自己的旧组合
 * 会把自己判成冲突。
 */
export function findConflict(
  bindings: Record<string, string[] | null>,
  next: string,
  exceptId?: string,
): ShortcutActionId | null {
  const target = normalizeBinding(next);
  if (!target) return null;
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === exceptId) continue;
    const list = bindings[action.id];
    if (!Array.isArray(list)) continue;
    if (list.some((binding) => normalizeBinding(binding) === target)) return action.id;
  }
  return null;
}

/** 事件命中的动作 id（没有命中返回 null）。动作顺序即注册表顺序。 */
export function findBindingActionId(
  event: KeyboardEvent,
  bindings: Record<string, string[] | null>,
  options: ShortcutOptions = {},
): ShortcutActionId | null {
  const normalized = normalizeEvent(event, options);
  if (!normalized) return null;
  for (const action of SHORTCUT_ACTIONS) {
    const list = bindings[action.id];
    if (!Array.isArray(list)) continue;
    if (list.some((binding) => normalizeBinding(binding) === normalized)) {
      return isShortcutActionId(action.id) ? action.id : null;
    }
  }
  return null;
}

/** 展示用文本：macOS 走 `⌘⇧Z`，其它平台走 `Ctrl+Shift+Z`。 */
export function formatShortcut(binding: string, options: ShortcutOptions = {}): string {
  const normalized = normalizeBinding(binding);
  if (!normalized) return "";
  const mac = resolveMac(options);
  const labels = mac ? MAC_MODIFIER_LABELS : PC_MODIFIER_LABELS;
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map((modifier) => labels[modifier] ?? modifier);
  const keyLabel = KEY_LABELS[key] ?? (key.length <= 2 ? key.toUpperCase() : key);
  return mac ? [...modifiers, keyLabel].join("") : [...modifiers, keyLabel].join("+");
}
