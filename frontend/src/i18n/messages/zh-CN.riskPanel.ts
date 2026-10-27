// SPDX-License-Identifier: Apache-2.0
/**
 * 简历风险扫描面板：扫描状态、风险点列表、AI 增强开关与结果提示。
 *
 * 风险分类词表（查重 / 敏感词 / 夸大 …）不在本文件——它与字段名表同类，
 * 归「统一词表」那批；带 <strong> 内嵌的说明段落整段成 key 单独处理。
 */
const riskPanel = {
  "riskPanel.scanAt": "扫描于 {time}",
  "riskPanel.llmUsed": "含模型增强",
  "riskPanel.llmOff": "不含模型增强",
  "riskPanel.stale.title": "简历内容已修改，建议重新扫描",
  "riskPanel.action.rescan": "重新扫描",
  "riskPanel.summary": "共 {count} 条风险点",
  "riskPanel.empty": "未发现明显风险点",
  "riskPanel.action.retry": "重试",
  "riskPanel.error.title": "风险扫描失败",
  "riskPanel.enhance.aria": "AI 增强",
  "riskPanel.enhance.label": "AI 增强",
  "riskPanel.claimTag": "事实台账 #{id}",
  "riskPanel.suggestion": "建议：",
  "riskPanel.followUp": "追问准备（{count}）",
} as const;

export default riskPanel;
