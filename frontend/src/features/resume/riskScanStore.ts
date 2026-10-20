// SPDX-License-Identifier: Apache-2.0
/**
 * 风险扫描的**模块级**状态机：让「关了窗口也继续扫」这件事真的有结果。
 *
 * 为什么不能用 `useApi`：它在组件卸载时就 abort（AGENTS/交接书里的已知坑）。风险扫描
 * 可能跑十几秒，用户在等的时候会去翻别的页面——组件一卸载请求就没了，而界面上"扫描会在
 * 后台继续"这句话就成了空话。所以请求与状态放在模块级单例里，与任何组件生命周期无关。
 *
 * 每个 `resumeId` 一个槽：
 * - `idle/error` → 面板显示说明卡（重新扫描 / 重试）；
 * - `scanning` → 面板显示进度；**离开面板时**由 `RiskScanWatcher` 用全局通知接替提示；
 * - `done` → 结果 + 扫描元信息（时间/耗时/是否含模型增强）+ 签名对比。
 *
 * 快照引用必须稳定：`useSyncExternalStore` 用 `Object.is` 比较前后值，每次返回新对象会被
 * 判成"一直在变"，组件会无限重渲染（backgroundTasks 里真实踩过一次）。
 */
import { useSyncExternalStore } from "react";
import { ApiError } from "../../api/client";
import { scanResumeRisks } from "../../api/resumeRisk";
import type { ResumeRiskScan } from "../../types/resumeRisk";

export type RiskScanStatus = "idle" | "scanning" | "done" | "error";

export interface RiskScanState {
  status: RiskScanStatus;
  result?: ResumeRiskScan;
  error?: string;
  /** 发起时间（毫秒时间戳）：面板用它算「已用时」。 */
  startedAt?: number;
  /** 结束时间（毫秒时间戳）：面板用它算「用时」。 */
  finishedAt?: number;
  /** 发起时的简历内容签名：与当前内容不一致时提示「建议重新扫描」。 */
  signature?: string;
  /** 本次是否请求了模型增强（结果里也有 llm_used，这里记的是"用户选的"）。 */
  enhance?: boolean;
}

/** 所有槽共用的初始状态：**同一个对象**，保证没有记录时快照引用也稳定。 */
const IDLE_STATE: RiskScanState = Object.freeze({ status: "idle" });

const states = new Map<number, RiskScanState>();
/** 每个 resumeId 当前请求的 controller：重复 start 要先把旧的 abort 掉。 */
const controllers = new Map<number, AbortController>();
/** 每个 resumeId 被几个面板挂着（计数，StrictMode 双挂载也不会算错）。 */
const attachedCounts = new Map<number, number>();
const listeners = new Set<() => void>();

/** 批量快照（给全局 watcher 用）。与 states 同步维护，但只在变化时重建数组。 */
let cachedEntries: RiskScanEntry[] = [];
let entriesDirty = false;

export interface RiskScanEntry {
  resumeId: number;
  state: RiskScanState;
}

function setState(resumeId: number, next: RiskScanState): void {
  states.set(resumeId, next);
  emit();
}

function emit(): void {
  entriesDirty = true;
  for (const listener of listeners) listener();
}

/** 订阅任意槽的变化；返回取消订阅函数。 */
export function subscribeRiskScan(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 单个槽的快照（没有记录时返回共享的 IDLE 对象，引用稳定）。 */
export function getRiskScanState(resumeId: number): RiskScanState {
  return states.get(resumeId) ?? IDLE_STATE;
}

/** 所有槽的快照（引用稳定：内容没变就复用上一次的数组）。 */
export function getRiskScanEntries(): RiskScanEntry[] {
  if (entriesDirty) {
    cachedEntries = [...states.entries()].map(([resumeId, state]) => ({ resumeId, state }));
    entriesDirty = false;
  }
  return cachedEntries;
}

/** 这个简历的风险面板是否正被挂载（决定完成时是就地展示还是弹全局通知）。 */
export function isRiskPanelAttached(resumeId: number): boolean {
  return (attachedCounts.get(resumeId) ?? 0) > 0;
}

/**
 * 发起一次扫描。**重复调用只保留最新一次**：先 abort 旧请求，再建新 controller。
 *
 * 旧请求被 abort 后仍会 reject 一个 `cancelled` 的 ApiError——那时 controller 已经不是
 * 当前的那个，回调里据此直接丢弃，避免"旧结果覆盖新结果"。
 */
export function startRiskScan(
  resumeId: number,
  opts: { enhance: boolean; signature?: string },
): void {
  controllers.get(resumeId)?.abort();
  const controller = new AbortController();
  controllers.set(resumeId, controller);

  const startedAt = Date.now();
  setState(resumeId, {
    status: "scanning",
    startedAt,
    signature: opts.signature,
    enhance: opts.enhance,
  });

  const isCurrent = () => controllers.get(resumeId) === controller;
  scanResumeRisks(resumeId, opts.enhance, controller.signal).then(
    (result) => {
      if (!isCurrent()) return;
      controllers.delete(resumeId);
      setState(resumeId, {
        status: "done",
        result,
        startedAt,
        finishedAt: Date.now(),
        signature: opts.signature,
        enhance: opts.enhance,
      });
    },
    (error: unknown) => {
      if (!isCurrent()) return;
      controllers.delete(resumeId);
      // 取消不是错误：cancelRiskScan 已经把状态写成 idle，这里绝不能再写 error。
      if (error instanceof ApiError && error.code === "cancelled") return;
      setState(resumeId, {
        status: "error",
        error: error instanceof Error ? error.message : "风险扫描失败，请重试",
        startedAt,
        signature: opts.signature,
        enhance: opts.enhance,
      });
    },
  );
}

/** 取消进行中的扫描：abort 请求并把状态退回 idle（不留 error）。 */
export function cancelRiskScan(resumeId: number): void {
  const controller = controllers.get(resumeId);
  if (!controller) return;
  controllers.delete(resumeId);
  controller.abort();
  setState(resumeId, { status: "idle" });
}

/**
 * 声明"这个简历的风险面板正开着"，返回 detach。
 *
 * 用计数而不是布尔：React StrictMode 下同一个面板会挂载两次，布尔标记在第一次清理时
 * 就被清掉，会导致"面板明明开着却弹出全局通知"。
 */
export function markRiskPanelAttached(resumeId: number): () => void {
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
export function resetRiskScanStore(): void {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  states.clear();
  attachedCounts.clear();
  emit();
}

/** 订阅某一份简历的扫描状态（面板用）。 */
export function useRiskScan(resumeId: number): RiskScanState {
  return useSyncExternalStore(
    subscribeRiskScan,
    () => getRiskScanState(resumeId),
    () => getRiskScanState(resumeId),
  );
}

/** 订阅**所有**槽（全局 watcher 用：它要把每一份简历的通知都接住）。 */
export function useRiskScanEntries(): RiskScanEntry[] {
  return useSyncExternalStore(subscribeRiskScan, getRiskScanEntries, getRiskScanEntries);
}
