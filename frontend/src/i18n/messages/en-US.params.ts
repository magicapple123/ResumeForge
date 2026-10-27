// SPDX-License-Identifier: Apache-2.0
const params = {
  "gallery.preview.demo": "Thumbnails use built-in sample content and do not read your Resume",
  "gallery.fontScale.scope": "Font size changes apply only to this Resume",
  "gallery.preview.retry": "Retry",
  "gallery.fontScale.label": "Template font size",
  "gallery.zoom.hint":
    "Typeset using your maximum page count and scale each page to the window width",
  "workbench.param.restoreToOpened": "Restore the value from when you opened this Resume",
  "workbench.param.restoreToOpenedAria": "Restore {label} to its value when opened",
  "workbench.param.restored": "Restored the value from when opened",
  "workbench.param.line-height": "Line spacing",
  "writing.menu.entry": "Writing tools",
  "writing.modal.hint-apply":
    "The result can replace the passage you selected. Close without applying to keep the original unchanged.",
  "writing.modal.hint-copy":
    "There is no editable input here. Select Copy, then paste the result where you want it.",
  "writing.hint.title":
    "Three steps: paste text > choose an action > generate, then select Apply text",
  "writing.hint.body":
    "Numbers and proper names stay unchanged. The result replaces only your selected passage, leaving other Resume Fields unchanged. Without an editable target, the action becomes Copy.",
  "writing.hint.star": "Turn responsibilities into statements with context, actions and results",
  "writing.hint.phrases":
    "Create three versions of an experience: STAR / Resume / spoken interview answer",
  "writing.hint.polish":
    "Keep the facts and change the tone: corporate / concise / recent graduate",
  "writing.hint.translate":
    "Change the language without changing the facts, suitable for English-language Jobs",
  "writing.action.apply": "Apply text",
  "writing.apply.success": "Text applied to your selected location",
  "writing.apply.failed":
    "Could not apply text at the original location. The passage may have changed or exceeded the length limit. Choose another action and retry.",
  "writing.action.copy": "Copy",
  "writing.copy.success": "Text copied; paste it where you want it",
  "writing.copy.failed": "Could not copy; select and copy the result manually",
  "resumes.copy.menu": "Copy",
  "resumes.copy.title": "Copy title",
  "resumes.copy.job": "Copy target Job",
  "resumes.copy.company": "Copy company name",
  "resumes.copy.note": "Copy note",
  "resumes.copy.row": "Copy the row as one line for a spreadsheet",
  "resumes.copy.done": "Copied {field}",
  "resumes.copy.failed": "Could not copy; select and copy the text manually in your browser",
  "resumes.copy.field.title": "title",
  "resumes.copy.field.job": "target Job",
  "resumes.copy.field.company": "company name",
  "resumes.copy.field.note": "note",
  "resumes.copy.field.row": "entire row",
  "resumes.copy.source.ai": "AI-generated",
  "resumes.copy.source.manual": "Manually created",
  "resumes.search.placeholder": "Search Resumes",
  "exact.overflow.title": "Current settings need about {needed} pages (limit: {limit} pages).",
  "exact.stale.title": "This PDF may not use your selected font size",
  "exact.stale.body":
    "The running backend is an older version and did not report the pages needed for your settings. It may shrink the font automatically. Fully quit and restart the app to make exact preview use the slider values exactly.",
  "exact.status.busy": "Typesetting with new settings...",
  "exact.status.pages": "Exact preview - {pages} actual pages (limit: {limit} pages)",
  "exact.openNewTab": "Open in new tab",
  "exact.unsavedNote": "This preview includes unsaved changes. Save before exporting",
  "workbench.contactBreak.label": "Contact line breaks",
  "workbench.contactBreak.hint":
    "By default each contact field stays on one line and fields wrap between each other. Select a field to force a line break before it.",
  "workbench.contactBreak.placeholder": "Automatic wrapping",
} as const;

export default params;
