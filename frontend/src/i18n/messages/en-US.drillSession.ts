// SPDX-License-Identifier: Apache-2.0
/**
 * Active practice session: evidence labels, follow-up directions, and the in-session copy.
 *
 * The evidence status values are protocol values (`verified` / `partial` / `unverified` /
 * `contradictory` / `not_covered`, see `types/drill.ts`), and so are the follow-up kinds.
 * This file only holds the display names; the Chinese tables in `types/drill.ts` are
 * untouched because other consumers still read them.
 */
const drillSession = {
  "drillSession.evidence.verified": "Verified",
  "drillSession.evidence.partial": "Partially verified",
  "drillSession.evidence.unverified": "Unverified",
  "drillSession.evidence.contradictory": "Contradictory",
  "drillSession.evidence.notCovered": "Not covered",

  "drillSession.evidenceHint.verified": "All required evidence was covered",
  "drillSession.evidenceHint.partial": "Covered in part, with clear gaps",
  "drillSession.evidenceHint.unverified": "Did not provide the minimum required facts",
  "drillSession.evidenceHint.contradictory": "Conflicts with the fact log or earlier answers",
  "drillSession.evidenceHint.notCovered": "Not asked in this round",

  "drillSession.followup.background": "Background",
  "drillSession.followup.responsibility": "Responsibilities",
  "drillSession.followup.structure": "Structure",
  "drillSession.followup.implementation": "Implementation",
  "drillSession.followup.decision": "Decisions",
  "drillSession.followup.alternative": "Alternatives",
  "drillSession.followup.failure": "Failures and debugging",
  "drillSession.followup.metric": "Metric definitions",
  "drillSession.followup.cost": "Trade-offs",
  "drillSession.followup.retrospective": "Retrospective",

  "drillSession.answerRequired": "Write down your answer first",
  "drillSession.submitFailed": "Could not submit the answer",
  "drillSession.finishedScan": "That was the last question; the review is ready",
  "drillSession.stoppedScan": "Session ended; the review is ready",
  "drillSession.stopFailed": "Could not end the session",
  "drillSession.lastVerdict": "Last verdict: {label}",
  "drillSession.deferredNotice":
    "Realistic mode: the verdict is recorded and reviewed together at the end.",
  "drillSession.missing": "Still missing: {items}",
  "drillSession.contradictions": "Contradictions: {items}",
  "drillSession.separator.list": "; ",
  "drillSession.questionProgress": "Question {current} of {total}",
  "drillSession.followupDepth": "Follow-up {count} on the same claim",
  "drillSession.contractSummary": "How this question is scored (locked before asking)",
  "drillSession.contractIntent": "Verifying: {intent}",
  "drillSession.contractRequired": "Must cover:",
  "drillSession.contractTriggers": "These will trigger a follow-up:",
  "drillSession.contractNextFollowup": "Next follow-up direction: {kind}",
  "drillSession.answerPlaceholder":
    "Describe what you actually did. If you did not do it, say so - nothing here invents on your behalf, and anything invented has to be paid back at the interview.",
  "drillSession.submit": "Submit answer",
  "drillSession.stopConfirmTitle": "End this session and get the review?",
  "drillSession.stopConfirmBody": "Verdicts already answered are kept.",
  "drillSession.stopConfirmOk": "End and review",
  "drillSession.stopConfirmCancel": "Keep answering",
  "drillSession.stopEarly": "End early",
  "drillSession.generating": "Generating the next question…",
  "drillSession.generatingHint":
    "If nothing changes for a long time, choose End early to get a review from the verdicts so far.",
  "drillSession.transcriptSummary": "Turn-by-turn record ({count} turns)",
  "drillSession.turnQuestion": "Q: {question}",
  "drillSession.turnAnswer": "A: {answer}",
} as const;

export default drillSession;
