// SPDX-License-Identifier: Apache-2.0
/**
 * 材料表单弹窗：附件校验、读取失败的提示与提交动作。
 *
 * 分类的兜底值 `其他` 是协议值（`category.trim() || "其他"` 会提交后端并作为分组键），
 * 不在本文件；表单 label 与占位符留待下一批。
 */
const materialForm = {
  "materialForm.error.imageTooLarge": "单张图片不能超过 2 MB",
  "materialForm.error.maxImages": "一份资料最多附加 {count} 张图片",
  "materialForm.error.maxFiles": "一份资料最多附加 {count} 个文件",
  "materialForm.error.readImage": "读取图片失败，请重试",
  "materialForm.warning.noText": "这个文件里没有可读的文字",
  "materialForm.error.readFile": "读取文件失败，请重试",
  "materialForm.warning.needContent": "请至少填写标题、内容、链接或添加附件",
  "materialForm.error.unsupported": "只支持图片与文本文件（.txt/.md/.csv 等）",
  "materialForm.title.edit": "编辑资料",
  "materialForm.title.create": "放入资料",
  "materialForm.action.save": "保存资料",
  "materialForm.action.addImage": "添加图片",
  "materialForm.action.addText": "添加文本文件",
  "materialForm.hint.drop": "松开即可添加附件",
} as const;

export default materialForm;
