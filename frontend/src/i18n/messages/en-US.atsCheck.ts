// SPDX-License-Identifier: Apache-2.0
/**
 * ATS local check panel: the three category and severity labels, the JD input and the
 * linked-Job auto-load notices, the reference score and keyword coverage, the keyword hit
 * lists, the issue entries, and the "improvement list" copy result and pasteable text.
 */
const atsCheck = {
  "atsCheck.category.format.label": "Format",
  "atsCheck.category.format.cardTitle": "Format risks",
  "atsCheck.category.keyword.label": "Keywords",
  "atsCheck.category.keyword.cardTitle": "Keyword coverage",
  "atsCheck.category.position.label": "Position",
  "atsCheck.category.position.cardTitle": "Information placement",

  "atsCheck.severity.high": "High",
  "atsCheck.severity.medium": "Medium",
  "atsCheck.severity.low": "Low",

  "atsCheck.jd.label": "JD text",
  "atsCheck.jd.placeholder":
    "Optional: paste the job description to check coverage against its keywords (leave blank for generic coverage)",
  "atsCheck.jd.autoLoaded": "Linked Job's JD loaded automatically — you can run the check now",
  "atsCheck.jd.autoFailed":
    "Could not load the linked Job's JD automatically — you can load it manually later",
  "atsCheck.jd.loadFailed": "Could not read the Job details — paste the JD manually instead",

  "atsCheck.action.run": "Run check",
  "atsCheck.action.reloadJd": "Reload the linked Job's JD",
  "atsCheck.action.retry": "Run check again",
  "atsCheck.action.copyImprovements": "Copy improvement list",

  "atsCheck.score.label": "ATS reference score",
  "atsCheck.coverage": "Keyword coverage {percent}%",
  "atsCheck.keywords.matched": "Matched keywords:",
  "atsCheck.keywords.missing": "Missing keywords:",
  "atsCheck.empty": "No obvious issues found",
  "atsCheck.issue.suggestion": "Suggestion:",

  "atsCheck.improvement.copied": "Improvement list copied",
  "atsCheck.improvement.copyFailed": "Copy failed — select the text manually",
  "atsCheck.improvement.head": "{index}. [{severity}] {title}",
  "atsCheck.improvement.suggestion": "Suggestion: {suggestion}",
} as const;

export default atsCheck;
