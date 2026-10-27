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
  "jobImport.toast.imported": "已导入 {count} 个岗位",
  "jobImport.toast.chunkFailed": "第 {chunk} 批导入失败（已导入 {imported} 个岗位）：{message}",
  "jobImport.toast.retryHint": "请检查网络后重试",
  "jobImport.toast.duplicates": "{count} 行与已有岗位重复，已跳过",
  "jobImport.toast.failed": "{count} 行导入失败，详见弹窗中的错误列表",
  "jobImport.toast.failedGeneric": "导入失败",
  "jobImport.title": "导入岗位 CSV",
  "jobImport.template.fileName": "岗位导入模板.csv",
  "jobImport.pasted.fileName": "粘贴内容.csv",
  "jobImport.action.downloadTemplate": "下载空模板",
  "jobImport.action.confirm": "确认导入 {count} 条",
  "jobImport.dropzone.aria": "CSV 导入区",
  "jobImport.dropzone.text": "点击或拖拽 CSV 文件到这里（可多选）",
  "jobImport.dropzone.hint1":
    "第一行是表头（岗位名称 / 公司名称 / 工作地点 / 薪资范围 / 岗位类型 / 状态 / 投递链接 / 发布时间…），也可以先用「导出 CSV」拿一份现成模板；一次最多 10 个文件、合计 2000 行",
  "jobImport.dropzone.hint2": "也可以直接在这块区域按 Ctrl+V 粘贴从表格复制的 CSV 内容",
  "jobImport.parsing": "正在解析…",
  "jobImport.summary": "已选 {files} 个文件：合计可导入 {rows} 条",
  "jobImport.summary.errors": "，{count} 行有问题",
  "jobImport.summary.duplicates": "，已去除重复 {count} 行",
  "jobImport.tag.parsing": "解析中…",
  "jobImport.tag.importable": "可导入 {count} 条",
  "jobImport.tag.parseFailed": "解析失败",
  "jobImport.tag.errorRows": "{count} 行有问题",
  "jobImport.tag.duplicates": "重复 {count} 行",
  "jobImport.action.remove": "移除",
  "jobImport.skipped.title": "以下行不会导入（改好 CSV 后可以重新选择文件）",
  "jobImport.skipped.line": "第 {line} 行",
  "jobImport.preview.title": "将导入以下岗位（最多显示前 10 条）",
  "jobImport.untitled": "（无标题）",
  "jobImport.preview.source": " · 来源：{source}",
} as const;

export default jobImport;
