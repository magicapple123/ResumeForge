// SPDX-License-Identifier: Apache-2.0
/** 任务区块的纯展示映射：状态 → 分组/标签/进度（T20，无副作用，便于单测与复用）。 */
import type { AgentTask, AgentTaskStatus, AgentTaskStepStatus } from "../../../api/agentTasks";
import type { MessageKey } from "../../../i18n";

/** 三个分区，顺序即界面顺序：进行中 / 待确认 / 已结束。 */
export type AgentTaskBucket = "active" | "waiting" | "finished";

export const BUCKET_ORDER: readonly AgentTaskBucket[] = ["active", "waiting", "finished"];

/**
 * 旧的「待确认在前、进行中在后」组顺序（D2）。
 *
 * CR-19 之后首页已拆成两张卡（各自只有一个分区），这个常量只保留给
 * `AgentTaskPanel` 的用例做"多分区同卡片"的回归；首页不再使用。
 */
export const HOME_BUCKET_ORDER: readonly AgentTaskBucket[] = ["waiting", "active", "finished"];

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
/** 跟进巡检（T06）：一张卡最多 5 个沉默岗位，按 step.kind 分「跟进清单 / 确认状态」两桶。 */
export const AGENT_TASK_SOURCE_FOLLOWUP = "followup";

/** 非手动来源 → 徽标文案 key；`manual` 与未知来源都不加徽标（不猜来源）。 */
export const SOURCE_BADGE_KEYS: Record<string, MessageKey> = {
  [AGENT_TASK_SOURCE_REMINDER]: "assistantUi.tasks.source.reminder",
  [AGENT_TASK_SOURCE_FOLLOWUP]: "followupSweep.sourceBadge",
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

/**
 * D5：`steps` 为 0 且状态是 `cancelled` / `draft` 的任务是历史脏数据（或未成形的空壳），
 * **不显示、也不计入任何计数**。其它状态即使没有步骤也保留——那可能是数据异常，
 * 藏起来会让用户以为任务丢了。
 */
export function isHiddenEmptyTask(task: AgentTask): boolean {
  return task.steps.length === 0 && (task.status === "cancelled" || task.status === "draft");
}

/** 列表/卡片可见任务：先做 D5 过滤，调用方再分组与计数（单一实现，别各写一遍）。 */
export function visibleTasks(tasks: AgentTask[]): AgentTask[] {
  return tasks.filter((task) => !isHiddenEmptyTask(task));
}

/**
 * 终态提醒卡（CR-20）：提醒到期生成、且已经结束（完成 / 失败 / 取消）。
 *
 * 它回答不了"接下来要做什么"——提醒本身还在求职进度里挂着，任务卡只是当时那一跳。
 * 所以首页任务卡与助手任务条都**不展示**它们；要看历史去设置页的「查看历史」
 * （`AgentTaskEventsCard`），那里按时间倒序翻。
 */
export function isFinishedReminderTask(task: AgentTask): boolean {
  return (
    (task.source || "").trim() === AGENT_TASK_SOURCE_REMINDER &&
    bucketOf(task.status) === "finished"
  );
}

/** 卡片/任务条该展示的任务：D5 空壳过滤 + 终态提醒卡隐藏（两处口径必须一致）。 */
export function visibleCardTasks(tasks: AgentTask[]): AgentTask[] {
  return visibleTasks(tasks).filter((task) => !isFinishedReminderTask(task));
}

/**
 * 首页「待你确认」卡（CR-19）：只放 `waiting_approval`。
 *
 * 拆卡的理由是"这张卡上只有一种动作"——待确认不是进度，而是**等你做决定**；
 * 和进行中的任务混在一张卡里，用户看到的是一份"任务清单"，而不是一个待办。
 */
export function waitingConfirmationTasks(tasks: AgentTask[]): AgentTask[] {
  return visibleCardTasks(tasks).filter((task) => bucketOf(task.status) === "waiting");
}

/**
 * 首页「任务」卡（CR-19）：进行中，且**不含跟进巡检卡**。
 *
 * 巡检卡自带一整套决策按钮（每个岗位三选一、整卡一次提交），塞进"助手创建的多步任务"
 * 会让人以为它也是通用任务；它的去处是助手页/跟进入口，不是首页任务卡。
 */
export function runningTaskCards(tasks: AgentTask[]): AgentTask[] {
  return visibleCardTasks(tasks).filter(
    (task) =>
      bucketOf(task.status) === "active" &&
      (task.source || "").trim() !== AGENT_TASK_SOURCE_FOLLOWUP,
  );
}

/**
 * 「当前这步」：第一个 `running` / `waiting_approval` / `pending` 的步骤下标。
 * 全部完成（或已失败/跳过到底）返回 `null`——**全部完成不标"当前"**。
 */
export function currentStepIndex(task: AgentTask): number | null {
  const step = task.steps.find(
    (item) =>
      item.status === "running" || item.status === "waiting_approval" || item.status === "pending",
  );
  return step ? step.step_index : null;
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
