// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位表单里的两个展示区块：备注图片（`NoteImagesField`）与识别区块
 * （`RecognitionSourceSection`）的标签、占位符、提示与无障碍名。
 */
const jobsForm = {
  /** 备注图片表单域的标签（`{count}` 与后端上限一致）。 */
  "jobsForm.noteImages.label": "备注图片（选填，最多 {count} 张）",
  /** 添加图片按钮。 */
  "jobsForm.noteImages.add": "添加图片",
  /** 图片用途与体积说明。 */
  "jobsForm.noteImages.hint": "招聘截图、内推码等，每张不超过 2 MB",
  /** 缩略图的替代文本。 */
  "jobsForm.noteImages.imageAlt": "备注图片 {index}",
  /** 移除某张图片的无障碍名。 */
  "jobsForm.noteImages.remove": "移除备注图片 {index}",
  /** 招聘原文表单域的标签（视觉标签与无障碍名共用）。 */
  "jobsForm.recognition.label": "完整招聘信息",
  /** 招聘原文的占位符：文本、截图、文档三种录入方式写在同一句里。 */
  "jobsForm.recognition.placeholder":
    "粘贴岗位名称、地点、岗位描述、任职要求等完整招聘信息，或按 Ctrl+V 直接贴招聘截图（也可以上传 pdf/docx 招聘文档）",
  /** 触发识别的按钮。 */
  "jobsForm.recognition.submit": "识别并填充",
  /** 多条识别警告合成一句时的分隔符（中文全角分号，英文用 `"; "`）。 */
  "jobsForm.recognition.warningSeparator": "；",
} as const;

export default jobsForm;
