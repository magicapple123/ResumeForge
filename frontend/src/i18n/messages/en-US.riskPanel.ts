// SPDX-License-Identifier: Apache-2.0
/**
 * The Resume risk scan panel: scan state, risk category vocabulary, the risk point list,
 * the AI review toggle and result notices.
 *
 * Every category keeps its display name and description side by side (label / description);
 * the component only maps each `RiskCategory` protocol value to a key. The intro paragraph
 * that used inline `<strong>` emphasis is merged into a single key with the tag dropped and
 * the emphasis carried by the wording (same precedent as zh-CN.datasets.ts).
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
  "riskPanel.category.duplicate.label": "Duplicate",
  "riskPanel.category.duplicate.description": "The same point appears more than once in the Resume",
  "riskPanel.category.sensitive.label": "Sensitive info",
  "riskPanel.category.sensitive.description":
    "ID numbers / bank cards / exact birthdates / home address / salary",
  "riskPanel.category.exaggeration.label": "Exaggeration",
  "riskPanel.category.exaggeration.description":
    "Absolute wording such as “expert” or “world number one”, plus metrics of 100% or more",
  "riskPanel.category.deepDive.label": "Deep-dive risks",
  "riskPanel.category.deepDive.description":
    "Strong claims an interviewer will probe (linked to the fact ledger for prep angles)",
  "riskPanel.category.compliance.label": "Compliance check",
  "riskPanel.category.compliance.description":
    "NDA-related wording such as confidential, undisclosed or classified",
  "riskPanel.severity.high": "High",
  "riskPanel.severity.medium": "Medium",
  "riskPanel.severity.low": "Low",
  "riskPanel.scanDuration": "took {duration}",
  "riskPanel.intro.summary":
    "Scanning only checks and flags issues — it never rewrites any text, and whether and how to change anything is up to you.",
  "riskPanel.intro.estimatedTime":
    "Estimated time: local rules usually take 1–3 seconds; AI review usually takes around ten seconds and falls back to local results after 45 seconds.",
  "riskPanel.intro.background":
    "You can close this window while scanning; it keeps running in the background and notifies you when it finishes.",
  "riskPanel.action.start": "Start scan",
  "riskPanel.scanning.elapsed": "Scanning… {elapsed}s elapsed",
  "riskPanel.scanning.hint": "You can close this window; the scan keeps running",
  "riskPanel.enhance.note.on":
    "When on, the masked Resume is sent to your locally configured model for review (name, phone, email and company are masked); the fact ledger sends structure only.",
  "riskPanel.enhance.note.off": "Off: local rules only, nothing is sent to the model.",
  "riskPanel.enhance.tooltip.on":
    "When on, your configured model reviews the Resume — only the masked text is sent (name, phone, email and company are masked); the fact ledger sends structure only, such as counts and ownership levels, never the entry text. When off, only local rules run and nothing goes online.",
} as const;

export default riskPanel;
