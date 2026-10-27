// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位优化建议生成的**模块级**状态机：确认后生成 + 关了窗口也继续 + 可取消。
 *
 * 与 `riskScanStore` 同构（同一套理由），差别只有两处：
 * 1. 结果是「建议列表」（`data`），不是扫描报告；
 * 2. 多一个 `clearSuggestionScan`——简历内容被改过之后（弹窗的 `resetKey` 变化），
 *    旧建议必须整槽丢掉，否则用户会对着已经改掉的正文点「采纳」。
 *
 * 为什么不能用 `useApi`：它在组件卸载时 abort。这里的弹窗允许"关掉窗口继续生成"，
 * 请求与状态必须活在模块级单例里，与任何组件生命周期无关。
 *
 * 快照引用必须稳定：`useSyncExternalStore` 用 `Object.is` 比较前后值，每次返回新对象会被
 * 判成"一直在变"，组件无限重渲染（backgroundTasks 里真实踩过一次）。
 */
import { useSyncExternalStore } from "react";
import { ApiError } from "../../api/client";
import { generateResumeSuggestions } from "../../api/resumes";
import { t } from "../../i18n";
import type { ResumeSuggestions } from "../../types";

export type SuggestionScanStatus = "idle" | "scanning" | "done" | "error";

export interface SuggestionScanState {
  status: SuggestionScanStatus;
  data?: ResumeSuggestions;
  error?: string;
  /** 发起时间（毫秒时间戳）：弹窗用它算「已用时」。 */
  startedAt?: number;
  /** 结束时间（毫秒时间戳）。 */
  finishedAt?: number;
}

/** 所有槽共用的初始状态：**同一个对象**，保证没有记录时快照引用也稳定。 */
const IDLE_STATE: SuggestionScanState = Object.freeze({ status: "idle" });

const states = new Map<number, SuggestionScanState>();
/** 每个 resumeId 当前请求的 controller：重复 start 要先把旧的 abort 掉。 */
const controllers = new Map<number, AbortController>();
/** 每个 resumeId 被几个界面挂着（计数，StrictMode 双挂载也不会算错）。 */
const attachedCounts = new Map<number, number>();
const listeners = new Set<() => void>();

let cachedEntries: SuggestionScanEntry[] = [];
let entriesDirty = false;

export interface SuggestionScanEntry {
  resumeId: number;
  state: SuggestionScanState;
}

function setState(resumeId: number, next: SuggestionScanState): void {
  states.set(resumeId, next);
  emit();
}

function emit(): void {
  entriesDirty = true;
  for (const listener of listeners) listener();
}

/** 订阅任意槽的变化；返回取消订阅函数。 */
export function subscribeSuggestionScan(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 单个槽的快照（没有记录时返回共享的 IDLE 对象，引用稳定）。 */
export function getSuggestionScanState(resumeId: number): SuggestionScanState {
  return states.get(resumeId) ?? IDLE_STATE;
}

/** 所有槽的快照（引用稳定：内容没变就复用上一次的数组）。 */
export function getSuggestionScanEntries(): SuggestionScanEntry[] {
  if (entriesDirty) {
    cachedEntries = [...states.entries()].map(([resumeId, state]) => ({ resumeId, state }));
    entriesDirty = false;
  }
  return cachedEntries;
}

/** 这个简历的建议弹窗是否正开着（决定完成时是就地展示还是弹全局通知）。 */
export function isSuggestionPanelAttached(resumeId: number): boolean {
  return (attachedCounts.get(resumeId) ?? 0) > 0;
}

/**
 * 发起一次生成。**重复调用只保留最新一次**：先 abort 旧请求，再建新 controller。
 *
 * 旧请求被 abort 后仍会 reject 一个 `cancelled` 的 ApiError——那时 controller 已经不是
 * 当前的那个，回调里据此直接丢弃，避免"旧结果覆盖新结果"。
 */
export function startSuggestionScan(resumeId: number): void {
  controllers.get(resumeId)?.abort();
  const controller = new AbortController();
  controllers.set(resumeId, controller);

  const startedAt = Date.now();
  setState(resumeId, { status: "scanning", startedAt });

  const isCurrent = () => controllers.get(resumeId) === controller;
  generateResumeSuggestions(resumeId, controller.signal).then(
    (data) => {
      if (!isCurrent()) return;
      controllers.delete(resumeId);
      setState(resumeId, { status: "done", data, startedAt, finishedAt: Date.now() });
    },
    (error: unknown) => {
      if (!isCurrent()) return;
      controllers.delete(resumeId);
      // 取消不是错误：cancelSuggestionScan 已经把状态写成 idle，这里绝不能再写 error。
      if (error instanceof ApiError && error.code === "cancelled") return;
      setState(resumeId, {
        status: "error",
        error: error instanceof Error ? error.message : t("resumeSuggestions.generateFailed"),
        startedAt,
      });
    },
  );
}

/** 取消进行中的生成：abort 请求并把状态退回 idle（不留 error）。 */
export function cancelSuggestionScan(resumeId: number): void {
  const controller = controllers.get(resumeId);
  if (!controller) return;
  controllers.delete(resumeId);
  controller.abort();
  setState(resumeId, { status: "idle" });
}

/**
 * 丢掉这一份简历的槽（含正在跑的请求）。
 *
 * 用于"简历内容改过了"：旧建议对应的是旧正文，继续展示只会误导用户去采纳。
 */
export function clearSuggestionScan(resumeId: number): void {
  const controller = controllers.get(resumeId);
  if (controller) {
    controllers.delete(resumeId);
    controller.abort();
  }
  if (!states.delete(resumeId)) return;
  emit();
}

/**
 * 声明"这个简历的建议弹窗正开着"，返回 detach。
 *
 * 用计数而不是布尔：React StrictMode 下同一个弹窗会挂载两次，布尔标记在第一次清理时
 * 就被清掉，会导致"弹窗明明开着却弹出全局通知"。
 */
export function markSuggestionPanelAttached(resumeId: number): () => void {
  attachedCounts.set(resumeId, (attachedCounts.get(resumeId) ?? 0) + 1);
  emit();
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    const next = (attachedCounts.get(resumeId) ?? 1) - 1;
    if (next > 0) attachedCounts.set(resumeId, next);
    else attachedCounts.delete(resumeId);
    emit();
  };
}

/** 测试用：清空全部槽（不动订阅者）。 */
export function resetSuggestionScan(): void {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  states.clear();
  attachedCounts.clear();
  emit();
}

/** 订阅某一份简历的生成状态（弹窗用）。 */
export function useSuggestionScan(resumeId: number): SuggestionScanState {
  return useSyncExternalStore(
    subscribeSuggestionScan,
    () => getSuggestionScanState(resumeId),
    () => getSuggestionScanState(resumeId),
  );
}

/** 订阅**所有**槽（全局 watcher 用：它要把每一份简历的通知都接住）。 */
export function useSuggestionScanEntries(): SuggestionScanEntry[] {
  return useSyncExternalStore(
    subscribeSuggestionScan,
    getSuggestionScanEntries,
    getSuggestionScanEntries,
  );
}
