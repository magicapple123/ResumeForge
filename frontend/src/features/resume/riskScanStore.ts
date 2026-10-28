// SPDX-License-Identifier: Apache-2.0
/**
 * 风险扫描的**模块级**状态：让「关了窗口 / 刷新页面也继续扫」这件事真的有结果。
 *
 * 执行已交给统一任务地基（`/ai-tasks`，kind=`resume_risk`）：本文件只回答"这份简历的风险
 * 扫描现在是什么状态"。理由与 `features/jobs/jobAnalysisStore` 同源——"关页面还在跑吗、
 * 刷新怎么恢复、取消能不能真停、提醒从哪个出口发"对所有 AI 入口是同一套答案。
 *
 * 与岗位解读的唯一实质差异：**扫描报告没有业务表**（它是即时诊断，不该入库），所以报告
 * 随任务的 `result_ref` 回来，由 `aiTaskResultSink` 交回本文件。刷新后任务若已完成，
 * 恢复流程会重放这次交付，于是面板一打开就是上次那份报告，不必再烧一次模型。
 *
 * 每个 `resumeId` 一个槽：
 * - `idle/error` → 面板显示说明卡（重新扫描 / 重试）；
 * - `scanning` → 面板显示进度；**离开面板时**由页头任务面板 / 常驻任务条接替提示；
 * - `done` → 结果 + 扫描元信息（时间/耗时/是否含模型增强）+ 签名对比。
 *
 * 快照引用必须稳定：`useSyncExternalStore` 用 `Object.is` 比较前后值，每次返回新对象会被
 * 判成"一直在变"，组件会无限重渲染。
 */
import { useSyncExternalStore } from "react";
import { t } from "../../i18n";
import type { ResumeRiskScan } from "../../types/resumeRisk";
import {
  attachAiTaskUi,
  cancelAiTaskEntry,
  startAiTask,
  type StartedAiTask,
} from "../../utils/aiTaskEntry";
import { registerAiTaskResultSink } from "../../utils/aiTaskResultSink";
import { backgroundTaskKey } from "../../utils/backgroundTasks";

export type RiskScanStatus = "idle" | "scanning" | "done" | "error";

/** 本文件负责的任务类型（= 后端 `ai_task.kind`）。 */
const TASK_KIND = "resume_risk";

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
/** 每个 resumeId 当前任务的后端 id（取消要它）。 */
const taskIds = new Map<number, number>();
/** 每个 resumeId 当前的"面板在看"声明。 */
const detachers = new Map<number, () => void>();
/** 每个 resumeId 被几个面板挂着（计数，StrictMode 双挂载也不会算错）。 */
const attachedCounts = new Map<number, number>();
/** 已经交付过结果的 task id（刷新恢复 + 正常轮询可能各派发一次）。 */
const delivered = new Set<number>();
const listeners = new Set<() => void>();

/** 批量快照（给需要全量视图的地方用）。与 states 同步维护，但只在变化时重建数组。 */
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

/** 这个简历的风险面板是否正被挂载（决定完成时是就地展示还是"叫住他"）。 */
export function isRiskPanelAttached(resumeId: number): boolean {
  return (attachedCounts.get(resumeId) ?? 0) > 0;
}

/** 结果交付：成功那一次（含刷新恢复后重放的那一次）从这里回到本 store。 */
registerAiTaskResultSink(TASK_KIND, (taskId, resultData) => {
  if (delivered.has(taskId)) return;
  delivered.add(taskId);
  const raw = resultData?.resume_id;
  const resumeId = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(resumeId) || resumeId <= 0) return;
  const payload = resultData?.risk_scan;
  if (!payload || typeof payload !== "object") return;
  const previous = states.get(resumeId);
  taskIds.delete(resumeId);
  setState(resumeId, {
    status: "done",
    result: payload as unknown as ResumeRiskScan,
    startedAt: previous?.startedAt,
    finishedAt: Date.now(),
    signature: previous?.signature,
    enhance: previous?.enhance,
  });
});

/**
 * 发起一次扫描。
 *
 * **重复发起只保留最新一次**：先取消上一次的任务，否则两次扫描会并行烧模型。
 * `enhance=false`（用户关掉模型增强）时后端只跑本地规则——任务照样走同一套地基，
 * 用户不必因为"这次没调模型"就换一条链路。
 */
export function startRiskScan(
  resumeId: number,
  opts: { enhance: boolean; signature?: string },
): void {
  const previousTaskId = taskIds.get(resumeId);
  if (previousTaskId !== undefined) {
    taskIds.delete(resumeId);
    void cancelAiTaskEntry(backgroundTaskKey(TASK_KIND, previousTaskId));
  }

  const startedAt = Date.now();
  setState(resumeId, {
    status: "scanning",
    startedAt,
    signature: opts.signature,
    enhance: opts.enhance,
  });

  void startAiTask({
    kind: TASK_KIND,
    payload: { resume_id: resumeId, enhance: opts.enhance },
    label: t("backgroundTasks.aiTask.risk.label"),
    onFinished: (task) => {
      // 成功不走这里（报告由 sink 交回）：这里只收两种"没有结果要交回"的终态。
      if (task.status === "failed") {
        const previous = states.get(resumeId);
        setState(resumeId, {
          status: "error",
          error: task.error || t("backgroundTasks.risk.stateFailed"),
          startedAt,
          signature: previous?.signature,
          enhance: previous?.enhance,
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
        error: error instanceof Error ? error.message : t("backgroundTasks.risk.stateFailed"),
        startedAt,
        signature: opts.signature,
        enhance: opts.enhance,
      });
    },
  );
}

/** 取消进行中的扫描：**真的**让后端任务停下（不是只把自己标成已取消）。 */
export function cancelRiskScan(resumeId: number): void {
  const taskId = taskIds.get(resumeId);
  taskIds.delete(resumeId);
  if (taskId !== undefined) {
    void cancelAiTaskEntry(backgroundTaskKey(TASK_KIND, taskId));
  }
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
export function resetRiskScanStore(): void {
  for (const detach of detachers.values()) detach();
  detachers.clear();
  taskIds.clear();
  delivered.clear();
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

/** 订阅**所有**槽（需要全量视图的调用方用）。 */
export function useRiskScanEntries(): RiskScanEntry[] {
  return useSyncExternalStore(subscribeRiskScan, getRiskScanEntries, getRiskScanEntries);
}
