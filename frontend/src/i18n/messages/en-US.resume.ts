// SPDX-License-Identifier: Apache-2.0
/**
 * Resume detail and preview surface: the Resume detail modal (fallback title, linked Job
 * row, load and relayout errors), its footer action bar, the page layout diagnosis card,
 * the line spacing control, the "used for this Resume" summary in the generate dialog, and
 * the fact evidence panel, basic info tab, omitted items notice, AI revise dialog, field
 * level diff, list sort hints and font tier fallbacks.
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

  "resume.diagnostics.entry.diagnosis": "Layout",
  "resume.diagnostics.entry.coverage": "Omitted",
  "resume.diagnostics.entry.evidence": "Sources",
  "resume.diagnostics.entry.rationale": "Why this Resume",
  "resume.diagnostics.aria.diagnosis": "Layout diagnosis details: {label}",
  "resume.diagnostics.aria.coverage": "Profile content left out of this Resume: {count} items",
  "resume.diagnostics.aria.evidence": "Content sources: {count} items",
  "resume.diagnostics.aria.rationale": "Why this Resume was generated this way",

  "workbench.layoutStatus.measuring": "Measuring the layout…",
  "workbench.layoutStatus.summary": "Used {percent}% · {pages} pages of {limit} allowed",
  "workbench.layoutStatus.summaryOverflow":
    "Used {percent}% · {pages} pages of {limit} allowed · {over} over the limit",
  "workbench.layoutStatus.summaryUnlimited": "Needs {pages} pages (no limit)",
  "workbench.layoutStatus.unsaved": "Unsaved",
  "workbench.layoutStatus.dirtyHint":
    "These figures measure your unsaved changes; they match the preview after saving.",

  "workbench.coverage.savedHint":
    'Counted from the saved version. "Add to Resume" writes to the record, so save your workbench changes first.',
  "workbench.coverage.reviseHint":
    "Rewrite this content in the matching section of the middle column.",

  "resume.factSource.profile": "Profile",
  "resume.factSource.ai": "AI written",
  "resume.factSource.manual": "Typed in",
  "resume.factSource.aria": "Content source: {source}. Open to see the source text.",

  "resume.footer.edit": "Edit manually",
  // 页脚主按钮的五个标签按"格子装得下"重定（问题 20b）：五个按钮平分弹窗宽度，
  // 英文界面每格约 176px，原标签最长的 26 字符会溢出到隔壁按钮上。
  // `Revise with AI / Regenerate` 把两个模式塞进一个按钮名，而那两个模式本来就由弹窗
  // 里的 `resume.revise.okTargeted` / `okFull` 各自说明——按钮只需要说清"点它会发生什么"。
  "resume.footer.revise": "Revise with AI",
  "resume.footer.suggestionsGenerate": "Job suggestions",
  "resume.footer.suggestionsView": "View suggestions",
  "resume.footer.openJob": "View job",
  "resume.footer.assistant": "Ask assistant",
  "resume.footer.quality": "Quality check",
  "resume.footer.share": "Offline share",
  "resume.footer.exportPending": "{count} items still need a manual check",

  "resume.diagnosis.title": "Page layout diagnosis",
  "resume.diagnosis.fill": "Used {percent}%",
  "resume.diagnosis.autofit": "Fit one page",
  "resume.diagnosis.expand": "Show details",
  "resume.diagnosis.collapse": "Hide details",
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

  "resume.evidence.title": "Content sources · {count} items",
  "resume.evidence.hint":
    'These facts come from your profile; AI-rewritten parts are never shown as "confirmed", so give them a look before exporting.',
  "resume.evidence.basis": "Basis: {fact}",
  "resume.evidence.boundary": "Personal boundary: {boundary}",
  "resume.evidence.origin.grounded": "Source text",
  "resume.evidence.origin.restored": "Restored text",
  "resume.evidence.origin.enhancedKept": "AI rewrite kept",
  "resume.evidence.origin.aiRewrite": "AI rewrite",
  "resume.evidence.origin.userAdded": "User addition",

  "resume.basicInfo.city": "City",
  "resume.basicInfo.githubPlaceholder": "https://github.com/username",
  "resume.basicInfo.fillSummary": "Fill summary from My Profile",
  "resume.basicInfo.fillSummaryHint":
    "Write the summary from My Profile into this field (it replaces the current text; you can still undo back to the original)",

  "resume.coverage.title": "These profile items were not included in this Resume",
  "resume.coverage.summary": "{count} items",
  "resume.coverage.intro":
    "This is normal for Job-targeted filtering: items with too little overlap with the Job keywords are left out, and nothing is lost from your profile",
  "resume.coverage.sectionCount": "{label} · {count} items",
  "resume.coverage.item": "“{name}”",
  "resume.coverage.itemSeparator": ", ",
  "resume.coverage.revise": "Have AI add this",
  "resume.coverage.openEditor": "Open manual edit",
  "resume.coverage.reason.filtered": "Not job-related",
  "resume.coverage.reason.capacity": "Over the quota",
  "resume.coverage.reason.model": "Model left it out",
  "resume.coverage.reason.unknown": "Reason not stated",
  "resume.coverage.reasonSeparator": ", ",
  "resume.coverage.reasonCount": "{count} {label}",
  "resume.coverage.expandAll": "Show all {count} items",
  "resume.coverage.collapse": "Show less",
  "resume.coverage.append": "Add to Resume",
  "resume.coverage.goWorkbench": "Add in the workbench",
  "resume.coverage.goWorkbenchHint":
    "AI edits can only rewrite existing content, not add new entries",
  "resume.coverage.appended": "Added {count} items",
  "resume.coverage.skipped": "{count} items were already there, not added again",
  "resume.coverage.appendFailed": "Could not add these items, please try again",

  "resume.revise.title": "Revise Resume with AI",
  "resume.revise.okTargeted": "Apply changes",
  "resume.revise.okFull": "Regenerate all",
  "resume.revise.hintTargeted":
    "AI changes only what you ask for and keeps everything else word for word",
  "resume.revise.hintFull":
    "With no instructions, AI regenerates the whole Resume: facts and experience stay the same, wording and structure are reorganized",
  "resume.revise.placeholder":
    "Optional. Example: make the summary highlight data analysis; add quantified results to projects. Leave empty to regenerate the whole Resume. Up to {max} characters.",
  "resume.revise.successTargeted": "Resume updated as requested",
  "resume.revise.successFull": "Resume regenerated",
  "resume.revise.failed": "Could not revise the Resume. Try again later",
  "resume.revise.notAppliedTitle": "This request was not applied",
  "resume.revise.notAppliedFields": "Facts involved:",
  "resume.revise.blockedField": "{label}: {value}",
  "resume.revise.notAppliedAction":
    "Wording changes can be retried right away; to change facts, unlock the fields in the fact lock first",

  "resume.fieldDiff.photoPlaceholder": "[Photo]",
  "resume.fieldDiff.line": "{label}: {value}",
  "resume.fieldDiff.listSeparator": ", ",

  "resume.sort.resetHintDefault": "Already using the default sort: recently updated first",
  "resume.sort.resetHint": "Restore the default sort: recently updated first",

  "resume.fontScale.small": "Small",
  "resume.fontScale.standard": "Standard",
  "resume.fontScale.large": "Large",
} as const;

export default resume;
