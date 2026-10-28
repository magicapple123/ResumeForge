// SPDX-License-Identifier: Apache-2.0
/**
 * 通用 AI 任务接口（后端 `app/api/ai_tasks.py`，prefix `/api/ai-tasks`）。
 *
 * 四个动作对应四种需求：建（不等它跑完）、看一次、看全部在跑的、停。
 * 没有"流式响应"——任务一旦建起来就与这条连接无关，断开连接不影响它继续跑。
 */
import type { AiTaskCreateRequest, AiTaskSnapshot } from "../types";
import { request } from "./client";

/** 登记并启动一次 AI 任务；后端立刻返回初始快照（`status` 多为 pending/running）。 */
export function createAiTask(body: AiTaskCreateRequest): Promise<AiTaskSnapshot> {
  return request<AiTaskSnapshot>("/ai-tasks", {
    method: "POST",
    body: JSON.stringify(body),
    // 建任务本身很轻（启动后台线程），但同步等一次数据库写入，给 task 档预算。
    budget: "task",
  });
}

/** 查一次任务状态（前端 1.5s 轮询）。 */
export function getAiTask(id: number): Promise<AiTaskSnapshot> {
  return request<AiTaskSnapshot>(`/ai-tasks/${id}`, { budget: "task" });
}

/** 当前还在跑的任务（刷新后据此恢复页头任务面板）。 */
export function listActiveAiTasks(): Promise<AiTaskSnapshot[]> {
  return request<AiTaskSnapshot[]>("/ai-tasks/active", { budget: "task" });
}

/**
 * 协作式取消：后端先让执行体停下（不再继续消耗模型 token），再把状态落成 canceled。
 * 已完成的任务再取消是幂等的——返回当前快照，不报错。
 */
export function cancelAiTask(id: number): Promise<AiTaskSnapshot> {
  return request<AiTaskSnapshot>(`/ai-tasks/${id}/cancel`, {
    method: "POST",
    budget: "task",
  });
}
