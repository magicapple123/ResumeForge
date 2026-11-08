// SPDX-License-Identifier: Apache-2.0
/**
 * 跟进巡检卡的纯展示/提交映射（T06）：不取数、不调 t()、无副作用，便于单测。
 *
 * 数据形状全部来自契约 A 节：
 * - task.source = "followup"，每个岗位一个 step，step.kind = "followup"（跟进清单桶）
 *   或 "confirm"（确认状态桶），output_ref = { track_id }；
 * - 决策整卡一次提交，响应回写每个 step 的 status。
 *
 * 这里的三个关键判定都要求"可证伪"：
 * 1. **只认同协议值**：kind 只认 followup / confirm，track_id 只认整数——后端演进时
 *    未知值不会让界面猜出一个动作；
 * 2. **已处理的不再进提交体**：step 已 done 时后端幂等，但仍不该出现在本次请求里；
 * 3. **提交顺序按 step_index**：用户可乱序选择，请求体保持稳定顺序，便于幂等排查。
 */
import type { AgentTask, AgentTaskStatus, AgentTaskStep } from "../../api/agentTasks";
import type {
  FollowupDecision,
  FollowupDecisionInput,
  FollowupDecisionResponse,
  FollowupStepSnapshot,
} from "../../api/followups";
import { AGENT_TASK_SOURCE_FOLLOWUP } from "../assistant/tasks/agentTaskView";

/** 两类桶的协议值（与后端 followup_sweep.py 的 step.kind 逐字一致）。 */
export type FollowupStepKind = "followup" | "confirm";

/** 用户选择表：step_index → decision。 */
export type FollowupSelections = Record<number, FollowupDecision>;

const AGENT_TASK_STATUSES: readonly AgentTaskStatus[] = [
  "draft",
  "running",
  "paused",
  "waiting_approval",
  "done",
  "failed",
  "cancelled",
];

const AGENT_TASK_STEP_STATUSES: readonly string[] = [
  "pending",
  "running",
  "waiting_approval",
  "done",
  "failed",
  "skipped",
];

/** 这张卡是不是跟进巡检卡（来源是协议值，不按标题猜）。 */
export function isFollowupTask(task: AgentTask): boolean {
  return task.source === AGENT_TASK_SOURCE_FOLLOWUP;
}

/** step.kind → 桶；未知 kind 返回 null（不猜）。 */
export function followupStepKind(step: AgentTaskStep): FollowupStepKind | null {
  return step.kind === "followup" || step.kind === "confirm" ? step.kind : null;
}

/**
 * 整张卡的桶名：取第一个可识别的 step.kind。
 *
 * 契约规定一张卡只属于一个桶，所以取第一个即可；若第一步的 kind 不可识别但后面的可以，
 * 仍能显示正确的桶名。全部不可识别时返回 null，界面不显示桶名而不是编一个。
 */
export function followupBucketKind(task: AgentTask): FollowupStepKind | null {
  for (const step of task.steps) {
    const kind = followupStepKind(step);
    if (kind) return kind;
  }
  return null;
}

/** 这一步对应的 application track id；协议要求正整数，其它一律视为不可处理。 */
export function trackIdOfStep(step: AgentTaskStep): number | null {
  const value = step.output_ref?.track_id;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** 还能处理（尚未 done）的步骤，按 step_index 排序。 */
export function pendingFollowupSteps(task: AgentTask): AgentTaskStep[] {
  return task.steps
    .filter((step) => step.status !== "done" && step.status !== "skipped")
    .slice()
    .sort((left, right) => left.step_index - right.step_index);
}

/** 卡是否已处理完：所有步骤都已 done（或 skipped，被取消时的终态）。 */
export function isFollowupDone(task: AgentTask): boolean {
  return task.steps.length > 0 && pendingFollowupSteps(task).length === 0;
}

/** 本次已选的处理条数（只算还能处理、且 track_id 有效的步骤）。 */
export function selectedFollowupCount(task: AgentTask, selections: FollowupSelections): number {
  return pendingFollowupSteps(task).filter(
    (step) => trackIdOfStep(step) !== null && selections[step.step_index] !== undefined,
  ).length;
}

/** 还没选处理方式的条数（提交按钮的可用性由它决定）。 */
export function incompleteFollowupCount(task: AgentTask, selections: FollowupSelections): number {
  return pendingFollowupSteps(task).filter(
    (step) => trackIdOfStep(step) !== null && selections[step.step_index] === undefined,
  ).length;
}

/**
 * 组装提交体：只包含**可处理且已选**的步骤，按 step_index 升序。
 *
 * track_id 缺失/非法的步骤不进入请求体——它无法定位到 track，提交只会制造一条后端 422；
 * 这类步骤在界面上也不提供选择（见 FollowupCard）。
 */
export function buildFollowupDecisions(
  task: AgentTask,
  selections: FollowupSelections,
): FollowupDecisionInput[] {
  const decisions: FollowupDecisionInput[] = [];
  for (const step of pendingFollowupSteps(task)) {
    const trackId = trackIdOfStep(step);
    const decision = selections[step.step_index];
    if (trackId === null || decision === undefined) continue;
    decisions.push({ track_id: trackId, decision });
  }
  return decisions;
}

/** 响应里的 status 是字符串协议值：认识才采用，不认识时按步骤是否全 done 推导。 */
export function resolveFollowupStatus(
  response: FollowupDecisionResponse,
  steps: AgentTaskStep[],
): AgentTaskStatus {
  if (AGENT_TASK_STATUSES.includes(response.status as AgentTaskStatus)) {
    return response.status as AgentTaskStatus;
  }
  return steps.length > 0 && steps.every((step) => step.status === "done") ? "done" : "draft";
}

/**
 * 把响应里的步骤快照合并回本地任务（提交后立即按响应显示，不等下一次轮询）。
 *
 * 快照只带界面需要的字段，其余字段（input_digest / attempt / 时间戳）沿用原步骤；
 * 未知的 status 字符串保留原值，避免把一条真实状态映射成别的状态。
 */
export function applyFollowupResponse(
  task: AgentTask,
  response: FollowupDecisionResponse,
): AgentTask {
  const snapshots = new Map<number, FollowupStepSnapshot>();
  for (const snapshot of response.steps) snapshots.set(snapshot.step_index, snapshot);
  const steps = task.steps.map((step) => {
    const snapshot = snapshots.get(step.step_index);
    if (!snapshot) return step;
    const status = AGENT_TASK_STEP_STATUSES.includes(snapshot.status)
      ? (snapshot.status as AgentTaskStep["status"])
      : step.status;
    return {
      ...step,
      kind: snapshot.kind || step.kind,
      title: snapshot.title || step.title,
      status,
      output_ref: snapshot.output_ref ?? step.output_ref,
    };
  });
  return { ...task, steps, status: resolveFollowupStatus(response, steps) };
}
