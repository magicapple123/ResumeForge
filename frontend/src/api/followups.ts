// SPDX-License-Identifier: Apache-2.0
/**
 * 跟进巡检的决策接口（后端 `app/api/followups.py`，prefix `/api/followups`；契约 A 节）。
 *
 * 一张巡检卡里的多个岗位各自独立：用户可以任意顺序选择，最后**整卡一次提交**。
 * 后端在一个事务里为每个 track 写一行 application_follow_up，并把对应步骤置 done；
 * 全部步骤 done 时卡转 done。**它绝不写 application_track**（阶段/next_action_date 不碰），
 * 所以前端文案必须说清"只记录你的选择，不改动求职进度里的阶段"。
 */
import { request } from "./client";

/** 三种处理方式（与后端 decision 的闭集逐字一致）。 */
export type FollowupDecision = "contacted" | "replied" | "stopped";

/** 提交体里的一项：track_id 来自步骤的 output_ref，decision 是用户的选择。 */
export interface FollowupDecisionInput {
  track_id: number;
  decision: FollowupDecision;
}

/** 提交响应里的步骤快照：只带界面需要回写的字段（契约 A 节）。 */
export interface FollowupStepSnapshot {
  step_index: number;
  kind: string;
  title: string;
  status: string;
  output_ref: Record<string, unknown> | null;
}

export interface FollowupDecisionResponse {
  task_id: number;
  status: string;
  /** 本次接受的处理条数（已处理过的不会重复计数，但仍可能计入 decided）。 */
  decided: number;
  /** 新写入的 application_follow_up 行数；0 表示全部已处理过（幂等）。 */
  created_rows: number;
  idempotent: boolean;
  steps: FollowupStepSnapshot[];
}

/**
 * 整卡提交跟进决策。
 *
 * 后端按 track_id 去重并在重复提交时返回幂等响应（created_rows=0、idempotent=true），
 * 前端把响应里的 steps 回写到本地，界面立即按"已处理"显示，不依赖下一次列表轮询。
 */
export function submitFollowupDecisions(
  taskId: number,
  decisions: FollowupDecisionInput[],
): Promise<FollowupDecisionResponse> {
  return request("/followups/decisions", {
    method: "POST",
    body: JSON.stringify({ task_id: taskId, decisions }),
  });
}
