// SPDX-License-Identifier: Apache-2.0
/**
 * 新建 / 后台生成接口（F4：从 `api/resumes.ts` 等价提取，原路径 re-export 保持兼容）。
 *
 * 拆出的原因：`api/resumes.ts` 已贴着 500 行红线，而 F4-BE 给创建接口新增了可选的
 * `profile_context` 快照字段；放在这里既守住预算，也让"创建/生成请求契约"只有一处。
 */
import type { ResumeDetail, ResumeGenerateTask } from "../types";
import type {
  ManualResumeCreatePayload,
  StartResumeGenerationPayload,
} from "../types/resumeCreation";
import { request } from "./client";

/**
 * 保存用户自行编写的简历，可选关联岗位。
 *
 * `draft` = 建一份**制作台草稿**（0051）：它不出现在简历中心/搜索/统计里，只有用户在
 * 制作台里保存过（内容或版式任一）才会转正。
 *
 * `profile_context`（F4-BE）= 创建时冻结的当前组投影快照：服务端校验 token，一致则同事务
 * 写创建态快照（resume_id 关联）；不一致 409 profile_snapshot_stale，前端提示重新打开面板。
 * 不带它 = 老调用方行为不变。
 */
export function createManualResume(payload: ManualResumeCreatePayload): Promise<ResumeDetail> {
  return request("/resumes/manual", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 启动一次后台简历生成，返回可轮询的任务；job_id 为 null 表示生成通用简历。 */
export function startResumeGeneration(
  payload: StartResumeGenerationPayload,
): Promise<ResumeGenerateTask> {
  return request("/resumes/generate/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 查询一次生成任务的状态（前端 1.5s 轮询）。 */
export function getResumeGenerateTask(taskId: number): Promise<ResumeGenerateTask> {
  return request(`/resumes/generate/tasks/${taskId}`);
}

/** 取消进行中的生成任务；取消后不落库简历，任务标为 cancelled。 */
export function cancelResumeGenerateTask(taskId: number): Promise<ResumeGenerateTask> {
  return request(`/resumes/generate/tasks/${taskId}/cancel`, { method: "POST" });
}
