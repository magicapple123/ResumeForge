// ===== ② 任务状态机 =====
export type TaskKind = "collect" | "apply";
export type TaskStatus =
  "pending" | "running" | "paused" | "breaker_paused" | "completed" | "stopped" | "failed";
export type TaskItemStatus = "pending" | "running" | "success" | "failed" | "skipped";
export type QueueStatus = "pending" | "skipped" | "done";
export type BrowserState = "stopped" | "starting" | "running" | "unknown";

export const TASK_STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  pending: { label: "等待中", color: "default" },
  running: { label: "进行中", color: "processing" },
  paused: { label: "已暂停", color: "warning" },
  breaker_paused: { label: "熔断暂停", color: "error" },
  completed: { label: "已完成", color: "success" },
  stopped: { label: "已停止", color: "default" },
  failed: { label: "失败", color: "error" },
};

export const TASK_ITEM_STATUS_META: Record<TaskItemStatus, { label: string; color: string }> = {
  pending: { label: "待投递", color: "default" },
  running: { label: "进行中", color: "processing" },
  success: { label: "成功", color: "success" },
  failed: { label: "失败", color: "error" },
  skipped: { label: "已跳过", color: "default" },
};

export const QUEUE_STATUS_META: Record<QueueStatus, { label: string; color: string }> = {
  pending: { label: "待投递", color: "default" },
  skipped: { label: "已跳过", color: "default" },
  done: { label: "已投递", color: "success" },
};

export const BROWSER_STATE_META: Record<BrowserState, { label: string; color: string }> = {
  stopped: { label: "未启动", color: "default" },
  starting: { label: "启动中", color: "processing" },
  running: { label: "运行中", color: "success" },
  unknown: { label: "状态未知", color: "warning" },
};
