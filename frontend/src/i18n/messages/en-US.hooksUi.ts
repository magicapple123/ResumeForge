// SPDX-License-Identifier: Apache-2.0
/**
 * Hook-raised UI copy: remote search status and empty state, the resume option fallback
 * label, batch item load failures, recognition file limits, and download status read
 * failures.
 *
 * The hooks resolve these through the module-level `t()` while callbacks or renders run
 * (never at module scope); the page that renders them subscribes to locale changes.
 */
const hooksUi = {
  "hooksUi.remoteSearch.searching": "Searching…",
  "hooksUi.remoteSearch.empty": "No matches — type a keyword to search",

  "hooksUi.option.resumeFallback": "Resume #{id}",

  "hooksUi.batchItems.error.load": "Could not load the batch items",

  "hooksUi.recognition.warning.tooMany": "You can add up to {count} files",
  "hooksUi.recognition.warning.unsupported":
    "“{name}” is not a supported screenshot or document (png/jpg/webp/gif/bmp/tiff, pdf/docx)",
  "hooksUi.recognition.warning.tooLarge": "“{name}” is over 2 MB",
  "hooksUi.recognition.warning.totalTooLarge": "Files cannot exceed 5 MB in total",
  "hooksUi.recognition.error.read": "Could not read the file",

  "hooksUi.updateStatus.error.read":
    "Could not read the download status — try again before downloading or installing",
} as const;

export default hooksUi;
