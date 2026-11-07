// SPDX-License-Identifier: Apache-2.0
/**
 * Agent 任务接口（后端 `app/api/agent_tasks.py`，prefix `/api/agent-tasks`，T19/T20）。
 *
 * 与通用 AI 任务（`api/aiTasks.ts`）的区别：AI 任务是一段"请求-后台跑完"的单步过程，
 * Agent 任务是**多步计划**——有每一步的状态、等待用户确认的中间态、以及重启后可继续的
 * 游标。前端任务区块（`features/assistant/tasks/`）按会话轮询这里的列表。
 *
 * 类型定义放在本文件而不是 `types/`：这批结构只被任务区块消费（T20 范围），
 * 先跟着接口走，等第二处消费方出现再上提。
 */
import { buildQuery, request } from "./client";

/** 任务状态机（与后端 `models/agent_task.py` 的常量逐字一致）。 */
export type AgentTaskStatus =
  "draft" | "running" | "paused" | "waiting_approval" | "done" | "failed" | "cancelled";

/** 单步状态机（含 skipped：取消任务时未完成的步骤会被跳过）。 */
export type AgentTaskStepStatus =
  "pending" | "running" | "waiting_approval" | "done" | "failed" | "skipped";

export interface AgentTaskStep {
  step_index: number;
  kind: string;
  title: string;
  status: AgentTaskStepStatus;
  input_digest: string;
  output_ref: Record<string, unknown> | null;
  attempt: number;
  error: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AgentTask {
  id: number;
  conversation_id: number | null;
  title: string;
  goal: string;
  status: AgentTaskStatus;
  /** 0 基游标：等于"已完成步骤数"，也就是下一步的下标。 */
  resume_cursor: number;
  source: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  error: string;
  steps: AgentTaskStep[];
}

export interface AgentTaskCreateRequest {
  title: string;
  steps: Array<string | { title: string; kind?: string }>;
  conversation_id?: number | null;
  goal?: string;
  source?: string;
}

export interface AgentTaskStepCompleteRequest {
  output_ref?: Record<string, unknown> | null;
  attempt?: number;
}

const TASK_BUDGET = "task" as const;

/** 当前数据集的任务列表（新→旧）；传 conversation_id 时只取该会话的任务。 */
export function listAgentTasks(conversationId?: number | null): Promise<AgentTask[]> {
  const query = buildQuery({ conversation_id: conversationId ?? undefined });
  return request<AgentTask[]>(`/agent-tasks${query}`, { budget: TASK_BUDGET });
}

/** 建一个 draft 任务（步骤顺序落库，草稿不计进度）。 */
export function createAgentTask(body: AgentTaskCreateRequest): Promise<AgentTask> {
  return request<AgentTask>("/agent-tasks", {
    method: "POST",
    body: JSON.stringify(body),
    budget: TASK_BUDGET,
  });
}

/** draft → running（幂等：已 running 时后端返回当前快照）。 */
export function startAgentTask(id: number): Promise<AgentTask> {
  return request<AgentTask>(`/agent-tasks/${id}/start`, {
    method: "POST",
    budget: TASK_BUDGET,
  });
}

/** 完成当前步骤并推进游标；同一步重复调用幂等（不会二次执行副作用）。 */
export function completeAgentTaskStep(
  id: number,
  stepIndex: number,
  body: AgentTaskStepCompleteRequest = {},
): Promise<AgentTask> {
  return request<AgentTask>(`/agent-tasks/${id}/steps/${stepIndex}/complete`, {
    method: "POST",
    body: JSON.stringify(body),
    budget: TASK_BUDGET,
  });
}

/** 让当前步骤进入等待用户确认（任务一起进入 waiting_approval）。 */
export function waitApprovalAgentTask(id: number, stepIndex: number): Promise<AgentTask> {
  return request<AgentTask>(`/agent-tasks/${id}/steps/${stepIndex}/wait-approval`, {
    method: "POST",
    budget: TASK_BUDGET,
  });
}

export function pauseAgentTask(id: number): Promise<AgentTask> {
  return request<AgentTask>(`/agent-tasks/${id}/pause`, {
    method: "POST",
    budget: TASK_BUDGET,
  });
}

export function resumeAgentTask(id: number): Promise<AgentTask> {
  return request<AgentTask>(`/agent-tasks/${id}/resume`, {
    method: "POST",
    budget: TASK_BUDGET,
  });
}

export function cancelAgentTask(id: number): Promise<AgentTask> {
  return request<AgentTask>(`/agent-tasks/${id}/cancel`, {
    method: "POST",
    budget: TASK_BUDGET,
  });
}
