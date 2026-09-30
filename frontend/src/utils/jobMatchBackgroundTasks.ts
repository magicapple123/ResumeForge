/** 岗位批量适配度分析的全局后台任务登记表。 */
import { cancelJobMatchBatchTask, getJobMatchBatchTask, listJobMatchBatchTasks } from "../api/jobs";
import type { JobMatchBackgroundTask } from "../types";
import { notifyTaskDone } from "./taskNotify";

export interface JobMatchBackgroundTaskView {
  id: string;
  label: string;
  status: JobMatchBackgroundTask["status"];
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  currentJobTitle: string;
  message: string;
  error: string;
  batchId: number | null;
}

type Listener = (tasks: JobMatchBackgroundTaskView[]) => void;

export const JOB_MATCH_TASK_POLL_INTERVAL_MS = 1500;

const tasks = new Map<string, JobMatchBackgroundTaskView>();
const listeners = new Set<Listener>();
let timer: number | null = null;
let restorePromise: Promise<void> | null = null;
let cached: JobMatchBackgroundTaskView[] = [];
let cacheDirty = true;

function snapshot(): JobMatchBackgroundTaskView[] {
  if (cacheDirty) {
    cached = [...tasks.values()];
    cacheDirty = false;
  }
  return cached;
}

function emit(): void {
  cacheDirty = true;
  const current = snapshot();
  for (const listener of listeners) listener(current);
}

function isTerminal(status: JobMatchBackgroundTask["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function toView(task: JobMatchBackgroundTask, label: string): JobMatchBackgroundTaskView {
  return {
    id: task.task_id,
    label,
    status: task.status,
    requestedCount: task.requested_count,
    completedCount: task.completed_count,
    failedCount: task.failed_count,
    currentJobTitle: task.current_job_title,
    message: task.message,
    error: task.error,
    batchId: task.batch_id,
  };
}

function stopPollingIfIdle(): void {
  if (tasks.size > 0 || timer === null) return;
  window.clearInterval(timer);
  timer = null;
}

function ensurePolling(): void {
  if (timer !== null || typeof window === "undefined") return;
  timer = window.setInterval(() => void tick(), JOB_MATCH_TASK_POLL_INTERVAL_MS);
}

async function tick(): Promise<void> {
  if (tasks.size === 0) {
    stopPollingIfIdle();
    return;
  }
  await Promise.all(
    [...tasks.keys()].map(async (id) => {
      try {
        applyUpdate(id, await getJobMatchBatchTask(id));
      } catch {
        // 后端短暂不可用时保留当前进度，下一轮继续自愈。
      }
    }),
  );
}

function applyUpdate(id: string, latest: JobMatchBackgroundTask): void {
  const existing = tasks.get(id);
  if (!existing) return;
  const next = toView(latest, existing.label);
  tasks.set(id, next);
  emit();
  if (isTerminal(latest.status)) finish(id, next);
}

function finish(id: string, task: JobMatchBackgroundTaskView): void {
  tasks.delete(id);
  stopPollingIfIdle();
  emit();
  if (task.status === "completed") {
    notifyTaskDone({
      title: "岗位适配度分析完成",
      description:
        "已完成 " +
        task.completedCount +
        " 个岗位，" +
        task.failedCount +
        " 个岗位失败；结果已保存到分析记录。",
    });
  } else if (task.status === "failed") {
    notifyTaskDone({
      kind: "error",
      title: "岗位适配度分析失败",
      description: task.error || "请稍后重试。",
    });
  } else {
    notifyTaskDone({
      kind: "warning",
      title: "岗位适配度分析已取消",
      description: task.batchId ? "取消前已完成的结果仍已保存。" : undefined,
    });
  }
}

export function watchJobMatchBatchTask(task: JobMatchBackgroundTask, label?: string): void {
  tasks.set(task.task_id, toView(task, label ?? "分析 " + task.requested_count + " 个岗位"));
  ensurePolling();
  emit();
  void tick();
}

export async function restoreJobMatchBackgroundTasks(): Promise<void> {
  if (restorePromise) return restorePromise;
  restorePromise = listJobMatchBatchTasks()
    .then((active) => {
      for (const task of active) watchJobMatchBatchTask(task);
    })
    .catch(() => undefined)
    .finally(() => {
      restorePromise = null;
    });
  return restorePromise;
}

export async function cancelJobMatchBackgroundTask(id: string): Promise<void> {
  const latest = await cancelJobMatchBatchTask(id);
  applyUpdate(id, latest);
}

export function getJobMatchBackgroundTasks(): JobMatchBackgroundTaskView[] {
  return snapshot();
}

export function subscribeJobMatchBackgroundTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetJobMatchBackgroundTasks(): void {
  tasks.clear();
  restorePromise = null;
  stopPollingIfIdle();
  emit();
}
