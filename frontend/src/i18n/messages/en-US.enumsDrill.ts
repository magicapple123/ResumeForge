// SPDX-License-Identifier: Apache-2.0
/**
 * Display names for interview deep-dive enums: feedback policy, rehearsal question kinds,
 * action kinds and their one-line hints.
 *
 * The Chinese pack carries the exact strings from `types/drill.ts`; protocol values
 * themselves (`deferred` / `variant` / the backend's Chinese action kinds) are never
 * translated, only the display names below.
 */
const enumsDrill = {
  "enumsDrill.feedbackPolicy.deferred": "Simulation: feedback at the end",
  "enumsDrill.feedbackPolicy.immediate": "Practice: feedback after each question",
  "enumsDrill.rehearseKind.variant": "Variant: change one input or constraint",
  "enumsDrill.rehearseKind.counterfactual":
    "Counterfactual: would the plan still hold if the conditions changed?",
  "enumsDrill.rehearseKind.failure": "Failure case: given a symptom, find the cause",
  "enumsDrill.rehearseKind.evidence": "Evidence: explain the code, data, logs or metric definition",
  "enumsDrill.rehearseKind.compress": "Compressed answer: make the same claim in 60 seconds",
  "enumsDrill.actionKind.addFact": "Add facts",
  "enumsDrill.actionKind.addKnowledge": "Fill knowledge gaps",
  "enumsDrill.actionKind.downgradeClaim": "Soften the claim",
  "enumsDrill.actionKindHint.addFact":
    "You did this work but never wrote down the details — add the decisions, hard parts and exact wording.",
  "enumsDrill.actionKindHint.addKnowledge": "You genuinely do not know this yet — go learn it.",
  "enumsDrill.actionKindHint.downgradeClaim":
    "The facts do not hold up — soften that line on your resume instead of forcing it.",
} as const;

export default enumsDrill;
