// SPDX-License-Identifier: Apache-2.0
/**
 * 新建 / 后台生成接口的请求契约（F4-BE 2026-10-25 交付）。
 *
 * 为什么单列文件：`types/resume.ts` 已贴近 500 行预算，而创建/生成请求要新增
 * 「创建态快照」字段（profile_context）。从 `types/resume` 或 `types` 的导入路径
 * 由 `resume.ts` 的 re-export 保持兼容。
 */
import type { GenerateOptions, ResumeLanguage } from "./resume";
import type { ResumeDocument } from "./resumeDocument";

/** 创建简历时冻结的「来源布局」一行（服务端会按当前组重建权威 layout，这里只作展示）。 */
export interface ProfileCreationLayoutItem {
  section_key: string;
  section_name: string;
  entry_count: number;
}

/**
 * 创建态投影快照：与 GET /api/profile/current/projection 的 snapshot_token 绑定。
 * token 与当前投影不一致 → 409 code=profile_snapshot_stale（重新打开新建面板再试）。
 */
export interface ProfileCreationContext {
  snapshot_token: string;
  participating_keys: string[];
  layout: ProfileCreationLayoutItem[];
}

/** POST /api/resumes/manual 的请求体；`profile_context` 可选（老调用方不带，行为不变）。 */
export interface ManualResumeCreatePayload {
  job_id?: number | null;
  title?: string;
  content: ResumeDocument;
  draft?: boolean;
  language?: ResumeLanguage;
  profile_context?: ProfileCreationContext;
}

/** POST /api/resumes/generate/tasks 的请求体（job_id=null 表示通用简历）。 */
export interface StartResumeGenerationPayload {
  job_id: number | null;
  title?: string;
  options: GenerateOptions;
}
