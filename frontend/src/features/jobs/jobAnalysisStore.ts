// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位解读生成的**模块级**状态：可真取消、关了弹窗/刷新页面都继续、页头任务条能追踪。
 *
 * 这一版把**执行**交给了统一任务地基（`/ai-tasks` + `utils/backgroundTasks`）：本文件只剩
 * "这个岗位的解读现在是什么状态"这份显示状态。这么切分是因为执行侧要回答的问题
 * （关页面还在跑吗、刷新后怎么恢复、取消能不能真停、完成提醒从哪个出口发）对所有 AI
 * 入口都是同一套答案——各写一份就是"有的地方响、有的地方不响"的来源。
 *
 * 三条路径分工：
 * - **发起**：`startAiTask`（建任务 + 登记轮询）→ 本文件写 `running`；
 * - **成功**：结果由 `aiTaskResultSink` 交回（刷新恢复时也走这条），这里再去读一次
 *   服务端缓存并写 `done`——岗位解读的结果留在 `job.analysis_cache` 里，不重复传；
 * - **失败 / 取消**：`onFinished` 里收尾（这两种没有结果要交回）。
 *
 * 快照引用必须稳定：`useSyncExternalStore` 用 `Object.is` 比较前后值，每次返回新对象会被
 * 判成"一直在变"，组件无限重渲染。
 */
import { useSyncExternalStore } from "react";
import { t } from "../../i18n";
import type { JobAnalysisResult } from "../../types";
import {
  attachAiTaskUi,
  cancelAiTaskEntry,
  startAiTask,
  type StartedAiTask,
} from "../../utils/aiTaskEntry";
import { registerAiTaskResultSink } from "../../utils/aiTaskResultSink";
import { backgroundTaskKey } from "../../utils/backgroundTasks";

export type JobAnalysisStatus = "idle" | "running" | "done" | "error";

/** 本文件负责的任务类型（= 后端 `ai_task.kind`）。 */
const TASK_KIND = "job_analysis";

export interface JobAnalysisState {
  status: JobAnalysisStatus;
  /** 岗位标题 / 公司：顶部任务条与完成通知都用它说明"这是哪一份解读"。 */
  title: string;
  company: string;
  /** 发起时间（毫秒时间戳）：弹窗与任务条用它算「已运行 N 秒」。 */
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
/** 每个 jobId 当前任务的后端 id（取消要它；取消的是**任务**，不是一条本地请求）。 */
const taskIds = new Map<number, number>();
/** 每个 jobId 当前的"有人在看"声明（重新 attach 前要先释放上一个）。 */
const detachers = new Map<number, () => void>();
/** 已经交付过结果的 task id：同一任务在刷新恢复 + 正常轮询下可能被派发两次。 */
const delivered = new Set<number>();
const listeners = new Set<() => void>();

let cachedRunning: JobAnalysisEntry[] = [];
let runningDirty = false;

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

/** 任务标签（页头任务面板与完成通知都用它说明"这是哪一份解读"）。 */
function taskLabel(title: string, company: string): string {
  return [t("backgroundTasks.jobAnalysis.label"), company, title].filter(Boolean).join(" · ");
}

// 结果交付：成功那一次（含刷新恢复后重放的那一次）从这里回到本 store。
//
// 结论随 `result_ref` 一起回来（服务端缓存仍是一份，这里只是顺路带一次）：这样"用户
// 关掉弹窗、甚至刷新过页面"时也能把结果填进槽，而不必在完成后再读一次缓存——那一次
// 读失败会变成"任务成功但界面报错"这种自相矛盾的状态。
registerAiTaskResultSink(TASK_KIND, (taskId, resultData) => {
  if (delivered.has(taskId)) return;
  delivered.add(taskId);
  const raw = resultData?.job_id;
  const jobId = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(jobId) || jobId <= 0) return;
  const analysis = resultData?.analysis;
  if (!analysis || typeof analysis !== "object") return;
  const previous = states.get(jobId);
  taskIds.delete(jobId);
  setState(jobId, {
    status: "done",
    title: previous?.title ?? "",
    company: previous?.company ?? "",
    startedAt: previous?.startedAt,
    finishedAt: Date.now(),
    background: previous?.background ?? false,
    result: analysis as unknown as JobAnalysisResult,
    generatedAt: new Date().toISOString(),
    stale: false,
  });
});

/**
 * 发起一次生成。
 *
 * **重复发起只保留最新一次**：先把上一次的任务取消掉，否则两个任务会同时烧 token。
 */
export function startJobAnalysis({
  jobId,
  title = "",
  company = "",
  force = false,
}: StartJobAnalysisInput): void {
  const previousTaskId = taskIds.get(jobId);
  if (previousTaskId !== undefined) {
    taskIds.delete(jobId);
    void cancelAiTaskEntry(backgroundTaskKey(TASK_KIND, previousTaskId));
  }
  detachers.get(jobId)?.();
  detachers.delete(jobId);

  const startedAt = Date.now();
  setState(jobId, { status: "running", title, company, startedAt, background: false });

  void startAiTask({
    kind: TASK_KIND,
    payload: { job_id: jobId, force },
    label: taskLabel(title, company),
    onFinished: (task) => {
      // 成功不走这里（结果由 sink 交回）：这里只收"没有结果要交回"的两种终态。
      if (task.status === "failed") {
        const previous = states.get(jobId);
        setState(jobId, {
          status: "error",
          title: previous?.title ?? title,
          company: previous?.company ?? company,
          startedAt,
          background: previous?.background ?? false,
          error: task.error || t("backgroundTasks.jobAnalysis.stateFailed"),
        });
      } else if (task.status === "cancelled") {
        // 取消不是错误：退回 idle，不留 error，也不留半截结果。
        const previous = states.get(jobId);
        setState(jobId, {
          status: "idle",
          title: previous?.title ?? title,
          company: previous?.company ?? company,
          background: false,
        });
      }
      taskIds.delete(jobId);
    },
  }).then(
    (started: StartedAiTask) => {
      // 任务可能已经结束得很早（缓存命中）：别用已经过期的 id 覆盖掉终态。
      if (states.get(jobId)?.status === "running") taskIds.set(jobId, started.id);
    },
    (error: unknown) => {
      // 建任务就失败（后端未就绪 / 数据集正在切换）：直接落 error，别让界面一直转。
      const previous = states.get(jobId);
      setState(jobId, {
        status: "error",
        title: previous?.title ?? title,
        company: previous?.company ?? company,
        startedAt,
        background: false,
        error:
          error instanceof Error ? error.message : t("backgroundTasks.jobAnalysis.stateFailed"),
      });
    },
  );
}

/** 取消进行中的生成：**真的**让后端任务停下（不是只把自己标成已取消）。 */
export function cancelJobAnalysis(jobId: number): void {
  const taskId = taskIds.get(jobId);
  taskIds.delete(jobId);
  detachers.get(jobId)?.();
  detachers.delete(jobId);
  if (taskId !== undefined) {
    void cancelAiTaskEntry(backgroundTaskKey(TASK_KIND, taskId));
  }
  const previous = states.get(jobId);
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
 * 只在 running 时生效——已经结束的任务没有"要不要通知"的问题。
 */
export function detachJobAnalysis(jobId: number): void {
  detachers.get(jobId)?.();
  detachers.delete(jobId);
  const previous = states.get(jobId);
  if (!previous || previous.status !== "running" || previous.background) return;
  setState(jobId, { ...previous, background: true });
}

/** 弹窗重新打开了（有人在看）：完成时就地回填，不再弹全局通知。 */
export function attachJobAnalysis(jobId: number): void {
  const previous = states.get(jobId);
  const taskId = taskIds.get(jobId);
  if (!previous || previous.status !== "running" || taskId === undefined) return;
  detachers.get(jobId)?.();
  detachers.set(jobId, attachAiTaskUi(backgroundTaskKey(TASK_KIND, taskId)));
  if (previous.background) setState(jobId, { ...previous, background: false });
}

/** 测试用：清空全部槽（不动订阅者，也不取消后端任务）。 */
export function resetJobAnalysisStoreForTests(): void {
  for (const detach of detachers.values()) detach();
  detachers.clear();
  taskIds.clear();
  delivered.clear();
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

/** 订阅**正在跑**的解读（页头计数用；常驻任务条改从统一登记表取）。 */
export function useRunningJobAnalyses(): JobAnalysisEntry[] {
  return useSyncExternalStore(subscribeJobAnalysis, getRunningJobAnalyses, getRunningJobAnalyses);
}
