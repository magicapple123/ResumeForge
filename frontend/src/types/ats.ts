// SPDX-License-Identifier: Apache-2.0
/** ATS 本地检测（R-10）的类型。枚举字符串与后端 schemas/ats.py 逐字一致。 */

export type AtsIssueCategory = "format" | "keyword" | "position";
export type AtsSeverity = "high" | "medium" | "low";

export interface AtsIssue {
  category: AtsIssueCategory;
  severity: AtsSeverity;
  title: string;
  detail: string;
  evidence: string[];
  /** 面向用户的改进建议（R13 起返回；旧响应没有该字段，按空串处理）。 */
  suggestion?: string;
}

/** 单个目标关键词的命中情况（R13）：出现次数与出现的分区。 */
export interface AtsKeywordHit {
  keyword: string;
  matched: boolean;
  count: number;
  /** 命中的分区名：summary / education / experience / …（按后端分区顺序）。 */
  sections: string[];
}

export interface AtsCheckResult {
  resume_id: number;
  issues: AtsIssue[];
  matched_keywords: string[];
  missing_keywords: string[];
  /**
   * 0~100 的粗略估计分，仅作参考。
   *
   * `null` = 没有 JD（或 JD 抽不出目标词）：关键词分项不参与计分，总分算不出来。
   * 这种情况必须显示「—」，不能用 0 分冒充"未检测"。
   */
  score?: number | null;
  /** 免责声明，必须展示给用户。 */
  disclaimer: string;
  summary: Record<string, number>;
  /**
   * 分项的分数（键与 issue 类别一致：format / keyword / position）。
   * 三项加权（0.4/0.4/0.2）后才等于总分，别把它们直接相加。
   * 没有 JD 时**不含 `keyword` 键**——这一项没有分母，不参与计分。
   */
  subscores?: Record<string, number>;
  /** 关键词覆盖率（0~1）；`null`/缺省 = 没有可比对的目标词（需要 JD）。 */
  coverage_ratio?: number | null;
  /** 每个目标词的命中情况；有值时前端按次数排序展示。 */
  keyword_hits?: AtsKeywordHit[];
}
