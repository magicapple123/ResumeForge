// SPDX-License-Identifier: Apache-2.0
/**
 * 资料表单弹窗：说明、字段标签与占位符、附件提示，以及附件校验 / 读取失败的提示与
 * 提交动作。
 *
 * 分类的兜底值 `其他` 是协议值（`category.trim() || "其他"` 会提交后端并作为分组键），
 * 不在本文件；分类下拉的选项文字来自后端返回的自定义分类与 `MATERIAL_CATEGORIES`，
 * 同样原样显示。
 */
const materialForm = {
  "materialForm.error.imageTooLarge": "单张图片不能超过 2 MB",
  "materialForm.error.maxImages": "一份资料最多附加 {count} 张图片",
  "materialForm.error.maxFiles": "一份资料最多附加 {count} 个文件",
  "materialForm.error.uploadFailed": "上传附件失败，请重试",
  "materialForm.error.legacyDoc": "Word 2003 的 .doc 读不了，请先另存为 .docx 再添加",
  "materialForm.warning.needContent": "请至少填写标题、内容、链接或添加附件",
  "materialForm.error.unsupported": "只支持 png/jpg/webp 图片与 pdf/docx/txt/md/json/csv 文件",
  "materialForm.title.edit": "编辑资料",
  "materialForm.title.create": "放入资料",
  "materialForm.action.save": "保存资料",
  "materialForm.action.addAttachment": "添加附件",
  "materialForm.hint.drop": "松开即可添加附件",
  "materialForm.intro":
    "资料箱用来放还没整理进简历的零散资料：证书、作品说明、链接、笔记等。求职助手可以读取这里的内容并按需引用。",
  "materialForm.hint.shortcut": "Ctrl / ⌘ + Enter 或 S 保存，Esc 取消",
  "materialForm.hint.dropNote": "也可以直接拖进来；支持图片、PDF、Word 与文本文件，原件会一并保存",
  "materialForm.label.title": "标题",
  "materialForm.label.category": "分类",
  "materialForm.label.content": "正文内容",
  "materialForm.label.url": "相关链接",
  "materialForm.label.attachments": "附件（最多 {count} 个，其中图片最多 {images} 张）",
  "materialForm.label.note": "备注",
  "materialForm.placeholder.title": "如：CET-6 成绩单 / 个人作品集链接",
  "materialForm.placeholder.category": "选择或输入一个新分类",
  "materialForm.placeholder.content": "粘贴资料原文，或写下要点说明",
  "materialForm.placeholder.url": "https://…（选填）",
  "materialForm.placeholder.note": "为什么留下它、还缺什么（选填）",
  "materialForm.file.image": "图片 · {size} KB",
  "materialForm.file.text": "文字 {count} 字",
  "materialForm.file.originalOnly": "原件已保存",
  "materialForm.warning.attachmentTitle": "以下附件没能提取文字，仍可用「另存为」保存原件",
  "materialForm.warning.attachment": "{name}：{warning}",
  "materialForm.aria.removeFile": "移除附件 {name}",
} as const;

export default materialForm;
