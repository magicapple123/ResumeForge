// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位解读生成的**模块级**状态机：可真取消、关了弹窗也继续、顶部任务条能追踪。
 *
 * 与 `features/resume/suggestionScanStore` 同构（同一套理由与写法），这里只有三处不同：
 * 1. 多一个 `background` 标记：用户把弹窗关掉了（但没取消），完成时应当改走统一通知；
 * 2. 多带 `title` / `company`：顶部任务条要能直接拼出「岗位解读 · 公司 · 岗位」；
 * 3. 取消是**真取消**（abort 请求）。岗位解读此前是"只关界面不断连接"，但那样一来
 *    用户点「取消」后服务端仍在烧 token，且界面永远回不到初始态——T1 起语义改成
 *    「取消 = 停掉本次生成，结果不保存」，「后台继续」才是原来那条路。
 *
 * 为什么不能用 `useApi`：它在组件卸载时 abort，而这里要求"关掉弹窗继续跑"，请求与
 * 状态必须活在模块级单例里，与任何组件生命周期无关。
 *
 * 快照引用必须稳定：`useSyncExternalStore` 用 `Object.is` 比较前后值，每次返回新对象会被
 * 判成"一直在变"，组件无限重渲染。
 */
import { useSyncExternalStore } from "react";
import { ApiError } from "../../api/client";
import { generateJobAnalysis } from "../../api/jobs";
import type { JobAnalysisResult } from "../../types";
import { announceBackgroundFailure, announceBackgroundResult } from "../../utils/backgroundTask";

export type JobAnalysisStatus = "idle" | "running" | "done" | "error";

export interface JobAnalysisState {
  status: JobAnalysisStatus;
  /** 岗位标题 / 公司：顶部任务条与完成通知都用它说明"这是哪一份解读"。 */
  title: string;
  company: string;
  /** 发起时间（毫秒时间戳）：弹窗与任务条用它算「已生成 N 秒」/「已运行 N 秒」。 */
  startedAt?: number;
  finishedAt?: number;
  /** 用户已经离开弹窗（关掉但没取消）：完成时改用统一通知，而不是往已关闭的弹窗回填。 */
  background: boolean;
  result?: JobAnalysisResult;
  generatedAt?: string | null;
  stale?: boolean;
  error?: string;
}

export interface JobAnalysisEntry {
  jobId: number;
  state: JobAnalysisState;
}

export interface StartJobAnalysisInput {
  jobId: number;
  title?: string;
  company?: string;
  /** 为真时绕过后端缓存重新生成（只有「重新生成」这条显式路径会传）。 */
  force?: boolean;
}

/** 所有槽共用的初始状态：**同一个对象**，保证没有记录时快照引用也稳定。 */
const IDLE_STATE: JobAnalysisState = Object.freeze({
  status: "idle",
  title: "",
  company: "",
  background: false,
});

const states = new Map<number, JobAnalysisState>();
/** 每个 jobId 当前请求的 controller：重复 start 要先把旧的 abort 掉。 */
const controllers = new Map<number, AbortController>();
const listeners = new Set<() => void>();

let cachedRunning: JobAnalysisEntry[] = [];
let runningDirty = false;

/** 取消已被用户点过、请求仍在收尾时不要把状态写回 error（取消不是失败）。 */
function setState(jobId: number, next: JobAnalysisState): void {
  states.set(jobId, next);
  emit();
}

function emit(): void {
  runningDirty = true;
  for (const listener of listeners) listener();
}

/** 订阅任意槽的变化；返回取消订阅函数。 */
export function subscribeJobAnalysis(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 单个槽的快照（没有记录时返回共享的 IDLE 对象，引用稳定）。 */
export function getJobAnalysisState(jobId: number | null): JobAnalysisState {
  if (jobId === null) return IDLE_STATE;
  return states.get(jobId) ?? IDLE_STATE;
}

/** 正在跑的槽的快照（引用稳定：内容没变就复用上一次的数组）。 */
export function getRunningJobAnalyses(): JobAnalysisEntry[] {
  if (runningDirty) {
    cachedRunning = [...states.entries()]
      .filter(([, state]) => state.status === "running")
      .map(([jobId, state]) => ({ jobId, state }));
    runningDirty = false;
  }
  return cachedRunning;
}

/**
 * 发起一次生成。**重复调用只保留最新一次**：先 abort 旧请求，再建新 controller。
 *
 * 旧请求被 abort 后仍会 reject 一个 `cancelled` 的 ApiError——那时 controller 已经不是
 * 当前那个，回调据此直接丢弃，避免"旧结果覆盖新结果"。
 */
export function startJobAnalysis({
  jobId,
  title = "",
  company = "",
  force = false,
}: StartJobAnalysisInput): void {
  controllers.get(jobId)?.abort();
  const controller = new AbortController();
  controllers.set(jobId, controller);

  const startedAt = Date.now();
  setState(jobId, { status: "running", title, company, startedAt, background: false });

  const isCurrent = () => controllers.get(jobId) === controller;
  generateJobAnalysis(jobId, controller.signal, force).then(
    (result) => {
      if (!isCurrent()) return;
      controllers.delete(jobId);
      const previous = states.get(jobId);
      setState(jobId, {
        status: "done",
        title: previous?.title ?? title,
        company: previous?.company ?? company,
        startedAt,
        finishedAt: Date.now(),
        background: previous?.background ?? false,
        result,
        generatedAt: new Date().toISOString(),
        stale: false,
      });
      // 用户已经走了：弹窗不再回填，改用统一通知（弹窗 + 提示音），否则他回来什么也看不到。
      if (previous?.background) {
        announceBackgroundResult("岗位解读", "回到岗位详情再点「岗位需求解读」即可看到。");
      }
    },
    (error: unknown) => {
      if (!isCurrent()) return;
      controllers.delete(jobId);
      const previous = states.get(jobId);
      // 取消不是错误：cancelJobAnalysis 已经把状态写成 idle，这里绝不能再写 error。
      if (error instanceof ApiError && error.code === "cancelled") return;
      const detail = error instanceof Error ? error.message : "生成岗位解读失败，请稍后重试";
      setState(jobId, {
        status: "error",
        title: previous?.title ?? title,
        company: previous?.company ?? company,
        startedAt,
        background: previous?.background ?? false,
        error: detail,
      });
      if (previous?.background) announceBackgroundFailure("岗位解读", detail);
    },
  );
}

/** 取消进行中的生成：abort 请求并把状态退回 idle（不留 error，也不保留结果）。 */
export function cancelJobAnalysis(jobId: number): void {
  const controller = controllers.get(jobId);
  const previous = states.get(jobId);
  if (controller) {
    controllers.delete(jobId);
    controller.abort();
  }
  setState(jobId, {
    status: "idle",
    title: previous?.title ?? "",
    company: previous?.company ?? "",
    background: false,
  });
}

/**
 * 声明"用户已经离开这个弹窗，但任务继续跑"：完成时改走统一通知。
 *
 * 只在 running 时生效——已经结束的任务没有"要不要通知"的问题，重复 detach 也不该改写状态。
 */
export function detachJobAnalysis(jobId: number): void {
  const previous = states.get(jobId);
  if (!previous || previous.status !== "running" || previous.background) return;
  setState(jobId, { ...previous, background: true });
}

/** 弹窗重新打开了（有人在看）：完成时就地回填，不再弹全局通知。 */
export function attachJobAnalysis(jobId: number): void {
  const previous = states.get(jobId);
  if (!previous || !previous.background) return;
  setState(jobId, { ...previous, background: false });
}

/** 测试用：清空全部槽（不动订阅者）。 */
export function resetJobAnalysisStoreForTests(): void {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  states.clear();
  emit();
}

/** 订阅某一份岗位的解读状态（弹窗用）。 */
export function useJobAnalysis(jobId: number | null): JobAnalysisState {
  return useSyncExternalStore(
    subscribeJobAnalysis,
    () => getJobAnalysisState(jobId),
    () => getJobAnalysisState(jobId),
  );
}

/** 订阅**正在跑**的解读（顶部任务条与页头计数用）。 */
export function useRunningJobAnalyses(): JobAnalysisEntry[] {
  return useSyncExternalStore(subscribeJobAnalysis, getRunningJobAnalyses, getRunningJobAnalyses);
}
