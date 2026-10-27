// SPDX-License-Identifier: Apache-2.0
/**
 * 练习会话里「协议值 → 语言包 key」的三张映射。
 *
 * 为什么不直接改 `types/drill.ts`：那张表的值是中文展示名，但 `types/drill.ts` 还有别的
 * 消费者，且它是「协议值 → 展示名」的唯一来源，迁移时应该由调用方映射到语言包，
 * 而不是把类型层改成依赖 i18n（交接单 §3：协议值本身永不翻）。
 *
 * 用法：`t(EVIDENCE_LABEL_KEYS[status])`。**不要**在模块作用域求值 `t()`。
 */
import type { MessageKey } from "../../i18n";
import type { EvidenceStatus, FollowupKind } from "../../types";

export const EVIDENCE_LABEL_KEYS: Record<EvidenceStatus, MessageKey> = {
  verified: "drillSession.evidence.verified",
  partial: "drillSession.evidence.partial",
  unverified: "drillSession.evidence.unverified",
  contradictory: "drillSession.evidence.contradictory",
  not_covered: "drillSession.evidence.notCovered",
};

export const EVIDENCE_HINT_KEYS: Record<EvidenceStatus, MessageKey> = {
  verified: "drillSession.evidenceHint.verified",
  partial: "drillSession.evidenceHint.partial",
  unverified: "drillSession.evidenceHint.unverified",
  contradictory: "drillSession.evidenceHint.contradictory",
  not_covered: "drillSession.evidenceHint.notCovered",
};

export const FOLLOWUP_LABEL_KEYS: Record<FollowupKind, MessageKey> = {
  background: "drillSession.followup.background",
  responsibility: "drillSession.followup.responsibility",
  structure: "drillSession.followup.structure",
  implementation: "drillSession.followup.implementation",
  decision: "drillSession.followup.decision",
  alternative: "drillSession.followup.alternative",
  failure: "drillSession.followup.failure",
  metric: "drillSession.followup.metric",
  cost: "drillSession.followup.cost",
  retrospective: "drillSession.followup.retrospective",
};
