// SPDX-License-Identifier: Apache-2.0
/**
 * 简历风险扫描面板：扫描状态、风险点列表、AI 增强开关与结果提示。
 *
 * 风险分类词表（查重 / 敏感词 / 夸大 …）不在本文件——它与字段名表同类，
 * 归「统一词表」那批；带 <strong> 内嵌的说明段落整段成 key 单独处理。
 */
const riskPanel = {
  "riskPanel.scanAt": "Scanned at {time}",
  "riskPanel.llmUsed": "with model review",
  "riskPanel.llmOff": "local rules only",
  "riskPanel.stale.title": "The Resume has changed — rescan recommended",
  "riskPanel.action.rescan": "Rescan",
  "riskPanel.summary": "{count} risk points",
  "riskPanel.empty": "No obvious risk points found",
  "riskPanel.action.retry": "Retry",
  "riskPanel.error.title": "Risk scan failed",
  "riskPanel.enhance.aria": "AI review",
  "riskPanel.enhance.label": "AI review",
  "riskPanel.claimTag": "Fact ledger #{id}",
  "riskPanel.suggestion": "Suggestion:",
  "riskPanel.followUp": "Follow-up prep ({count})",
} as const;

export default riskPanel;
