// SPDX-License-Identifier: Apache-2.0
/**
 * The experience "reference material" field: the supplementary summary's name and content,
 * the import / replace / remove / preview actions, and the read failures.
 *
 * The summary is a piece of text carried by the Profile form. With no file name the UI falls
 * back to "Manually entered summary", and typing content directly fills in a file name of the
 * same meaning (`manual-summary.md`). Both are display copy, so both are translated - the same
 * treatment the import template file names get in the core pack.
 */
const referenceFile = {
  "referenceFile.label.name": "Supplementary summary name",
  "referenceFile.extra.name":
    "Importing a file fills in the name automatically; you can use any name when typing the content directly",
  "referenceFile.placeholder.name": "e.g. project-summary.md",
  "referenceFile.label.content": "Supplementary summary content",
  "referenceFile.extra.content": "You can type it directly, up to 200,000 characters",
  "referenceFile.placeholder.content":
    "Paste or type a project summary, work outcomes, campus experience details and so on",
  "referenceFile.name.manual": "Manually entered summary",
  "referenceFile.name.manualFile": "manual-summary.md",
  "referenceFile.action.import": "Import file",
  "referenceFile.action.replace": "Replace file",
  "referenceFile.action.remove": "Remove summary",
  "referenceFile.action.view": "View content",
  "referenceFile.hint.drop": "Drop to import the summary file (.md / .txt)",
  "referenceFile.error.extension": "Only .md or .txt summary files are supported",
  "referenceFile.error.nameTooLong": "Summary file names cannot exceed 255 characters",
  "referenceFile.error.size": "Summary files cannot exceed 200 KB",
  "referenceFile.error.readFailed": "Could not read the summary file",
  "referenceFile.error.encoding":
    "The file is not valid UTF-8 - convert its encoding and try again",
  "referenceFile.toast.added": "Summary file added - it applies once all the Profile data is saved",
  "referenceFile.count.chars": "{count} characters",
} as const;

export default referenceFile;
