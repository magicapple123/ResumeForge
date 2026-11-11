// SPDX-License-Identifier: Apache-2.0
/**
 * 投投「页面感知」注册表（#27B）。
 *
 * ## 设计
 *
 * 每个页面（或页面里的某个特性）挂载时调用
 * `registerTouTouContext({ id, titleKey, actions, signals })` 登记"我这一页能做什么、
 * 现在有什么问题"，卸载时调用返回的函数注销。球只在 `signals` 非空时才 pulse——
 * 这直接替换掉了旧的 8 条轮播标语与 120s 定时器：从"按定时器播广告"变成"有事才说话"。
 *
 * ## 为什么是注册表而不是 props
 *
 * 投投挂在 `AppShell` 上，页面在 `<Outlet />` 里，中间没有共享 props 链；而页面本身
 * 也不该为了一个悬浮球改签名。模块级注册表 + `useSyncExternalStore` 与仓库里
 * `workbenchLayoutStore` / `paginationReportStore` 是同一套做法。
 *
 * ## 合并规则
 *
 * 多个注册方可以同时存在（页面 + 页面里的某个特性）。合并时：
 * - `titleKey`：后注册的覆盖先注册的（页面详情比路由默认值更准）；
 * - `actions` / `signals`：按 id 去重、保持注册顺序。
 *
 * 同一个 `id` 重复注册（StrictMode 双挂载、页面重渲染）按"覆盖"处理，不会越积越多。
 */
import { useSyncExternalStore } from "react";
import type { MessageKey } from "../../i18n";

/** 页面信号种类。#27B 的首批四类，来自详册的四个例子；新增种类要同时给文案 key。 */
export type TouTouSignalKind =
  "layout-overflow" | "queue-unsupported" | "profile-missing-fields" | "resume-unsaved";

export interface TouTouSignal {
  /** 稳定 id：同一条信号重新上报时靠它去重（例如拖滑杆每次测量都会重算）。 */
  id: string;
  kind: TouTouSignalKind;
  /** 条数 / 页数等数字，进文案占位符。 */
  count?: number;
  messageKey: MessageKey;
  params?: Record<string, string | number>;
  /** 点「处理一下」时执行的动作 id（见 `touTouActions`）。 */
  actionId?: string;
  /**
   * `false` = 只 pulse、不出气泡。用于"页面上已经有常驻载体"的信号
   * （例如资料保存卡已经把「未保存」写在球旁边了，再弹一条气泡只是噪音）。
   */
  announce?: boolean;
}

export interface TouTouAction {
  id: string;
  labelKey: MessageKey;
}

export interface TouTouPageContext {
  titleKey: MessageKey | null;
  actions: readonly TouTouAction[];
  signals: readonly TouTouSignal[];
}

export interface TouTouContextRegistration {
  /** 注册方 id（页面名 / 特性名）。同 id 覆盖。 */
  id: string;
  titleKey?: MessageKey;
  actions?: readonly TouTouAction[];
  signals?: readonly TouTouSignal[];
}

const EMPTY: TouTouPageContext = { titleKey: null, actions: [], signals: [] };

const contributions = new Map<string, TouTouContextRegistration>();
const listeners = new Set<() => void>();
let snapshot: TouTouPageContext = EMPTY;

function dedupeById<T extends { id: string }>(groups: readonly (readonly T[])[]): T[] {
  const seen = new Map<string, T>();
  for (const group of groups) {
    for (const item of group) {
      // 后出现的同 id 覆盖先出现的：页面自己的动作优先于路由目录的默认动作。
      if (seen.has(item.id)) seen.delete(item.id);
      seen.set(item.id, item);
    }
  }
  return Array.from(seen.values());
}

/** 把若干份上下文合并成一份（纯函数：注册表与路由目录共用同一套规则）。 */
export function mergeTouTouPageContexts(
  contexts: readonly (Partial<TouTouPageContext> | null | undefined)[],
): TouTouPageContext {
  let titleKey: MessageKey | null = null;
  const actionGroups: (readonly TouTouAction[])[] = [];
  const signalGroups: (readonly TouTouSignal[])[] = [];
  for (const context of contexts) {
    if (!context) continue;
    if (context.titleKey) titleKey = context.titleKey;
    if (context.actions) actionGroups.push(context.actions);
    if (context.signals) signalGroups.push(context.signals);
  }
  return {
    titleKey,
    actions: dedupeById(actionGroups),
    signals: dedupeById(signalGroups),
  };
}

function rebuild(): void {
  snapshot = mergeTouTouPageContexts(Array.from(contributions.values()));
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): TouTouPageContext {
  return snapshot;
}

/**
 * 登记一份页面上下文，返回注销函数。
 *
 * 调用方应在 `useEffect` 里注册并在 cleanup 里注销：注册表是模块级单例，
 * 泄漏的注册会让离开页面之后球仍然 pulse。
 */
export function registerTouTouContext(registration: TouTouContextRegistration): () => void {
  contributions.set(registration.id, registration);
  rebuild();
  return () => {
    // 只删自己那一份：同一 id 被新注册覆盖时，旧 cleanup 不能把新注册一起删掉。
    if (contributions.get(registration.id) !== registration) return;
    contributions.delete(registration.id);
    rebuild();
  };
}

/**
 * 只更新信号（保留该注册方已有的 title/actions）。
 *
 * 测量类信号（溢出页数、缺字段条数）是"每次测量重算"的，用这个可以避免每次重建整份
 * 注册；没有对应 id 时等同一次只带 signals 的注册。
 */
export function setTouTouSignals(id: string, signals: readonly TouTouSignal[]): void {
  const existing = contributions.get(id);
  if (existing && existing.signals === signals) return;
  contributions.set(id, { ...existing, id, signals });
  rebuild();
}

/** 当前合并后的页面上下文（非 React 环境也能读，测试与日志用）。 */
export function getTouTouPageContext(): TouTouPageContext {
  return snapshot;
}

/** 订阅注册表合并后的上下文（不含路由级默认值；组合见 `useTouTouPageContext`）。 */
export function useRegisteredTouTouContext(): TouTouPageContext {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 测试清理：清空所有注册（与其它 store 的 `reset*` 成对使用）。 */
export function resetTouTouContextRegistry(): void {
  contributions.clear();
  rebuild();
}

export const EMPTY_TOU_TOU_PAGE_CONTEXT = EMPTY;
