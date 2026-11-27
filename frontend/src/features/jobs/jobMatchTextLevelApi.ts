// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位匹配的**文本级**端点（T34）与其响应形状。
 *
 * 为什么单独一个文件、而不是塞进 `api/jobs.ts`：这条端点属于"另一个口径"，与
 * `getJobMatch` / `deleteJobMatch` 那一族**不共用任何字段**（没有准入、没有五类状态、
 * 没有 `source`）。放在一起会让"随便读一个 `JobMatchOut`"变成顺手的事，而两个口径的
 * `job_id` 之后跟着的东西根本不可比。类型也留在本文件：`types/` 下的 `JobMatchOut`
 * 是全站共用的结构化形状，把文本级塞进去只会让两边互相污染。
 *
 * 响应里**没有分数**（与结构化匹配同一条硬约束）：只有 `target_count` / `matched_count`
 * 两个计数，比例由界面自己写成「字面覆盖 x/y」。
 */
import { request } from "../../api/client";

/** 一句正文摘录 + 它命中的 JD 词（后端原样返回，不改写）。 */
export interface TextLevelHighlight {
  text: string;
  words: string[];
}

/** `POST /api/jobs/{id}/match-analysis-text-level` 的响应。 */
export interface TextLevelMatch {
  /** 口径标识，恒为 `text_level`；界面靠它显示「文本级」标记。 */
  method: "text_level";
  job_id: number;
  job_title: string;
  company: string;
  external_resume_id: number;
  resume_name: string;
  text_chars: number;
  /** 分母：从 JD 抽出的目标词（核心词在前）。 */
  target_words: string[];
  matched_words: string[];
  missing_words: string[];
  core_target: string[];
  core_matched: string[];
  supplementary_target: string[];
  supplementary_matched: string[];
  target_count: number;
  matched_count: number;
  highlights: TextLevelHighlight[];
  /** 口径说明（服务端写，界面原样展示）。 */
  notes: string[];
  generated_at: string;
}

/**
 * 用一份外部简历的正文字对 JD 做文本级比对。
 *
 * 失败一律抛错（后端 400 时 `request` 会把 `detail` 带出来）——包括"这份没有正文"
 * 与"岗位没有 JD"。**不要**在调用侧把这些错误吞成"没结果"：用户需要知道为什么不行。
 */
export function matchJobTextLevel(
  jobId: number,
  externalResumeId: number,
): Promise<TextLevelMatch> {
  return request(`/jobs/${jobId}/match-analysis-text-level`, {
    method: "POST",
    body: JSON.stringify({ external_resume_id: externalResumeId }),
  });
}
