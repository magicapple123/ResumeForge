// SPDX-License-Identifier: Apache-2.0
/**
 * 通用 AI 任务（后端 `ai_task` 表）的前端类型。
 *
 * 与 `types/resume.ts` 的 `ResumeGenerateTask` 并列存在，而不是替换它：简历生成有自己
 * 的重任务表（快照、字数、终态仲裁），本轮不合并。两者在前端被**同一张登记表**
 * （`utils/backgroundTasks`）统一成 `BackgroundTask`，所以页面只认一种任务形状。
 */

/** 后端 `ai_task.kind`：新增入口时这里加一个值即可（未知值按普通字符串处理）。 */
export type AiTaskKind =
  | "resume_generate"
  | "job_match"
  | "job_analysis"
  | "resume_risk"
  | "resume_rewrite"
  | "webform_fill";

/**
 * 任务状态。
 *
 * 注意命名与简历任务不同：后端通用任务用 `succeeded` / `canceled`（单 l），
 * 简历任务用 `completed` / `cancelled`。转换只在
 * `utils/backgroundTasks.adapters.ts` 一处做，其它代码只认统一后的
 * `BackgroundTaskStatus`。
 */
export type AiTaskStatus = "pending" | "running" | "succeeded" | "failed" | "canceled";

/** 任务快照（`GET /ai-tasks/{id}` 的响应）。 */
export interface AiTaskSnapshot {
  id: number;
  kind: string;
  status: AiTaskStatus;
  /** 0–100 的粗粒度进度。 */
  progress: number;
  label: string;
  message: string;
  /**
   * 完成后点通知该跳哪：`{resume_id: 12}` / `{job_id: 7}`；无落点时为 `null`。
   * 深链由 `utils/taskDeepLinks` 生成，组件里**不要**手拼地址。
   */
  result_ref: Record<string, unknown> | null;
  error: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** `POST /ai-tasks` 的请求体。 */
export interface AiTaskCreateRequest {
  kind: AiTaskKind | string;
  /** 输入摘要（只放标识与选项，**不放**完整 JD 或个人资料正文）。 */
  payload: Record<string, unknown>;
  /** 人话说明，显示在页头任务面板上。 */
  label?: string;
}
