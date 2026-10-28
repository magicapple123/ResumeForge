// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位优化建议生成的**模块级**状态：确认后生成 + 关了窗口/刷新页面也继续 + 可真取消。
 *
 * 执行已交给统一任务地基（`/ai-tasks`，kind=`resume_rewrite`），本文件只保留显示状态。
 * 与 `riskScanStore` 同构，两处差异：
 * 1. 结果是「建议列表」，不是扫描报告；
 * 2. 多一个 `clearSuggestionScan`——简历内容改过之后（弹窗的 `resetKey` 变化），旧建议
 *    必须整槽丢掉，否则用户会对着已经改掉的正文点「采纳」。
 *
 * **为什么"建议"是 AI 改写家族里唯一被任务化的那一支**：它读整份简历 + 岗位 + 资料、
 * 生成一列建议，通常 10–40 秒，结果能脱离编辑器单独取回；而逐句润色 / 翻译 / STAR 改写
 * 是 1–3 秒、且必须当场回填到用户正在编辑的那一栏——后台化的开销大于收益。
 *
 * 快照引用必须稳定：`useSyncExternalStore` 用 `Object.is` 比较前后值，每次返回新对象会被
 * 判成"一直在变"，组件无限重渲染。
 */
import { useSyncExternalStore } from "react";
import { t } from "../../i18n";
import type { ResumeSuggestions } from "../../types";
import {
  attachAiTaskUi,
  cancelAiTaskEntry,
  startAiTask,
  type StartedAiTask,
} from "../../utils/aiTaskEntry";
import { registerAiTaskResultSink } from "../../utils/aiTaskResultSink";
import { backgroundTaskKey } from "../../utils/backgroundTasks";

export type SuggestionScanStatus = "idle" | "scanning" | "done" | "error";

/** 本文件负责的任务类型（= 后端 `ai_task.kind`）。 */
const TASK_KIND = "resume_rewrite";

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
/** 每个 resumeId 当前任务的后端 id（取消要它）。 */
const taskIds = new Map<number, number>();
/** 每个 resumeId 当前的"弹窗在看"声明。 */
const detachers = new Map<number, () => void>();
/** 每个 resumeId 被几个界面挂着（计数，StrictMode 双挂载也不会算错）。 */
const attachedCounts = new Map<number, number>();
/** 已经交付过结果的 task id（刷新恢复 + 正常轮询可能各派发一次）。 */
const delivered = new Set<number>();
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

/** 这个简历的建议弹窗是否正开着（决定完成时是就地展示还是"叫住他"）。 */
export function isSuggestionPanelAttached(resumeId: number): boolean {
  return (attachedCounts.get(resumeId) ?? 0) > 0;
}

/** 结果交付：成功那一次（含刷新恢复后重放的那一次）从这里回到本 store。 */
registerAiTaskResultSink(TASK_KIND, (taskId, resultData) => {
  if (delivered.has(taskId)) return;
  delivered.add(taskId);
  const raw = resultData?.resume_id;
  const resumeId = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(resumeId) || resumeId <= 0) return;
  const suggestions = resultData?.suggestions;
  if (!Array.isArray(suggestions)) return;
  const previous = states.get(resumeId);
  taskIds.delete(resumeId);
  setState(resumeId, {
    status: "done",
    data: {
      job_id: Number(resultData?.job_id ?? 0),
      job_title: String(resultData?.job_title ?? ""),
      company: String(resultData?.company ?? ""),
      suggestions: suggestions as ResumeSuggestions["suggestions"],
    },
    startedAt: previous?.startedAt,
    finishedAt: Date.now(),
  });
});

/**
 * 发起一次生成。
 *
 * **重复发起只保留最新一次**：先取消上一次的任务，否则两次生成会并行烧模型。
 */
export function startSuggestionScan(resumeId: number): void {
  const previousTaskId = taskIds.get(resumeId);
  if (previousTaskId !== undefined) {
    taskIds.delete(resumeId);
    void cancelAiTaskEntry(backgroundTaskKey(TASK_KIND, previousTaskId));
  }

  const startedAt = Date.now();
  setState(resumeId, { status: "scanning", startedAt });

  void startAiTask({
    kind: TASK_KIND,
    payload: { resume_id: resumeId },
    label: t("backgroundTasks.aiTask.rewrite.label"),
    onFinished: (task) => {
      // 成功不走这里（建议由 sink 交回）：这里只收两种"没有结果要交回"的终态。
      if (task.status === "failed") {
        setState(resumeId, {
          status: "error",
          error: task.error || t("resumeSuggestions.generateFailed"),
          startedAt,
        });
      } else if (task.status === "cancelled") {
        setState(resumeId, { status: "idle" });
      }
      taskIds.delete(resumeId);
    },
  }).then(
    (started: StartedAiTask) => {
      if (states.get(resumeId)?.status === "scanning") taskIds.set(resumeId, started.id);
    },
    (error: unknown) => {
      setState(resumeId, {
        status: "error",
        error: error instanceof Error ? error.message : t("resumeSuggestions.generateFailed"),
        startedAt,
      });
    },
  );
}

/** 取消进行中的生成：**真的**让后端任务停下（不是只把自己标成已取消）。 */
export function cancelSuggestionScan(resumeId: number): void {
  const taskId = taskIds.get(resumeId);
  taskIds.delete(resumeId);
  if (taskId !== undefined) {
    void cancelAiTaskEntry(backgroundTaskKey(TASK_KIND, taskId));
  }
  setState(resumeId, { status: "idle" });
}

/**
 * 丢掉这一份简历的槽（含正在跑的任务）。
 *
 * 用于"简历内容改过了"：旧建议对应的是旧正文，继续展示只会误导用户去采纳。
 */
export function clearSuggestionScan(resumeId: number): void {
  const taskId = taskIds.get(resumeId);
  taskIds.delete(resumeId);
  if (taskId !== undefined) {
    // 先记成"已交付"再取消：取消与交付是并发的，迟到的成功派发绝不能把刚丢掉的槽
    // 又写回来（否则用户点「采纳」时对着的是改过的正文 + 旧建议）。
    delivered.add(taskId);
    void cancelAiTaskEntry(backgroundTaskKey(TASK_KIND, taskId));
  }
  detachers.get(resumeId)?.();
  detachers.delete(resumeId);
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
  const taskId = taskIds.get(resumeId);
  if (taskId !== undefined) {
    detachers.get(resumeId)?.();
    detachers.set(resumeId, attachAiTaskUi(backgroundTaskKey(TASK_KIND, taskId)));
  }
  emit();
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    const next = (attachedCounts.get(resumeId) ?? 1) - 1;
    if (next > 0) {
      attachedCounts.set(resumeId, next);
    } else {
      attachedCounts.delete(resumeId);
      detachers.get(resumeId)?.();
      detachers.delete(resumeId);
    }
    emit();
  };
}

/** 测试用：清空全部槽（不动订阅者，也不取消后端任务）。 */
export function resetSuggestionScan(): void {
  for (const detach of detachers.values()) detach();
  detachers.clear();
  taskIds.clear();
  delivered.clear();
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

/** 订阅**所有**槽（需要全量视图的调用方用）。 */
export function useSuggestionScanEntries(): SuggestionScanEntry[] {
  return useSyncExternalStore(
    subscribeSuggestionScan,
    getSuggestionScanEntries,
    getSuggestionScanEntries,
  );
}
