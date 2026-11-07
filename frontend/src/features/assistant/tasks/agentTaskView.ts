// SPDX-License-Identifier: Apache-2.0
/** 任务区块的纯展示映射：状态 → 分组/标签/进度（T20，无副作用，便于单测与复用）。 */
import type { AgentTask, AgentTaskStatus, AgentTaskStepStatus } from "../../../api/agentTasks";
import type { MessageKey } from "../../../i18n";

/** 三个分区，顺序即界面顺序：进行中 / 待确认 / 已结束。 */
export type AgentTaskBucket = "active" | "waiting" | "finished";

export const BUCKET_ORDER: readonly AgentTaskBucket[] = ["active", "waiting", "finished"];

export const BUCKET_LABEL_KEYS: Record<AgentTaskBucket, MessageKey> = {
  active: "assistantUi.tasks.group.active",
  waiting: "assistantUi.tasks.group.waiting",
  finished: "assistantUi.tasks.group.finished",
};

export const STATUS_LABEL_KEYS: Record<AgentTaskStatus, MessageKey> = {
  draft: "assistantUi.tasks.status.draft",
  running: "assistantUi.tasks.status.running",
  paused: "assistantUi.tasks.status.paused",
  waiting_approval: "assistantUi.tasks.status.waiting_approval",
  done: "assistantUi.tasks.status.done",
  failed: "assistantUi.tasks.status.failed",
  cancelled: "assistantUi.tasks.status.cancelled",
};

export const STEP_STATUS_LABEL_KEYS: Record<AgentTaskStepStatus, MessageKey> = {
  pending: "assistantUi.tasks.stepStatus.pending",
  running: "assistantUi.tasks.stepStatus.running",
  waiting_approval: "assistantUi.tasks.status.waiting_approval",
  done: "assistantUi.tasks.status.done",
  failed: "assistantUi.tasks.status.failed",
  skipped: "assistantUi.tasks.stepStatus.skipped",
};

/** antd Tag 的语义色：只表达"好不好/要不要管"，不自定义颜色值。 */
export const STATUS_TAG_COLORS: Partial<Record<AgentTaskStatus, string>> = {
  running: "processing",
  paused: "warning",
  waiting_approval: "gold",
  done: "success",
  failed: "error",
};

/**
 * 任务来源（与后端 `models/agent_task.py` 的 `AGENT_TASK_SOURCE_*` 常量逐字一致）。
 *
 * 来源是**来源标签**，不是状态：它回答"这张卡是谁发起的"，前端只用它决定要不要加徽标
 * （提醒到期自动生成的任务卡没有会话归属，用户需要知道它不是自己刚建的）。
 */
export const AGENT_TASK_SOURCE_MANUAL = "manual";
export const AGENT_TASK_SOURCE_REMINDER = "reminder";

/** 非手动来源 → 徽标文案 key；`manual` 与未知来源都不加徽标（不猜来源）。 */
export const SOURCE_BADGE_KEYS: Record<string, MessageKey> = {
  [AGENT_TASK_SOURCE_REMINDER]: "assistantUi.tasks.source.reminder",
};

/**
 * 任务行的来源徽标文案 key：手动建的卡不显示（满屏「来源：手动」只是噪音）；
 * 已知的非手动来源用专属文案，未知来源退回带参数的通用文案（如实显示原始标签，
 * 绝不把未知来源伪装成"提醒"）。
 */
export function sourceBadgeKey(task: AgentTask): MessageKey | null {
  const source = (task.source || "").trim();
  if (!source || source === AGENT_TASK_SOURCE_MANUAL) return null;
  return SOURCE_BADGE_KEYS[source] ?? "assistantUi.tasks.source.other";
}

export function bucketOf(status: AgentTaskStatus): AgentTaskBucket {
  if (status === "waiting_approval") return "waiting";
  if (status === "done" || status === "failed" || status === "cancelled") return "finished";
  return "active";
}

/** 进度：已完成步骤数 / 总步骤数（cursor 可能因数据异常超过步数，按 total 封顶）。 */
export function progressOf(task: AgentTask): { current: number; total: number } {
  const total = task.steps.length;
  return { current: Math.min(task.resume_cursor, total), total };
}

export function groupTasks(tasks: AgentTask[]): Record<AgentTaskBucket, AgentTask[]> {
  const grouped: Record<AgentTaskBucket, AgentTask[]> = {
    active: [],
    waiting: [],
    finished: [],
  };
  for (const task of tasks) grouped[bucketOf(task.status)].push(task);
  return grouped;
}
