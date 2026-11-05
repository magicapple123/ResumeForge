// SPDX-License-Identifier: Apache-2.0
/**
 * 内容审校与反馈类型：事实来源标注、待审变更、预检结论与改进建议。
 *
 * 从 `types/resume.ts` 拆出来的原因：那个聚合文件已到 513 行、超过 500 行预算，
 * 而这一组类型彼此自洽、**不依赖 resume.ts 里的任何本地类型**，是最好切的一块
 * （生成任务那一组会反向依赖 `ResumeLanguage` / `ResumeFontScale`，拆出去要形成
 * 类型循环，所以没有选它）。`resume.ts` 保留 re-export，既有
 * `from "../types/resume"` 的导入路径一律不变。
 */

export type ResumeSuggestionPriority = "high" | "medium" | "low";

/** 一条内容的事实来源标注（RF-13，与后端 FactAnnotation 逐字对齐）。 */
export type FactAnnotationOrigin =
  "grounded" | "restored" | "enhanced_kept" | "ai_rewrite" | "user_added";

export interface FactAnnotation {
  path: string;
  origin: FactAnnotationOrigin;
  claim_id?: number | null;
  source_subject?: string | null;
  source_fact?: string | null;
  responsibility?: string | null;
  boundary?: string | null;
  verification_status?: string | null;
}

/**
 * 一条待审变更（RF-13）：编辑器的 AI 改写 / 手填在落表单前的预检单位。
 * ``before`` / ``after`` 是该栏的完整文本（多行用 \n 连接）。
 */
export interface ResumePendingChange {
  path: string;
  before: string;
  after: string;
  origin: "ai_rewrite" | "user_added";
  instruction?: string;
  /** 变更所属条目的主体名（公司 / 项目名），用于 fact_check_needed 时的台账跳转链接。 */
  subject?: string;
  verdict?: "ok" | "fact_check_needed" | "blocked";
  reasons?: string[];
}

/** 预检结论（RF-13，与后端 ReviewChangeVerdictOut 对齐）。 */
export interface ResumeReviewResult {
  path: string;
  verdict: "ok" | "fact_check_needed" | "blocked";
  reasons: string[];
}

export interface ResumeSuggestion {
  priority: ResumeSuggestionPriority;
  section: string;
  issue: string;
  suggestion: string;
  evidence: string[];
}

export interface ResumeSuggestions {
  job_id: number;
  job_title: string;
  company: string;
  suggestions: ResumeSuggestion[];
}
