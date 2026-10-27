// SPDX-License-Identifier: Apache-2.0
/**
 * 材料表单弹窗：附件校验、读取失败的提示与提交动作。
 *
 * 分类的兜底值 `其他` 是协议值（`category.trim() || "其他"` 会提交后端并作为分组键），
 * 不在本文件；表单 label 与占位符留待下一批。
 */
const materialForm = {
  "materialForm.error.imageTooLarge": "A single image cannot exceed 2 MB",
  "materialForm.error.maxImages": "A material can hold at most {count} images",
  "materialForm.error.maxFiles": "A material can hold at most {count} files",
  "materialForm.error.readImage": "Could not read the image — try again",
  "materialForm.warning.noText": "This file has no readable text",
  "materialForm.error.readFile": "Could not read the file — try again",
  "materialForm.warning.needContent": "Fill in a title, content or a link, or add an attachment",
  "materialForm.error.unsupported": "Only images and text files (.txt/.md/.csv …) are supported",
  "materialForm.title.edit": "Edit material",
  "materialForm.title.create": "Add material",
  "materialForm.action.save": "Save material",
  "materialForm.action.addImage": "Add image",
  "materialForm.action.addText": "Add text file",
  "materialForm.hint.drop": "Drop to add the attachment",
} as const;

export default materialForm;
