// SPDX-License-Identifier: Apache-2.0
/**
 * 进行中的练习会话：判定标签、追问方向、本轮界面文案。
 *
 * 证据状态的取值是**协议值**（`verified` / `partial` / `unverified` /
 * `contradictory` / `not_covered`，见 `types/drill.ts`），追问方向同理。
 * 本文件只提供显示名，`types/drill.ts` 里的中文表一个字都没改——它还有别的消费者，
 * 页面内用 `pages/drill/drillLabels.ts` 那两张 `Record<…, MessageKey>` 映射到本文件。
 */
const drillSession = {
  "drillSession.evidence.verified": "已验证",
  "drillSession.evidence.partial": "部分验证",
  "drillSession.evidence.unverified": "未验证",
  "drillSession.evidence.contradictory": "存在矛盾",
  "drillSession.evidence.notCovered": "未覆盖",

  "drillSession.evidenceHint.verified": "必要证据都讲到了",
  "drillSession.evidenceHint.partial": "讲到了一部分，还有明确缺口",
  "drillSession.evidenceHint.unverified": "没能提供最低限度的事实",
  "drillSession.evidenceHint.contradictory": "与事实台账或前文对不上",
  "drillSession.evidenceHint.notCovered": "这一轮没问到",

  "drillSession.followup.background": "背景",
  "drillSession.followup.responsibility": "职责",
  "drillSession.followup.structure": "结构",
  "drillSession.followup.implementation": "实现",
  "drillSession.followup.decision": "决策",
  "drillSession.followup.alternative": "替代方案",
  "drillSession.followup.failure": "失败与排查",
  "drillSession.followup.metric": "指标口径",
  "drillSession.followup.cost": "代价",
  "drillSession.followup.retrospective": "复盘",

  "drillSession.answerRequired": "请先写下你的回答",
  "drillSession.submitFailed": "提交失败",
  "drillSession.finishedScan": "这一场问完了，复盘已生成",
  "drillSession.stoppedScan": "已结束，复盘已生成",
  "drillSession.stopFailed": "结束失败",
  "drillSession.lastVerdict": "上一轮判定：{label}",
  "drillSession.deferredNotice": "真实模拟模式：判定已记录，结束后统一复盘。",
  "drillSession.missing": "还缺：{items}",
  "drillSession.contradictions": "矛盾：{items}",
  "drillSession.separator.list": "；",
  "drillSession.questionProgress": "第 {current} / {total} 题",
  "drillSession.followupDepth": "这是对同一条主张的第 {count} 次追问",
  "drillSession.contractSummary": "这道题的评分标准（提问前已锁定）",
  "drillSession.contractIntent": "想验证：{intent}",
  "drillSession.contractRequired": "必须讲到：",
  "drillSession.contractTriggers": "出现这些就该被追问：",
  "drillSession.contractNextFollowup": "下一问方向：{kind}",
  "drillSession.answerPlaceholder":
    "照实说你做过什么。没做到的就说没做到——这里不会替你编，编了也是面试时要还的。",
  "drillSession.submit": "提交回答",
  "drillSession.stopConfirmTitle": "结束这一场并出复盘？",
  "drillSession.stopConfirmBody": "已经答过的判定都会保留。",
  "drillSession.stopConfirmOk": "结束并出复盘",
  "drillSession.stopConfirmCancel": "继续答",
  "drillSession.stopEarly": "提前结束",
  "drillSession.generating": "正在生成下一题…",
  "drillSession.generatingHint": "如果长时间没有变化，可以点「提前结束」先拿现有的判定出复盘。",
  "drillSession.transcriptSummary": "逐轮记录（{count} 轮）",
  "drillSession.turnQuestion": "问：{question}",
  "drillSession.turnAnswer": "答：{answer}",
} as const;

export default drillSession;
