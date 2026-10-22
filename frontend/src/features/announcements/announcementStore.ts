// SPDX-License-Identifier: Apache-2.0
/**
 * 公告条的队列与订阅。
 *
 * 三条不可动摇的规则（它们决定了这个文件是不是"又一个全局状态"）：
 * 1. **唯一写入口是 `postAnnouncement()`**——没有 `setAnnouncements`，调用方改不了队列形状；
 * 2. **静音在读侧过滤**：公告是"已经发生的事实"，静音是"要不要展示"。若在写侧丢弃，
 *    用户在设置页恢复后就**必须等下一条新公告**才看得到效果，与"恢复后立刻出现"冲突；
 * 3. **已关闭记忆只存 `code + generation`**，正文一个字都不落盘。
 */
import { useSyncExternalStore } from "react";
import { isMuted } from "./announcementMute";
import type { AnnouncementCode } from "./announcementCodes";

export type AnnouncementSeverity = "warning" | "error";

export interface AnnouncementAction {
  /** 已 `t()` 的成品文案（≤6 字）。 */
  label: string;
  /** 站内路由目标；与 `onClick` 二选一。 */
  to?: string;
  onClick?: () => void;
}

export interface Announcement {
  code: AnnouncementCode;
  severity: AnnouncementSeverity;
  /** 已 `t()` 的成品文案，≤30 字。 */
  message: string;
  /** 最多 1 个动作。 */
  action?: AnnouncementAction;
  /** 抢占顺序：小者先显示，默认 100。 */
  priority?: number;
  /** 代次：同 code 但代次变了会重新显示（用户关过旧的，新的还要提醒）。 */
  generation?: string;
  /** 在这些路径前缀上不显示（如更新类公告不在 /settings 显示）。 */
  hideOnPaths?: readonly string[];
}

const DISMISS_KEY_PREFIX = "resumeforge.announcement.dismissed.";

let queue: readonly Announcement[] = [];
let snapshot: readonly Announcement[] = [];
const listeners = new Set<() => void>();

/**
 * 被静音项在**排序之前**剔除：它不许占用那唯一的显示位，否则"静音了还挡着下一条"。
 */
function computeSnapshot(): readonly Announcement[] {
  return queue.filter((item) => !isMuted(item.code));
}

function notify(): void {
  snapshot = computeSnapshot();
  for (const listener of listeners) listener();
}

export function postAnnouncement(announcement: Announcement): void {
  // 同 code 覆盖（更新类公告随版本号变化，不该在队列里堆两条）。
  queue = [...queue.filter((item) => item.code !== announcement.code), announcement];
  notify();
}

export function clearAnnouncement(code: AnnouncementCode): void {
  const next = queue.filter((item) => item.code !== code);
  if (next.length === queue.length) return;
  queue = next;
  notify();
}

/** 静音状态变了之后让读侧重算（恢复提醒要"立刻出现"，不能等下一条公告）。 */
export function notifyAnnouncements(): void {
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAnnouncements(): readonly Announcement[] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

function dismissKey(code: AnnouncementCode): string {
  return `${DISMISS_KEY_PREFIX}${code}`;
}

/** 这一代是否已经被关过。`generation` 变了就重新显示。 */
export function isDismissed(code: AnnouncementCode, generation?: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(dismissKey(code));
    if (stored === null) return false;
    return stored === (generation ?? "1");
  } catch {
    return false;
  }
}

export function dismissAnnouncement(code: AnnouncementCode, generation?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(dismissKey(code), generation ?? "1");
  } catch {
    // 存不上就只在本次会话里关掉（组件本地 state 已经把它藏起来了）。
  }
}

/** 只给测试用：把模块级队列清空，避免用例之间互相污染。 */
export function resetAnnouncementsForTest(): void {
  queue = [];
  snapshot = computeSnapshot();
  listeners.clear();
}
