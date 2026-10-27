// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位 CSV 导入弹窗。
 *
 * **CSV 列名不在本文件**：模板表头（岗位名称 / 公司名称 …）同时是解析时的匹配依据，
 * 翻译它会让导出的模板再导入时全部匹配不上。列名属于协议值，保持中文。
 *
 * 「粘贴内容」的临时文件名（`jobImport.pasted.fileName`）只是界面标签、不落库，随语言变化。
 */
const jobImport = {
  "jobImport.toast.imported": "Imported {count} Jobs",
  "jobImport.toast.chunkFailed":
    "Batch {chunk} failed (already imported {imported} Jobs): {message}",
  "jobImport.toast.retryHint": "check your network and try again",
  "jobImport.toast.duplicates": "{count} rows duplicated existing Jobs and were skipped",
  "jobImport.toast.failed": "{count} rows failed — see the error list in the dialog",
  "jobImport.toast.failedGeneric": "Could not import",
  "jobImport.title": "Import Jobs from CSV",
  "jobImport.template.fileName": "job-import-template.csv",
  "jobImport.pasted.fileName": "pasted-content.csv",
  "jobImport.action.downloadTemplate": "Download blank template",
  "jobImport.action.confirm": "Import {count} rows",
  "jobImport.dropzone.aria": "CSV import area",
  "jobImport.dropzone.text": "Click or drag CSV files here (multiple allowed)",
  "jobImport.dropzone.hint1":
    "The first row is the header (Job title / Company / Location / Salary range / Job type / Status / Apply link / Posted on …). You can also export a ready-made template first. Up to 10 files and 2000 rows at a time",
  "jobImport.dropzone.hint2":
    "You can also paste CSV copied from a spreadsheet into this area with Ctrl+V",
  "jobImport.parsing": "Parsing…",
  "jobImport.summary": "{files} files selected: {rows} rows can be imported",
  "jobImport.summary.errors": ", {count} rows have problems",
  "jobImport.summary.duplicates": ", removed {count} duplicate rows",
  "jobImport.tag.parsing": "Parsing…",
  "jobImport.tag.importable": "{count} importable",
  "jobImport.tag.parseFailed": "Parse failed",
  "jobImport.tag.errorRows": "{count} rows have problems",
  "jobImport.tag.duplicates": "{count} duplicates",
  "jobImport.action.remove": "Remove",
  "jobImport.skipped.title":
    "These rows will not be imported (fix the CSV and choose the file again)",
  "jobImport.skipped.line": "Line {line}",
  "jobImport.preview.title": "Jobs to import (showing the first 10)",
  "jobImport.untitled": "(Untitled)",
  "jobImport.preview.source": " · Source: {source}",
} as const;

export default jobImport;
