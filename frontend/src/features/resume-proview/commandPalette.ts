// SPDX-License-Identifier: Apache-2.0
/**
 * 命令面板的**纯逻辑**（D13）：过滤、方向键循环、最近使用。
 *
 * 组件（`components/resume/proview/CommandPalette.tsx`）只管渲染与键盘事件，
 * 这里保证这些规则可以脱离 React 单测：
 * - 搜索是"所有词都要命中"（空格分词），标签命中优先于关键词命中；
 * - ↑↓ 到两端回绕（面板里只有一列，回绕比卡住更好用）；
 * - 最近使用按 id 去重、最多 6 条、存 localStorage（偏好类数据，允许）。
 */
import type { ProviewCommand } from "./types";

/** 最近使用记录键（偏好；与正文/裁剪参数分开）。 */
export const RECENT_COMMANDS_KEY = "resume.proview.recent-commands.v1";
export const MAX_RECENT_COMMANDS = 6;

export interface RecentCommandsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): RecentCommandsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 归一化搜索词：小写、去首尾空白。 */
function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * 过滤命令。
 *
 * 命中规则：查询按空白分词，**每个词**都要出现在 label / id / keywords 任意一处；
 * 排序：label 以整句查询开头的最前，其余保持传进来的顺序（= 调用方给的优先级）。
 */
export function filterCommands(
  commands: readonly ProviewCommand[],
  query: string,
): ProviewCommand[] {
  const normalized = normalize(query);
  if (!normalized) return [...commands];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const scored: { command: ProviewCommand; startsWith: boolean }[] = [];
  for (const command of commands) {
    const haystack = normalize([command.label, command.id, ...(command.keywords ?? [])].join(" "));
    if (!tokens.every((token) => haystack.includes(token))) continue;
    scored.push({ command, startsWith: normalize(command.label).startsWith(normalized) });
  }
  return scored
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => {
      if (a.startsWith !== b.startsWith) return a.startsWith ? -1 : 1;
      return a.index - b.index;
    })
    .map((item) => item.command);
}

/** ↑↓ 在 0..count-1 之间循环；count 为 0 时返回 -1。 */
export function cycleActiveIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  const safe = current < 0 || current >= count ? (delta > 0 ? -1 : 0) : current;
  return (((safe + delta) % count) + count) % count;
}

/** 只保留仍然存在的命令 id（命令表会随宿主能力变化）。 */
export function pickKnownCommandIds(
  ids: readonly string[],
  commands: readonly ProviewCommand[],
): string[] {
  const known = new Set(commands.map((command) => command.id));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** 最近使用：读、按 id 去重、上限截断。 */
export function readRecentCommandIds(
  storage: RecentCommandsStorage | null = defaultStorage(),
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_COMMANDS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((item): item is string => typeof item === "string");
    return Array.from(new Set(ids)).slice(0, MAX_RECENT_COMMANDS);
  } catch {
    return [];
  }
}

/** 记录一次执行（已存在则提前）；落盘失败安静返回。 */
export function pushRecentCommandId(
  id: string,
  storage: RecentCommandsStorage | null = defaultStorage(),
): string[] {
  const next = [id, ...readRecentCommandIds(storage).filter((item) => item !== id)].slice(
    0,
    MAX_RECENT_COMMANDS,
  );
  if (storage) {
    try {
      storage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
    } catch {
      // 忽略：偏好存不下不是功能错误。
    }
  }
  return next;
}
