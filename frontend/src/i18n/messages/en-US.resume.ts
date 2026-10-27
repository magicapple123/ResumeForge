// SPDX-License-Identifier: Apache-2.0
/**
 * Resume detail and preview surface: the Resume detail modal (fallback title, linked Job
 * row, load and relayout errors), its footer action bar, the page layout diagnosis card,
 * the line spacing control and the "used for this Resume" summary in the generate dialog.
 *
 * Keys this surface already uses stay where they are (`workbench.close.*`,
 * `resume.preview.close.body`, `resume.measure.hintTemplate`, `resume.detail.group-usage.*`)
 * and are deliberately not duplicated here: spread order would silently overwrite a copy.
 */
const resume = {
  "resume.detail.titleFallback": "Resume preview",
  "resume.detail.loadFailed": "Could not load the Resume",
  "resume.detail.relayoutFailed": "Could not re-layout with the new settings",
  "resume.detail.link.job": "View linked Job",
  "resume.detail.link.progress": "Application progress for this Job",
  "resume.detail.link.interview": "Mock interview",

  "resume.footer.edit": "Edit manually",
  "resume.footer.revise": "Revise with AI / Regenerate",
  "resume.footer.suggestionsGenerate": "Generate Job suggestions",
  "resume.footer.suggestionsView": "View Job suggestions",
  "resume.footer.openJob": "View the linked Job",
  "resume.footer.assistant": "Ask the assistant",
  "resume.footer.quality": "Quality check",
  "resume.footer.share": "Offline share",

  "resume.diagnosis.title": "Page layout diagnosis",
  "resume.diagnosis.fill": "Used {percent}%",
  "resume.diagnosis.autofit": "Fit one page",
  "resume.diagnosis.fitting": "Trying step {index}/{total}: {label}",
  "resume.diagnosis.tightest":
    "Typography settings are already at their tightest and the content still does not fit. From here, shorten the content or add a page - page layout diagnosis above lists the exact steps",
  "resume.diagnosis.overflowNoAnalysis":
    "Content exceeds {pages} pages. Font sizes render exactly as you set them, and anything beyond the limit is not shown. Detailed diagnosis is unavailable right now, so try again later",
  "resume.diagnosis.addPage": "Increase to {pages} pages",

  "resume.lineHeight.label": "Line spacing",
  "resume.lineHeight.resetTooltip":
    "Double-click or press Enter to restore the default line spacing",
  "resume.lineHeight.resetLabel": "Line spacing (double-click or press Enter to restore defaults)",
  "resume.lineHeight.sliderLabel": "Line spacing (drag to adjust)",
  "resume.lineHeight.decrease": "Decrease line spacing",
  "resume.lineHeight.increase": "Increase line spacing",

  "resume.generate.groupSummary": "{group} ({count} Sections)",
} as const;

export default resume;
