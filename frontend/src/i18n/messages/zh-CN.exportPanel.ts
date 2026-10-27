// SPDX-License-Identifier: Apache-2.0
/**
 * 导出面板的文案（格式 / 水印 / 脱敏 / 字体缺失 / 结果提示）。
 *
 * 「未完成标记」那组复用 core 里既有的 `export.incomplete.*` 与 `export.action.export`
 * ——它们早就存在、只是面板还在写死中文；本文件只补面板其余部分。
 */
const exportPanel = {
  "exportPanel.title": "导出",
  "exportPanel.action.print": "浏览器打印",
  "exportPanel.format.title": "格式",
  "exportPanel.format.includePhoto": "包含照片",
  "exportPanel.format.pdfNote":
    "PDF 与 Word 由服务端排版引擎生成，保证文字可提取；自编 HTML 的复杂版式请在浏览器中打开 HTML 文件后打印导出。",
  "exportPanel.format.pngNote": "图片由同一份 PDF 逐页转出（300dpi），多页会打成一个 zip。",
  "exportPanel.watermark.title": "水印",
  "exportPanel.watermark.aria": "开启水印",
  "exportPanel.watermark.placeholder": "水印文案，例如：内部使用",
  "exportPanel.redact.title": "脱敏",
  "exportPanel.redact.aria": "开启脱敏",
  "exportPanel.font.missingPdf": "系统里没有找到中文字体，PDF 需要走「浏览器打印」生成。",
  "exportPanel.font.missingImage":
    "系统里没有找到中文字体，暂时无法生成图片：请先用「浏览器打印」导出 PDF。",
  "exportPanel.toast.packDone": "共 {pages} 页，已打包成 {filename}",
  "exportPanel.toast.needFormat": "请至少选择一种导出格式",
  "exportPanel.toast.savedTo": "已保存到 {path}",
  "exportPanel.toast.savedBoth": "已同时保存到 {path}",
  "exportPanel.toast.overLimit": "「{format}」共 {pages} 页，超过所选 {limit} 页上限。",
  "exportPanel.toast.started": "已开始导出",
  "exportPanel.toast.failed": "导出失败",
  "exportPanel.toast.printFailed": "打开打印窗口失败",
  "exportPanel.fileName": "{record}-简历.pdf",

  /** 格式与脱敏字段的词表：导出面板、脱敏弹窗、分享包三处共用，必须在语言包里各留一份。 */
  "exportPanel.format.pdf": "PDF",
  "exportPanel.format.docx": "Word",
  "exportPanel.format.html": "HTML",
  "exportPanel.format.md": "Markdown",
  "exportPanel.format.txt": "纯文本",
  "exportPanel.format.json": "JSON",
  "exportPanel.format.png": "图片（PNG）",
  "exportPanel.format.pngHint": "图片用于必须上传图片的投递平台；需要机器筛选（ATS）时请用 PDF。",
  "exportPanel.redact.name": "姓名",
  "exportPanel.redact.phone": "手机",
  "exportPanel.redact.email": "邮箱",
  "exportPanel.redact.github": "GitHub",
  "exportPanel.redact.website": "个人主页",
  "exportPanel.redact.company": "公司",
  "exportPanel.redact.school": "学校",
  "exportPanel.redact.project": "项目",
  "exportPanel.redact.product": "产品名（正文）",
} as const;

export default exportPanel;
