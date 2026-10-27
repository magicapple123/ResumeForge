// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场「批量适配度分析」的结果展示层（`JobMatchBatchResult`）：单岗位卡片、
 * 条件列表与整批结果。
 *
 * 准入结论与五类条件状态名仍来自 `types/apply/match.ts`（与单岗位分析弹窗共用），
 * 不在本包内；多个说明条目之间的分隔符是纯展示，走 `separator.notes`。
 */
const jobMatchBatchResult = {
  "jobMatchBatchResult.group.hardConditions": "硬性条件",
  "jobMatchBatchResult.group.coreAbilities": "核心能力",
  "jobMatchBatchResult.group.bonusItems": "加分项",

  "jobMatchBatchResult.source.existing": "复用已有分析",
  "jobMatchBatchResult.source.local": "本地降级",
  "jobMatchBatchResult.source.new": "本次新分析",

  "jobMatchBatchResult.condition.empty": "暂无条目",
  "jobMatchBatchResult.condition.evidence": "依据：{evidence}",

  "jobMatchBatchResult.admission.tag": "准入：{label}",
  "jobMatchBatchResult.hardGate.field": "硬性门槛：{state}",
  "jobMatchBatchResult.hardGate.met": "满足",
  "jobMatchBatchResult.hardGate.unmet": "未满足",
  "jobMatchBatchResult.hardGate.unknown": "待确认",

  "jobMatchBatchResult.notes.field": "说明：{notes}",
  "jobMatchBatchResult.separator.notes": "；",

  "jobMatchBatchResult.card.rank": "第 {rank} 名",
  "jobMatchBatchResult.score.unit": "分",
  "jobMatchBatchResult.score.label": "匹配度参考分",
  "jobMatchBatchResult.verdict.none": "暂无结论",
  "jobMatchBatchResult.model.field": "模型：{model}",

  "jobMatchBatchResult.detail.title": "匹配详情",

  "jobMatchBatchResult.error.itemFailed": "本岗位分析失败",

  "jobMatchBatchResult.summary.title": "已完成 {completed} 个岗位，{failed} 个岗位失败",
  "jobMatchBatchResult.summary.description":
    "结果已保存，可在「历史记录」中回看；已按匹配度参考分从高到低排列。",
  "jobMatchBatchResult.summary.modelUsed": "本批使用模型：{model}",
  "jobMatchBatchResult.summary.modelMissing": "本批未配置模型，使用本地降级结果。",

  "jobMatchBatchResult.empty.results": "没有可展示的分析结果",
} as const;

export default jobMatchBatchResult;
