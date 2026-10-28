// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产页（「资料箱」）：列表、筛选、详情抽屉、附件与空态。
 *
 * 带单位的句子（附件数、文件大小、正文字数）一律整句成 key 并带占位符：中文靠「个」
 * 「字」计数，英文没有对应量词，拆词拼会得到 "3 attachments 个" 这种半句。
 */
const materials = {
  "materials.page.title": "资料箱",
  "materials.page.subtitle1":
    "这里放与找工作、面试相关的资料：证书、作品、面经、公司信息、面试复盘、实习材料、链接与笔记。",
  "materials.page.subtitle2":
    "助手可以读它们、帮你归类整理、总结某一条，或把某条内容整理进个人资料。",
  "materials.action.create": "放入资料",
  "materials.action.edit": "编辑",
  "materials.action.delete": "删除",
  "materials.selectMode": "批量选择",
  "materials.tab.materials": "资料",
  "materials.tab.files": "我的文件",
  "materials.search.placeholder": "搜索标题、正文或备注",
  "materials.filters.aria": "资料分类筛选",
  "materials.filter.all": "全部分类",
  "materials.noun": "份资料",
  "materials.untitled": "（未命名资料）",
  "materials.link": "链接",
  "materials.attachments": "{count} 个附件",
  "materials.table.total": "共 {count} 条",
  "materials.error.loadFailed": "资料箱加载失败：{error}",
  "materials.empty.none": "还没有资料",
  "materials.empty.filtered": "没有符合筛选条件的资料",
  "materials.aria.open": "打开资料「{title}」的详情",
  "materials.aria.select": "选择资料 {title}",

  "materials.toast.updated": "已更新这份资料",
  "materials.toast.added": "已放进资料箱",
  "materials.toast.saveFailed": "保存失败",
  "materials.toast.deleteFailed": "删除失败",
  "materials.toast.batchDeleted": "已删除 {count} 份资料，可在「回收站」里恢复",
  "materials.toast.batchDeleteFailed": "批量删除失败，请重试",
  "materials.toast.detailFailed": "加载资料详情失败",
  "materials.toast.loadFailed": "加载资料失败",

  "materials.detail.attachments": "附件",
  "materials.detail.fileCount": "{count} 个",
  "materials.detail.createdAt": "创建时间",
  "materials.detail.updatedAt": "更新时间",
  "materials.detail.body": "正文",
  "materials.detail.note": "备注",
  "materials.detail.none": "（无）",
  "materials.detail.attachmentsTitle": "附件（{count}）",
  "materials.file.image": "图片 · {size} KB",
  "materials.file.text": "文字 {count} 字",

  /** 附件预览（0066 补）：文档只存了提取出的文本，弹层要如实说明这一点。 */
  "materials.attachments.previewAction": "点击预览",
  "materials.attachments.previewTitle": "附件预览",
  "materials.attachments.previewTextNote":
    "这是系统从文件里提取的文本，不是原文件的排版；原件请到「我的文件」里查看。",
  "materials.attachments.previewEmpty": "该附件没有可预览的内容。",

  /** 「我的文件」面板（当前数据集里用户上传内容的清单）。 */
  "materials.files.searchPlaceholder": "搜索文件名",
  "materials.files.empty": "还没有保存过文件",
  "materials.files.total": "共 {count} 份",
  "materials.files.untitled": "（未命名）",
  "materials.files.column.name": "名称",
  "materials.files.column.type": "类型",
  "materials.files.column.size": "大小",
  "materials.files.column.source": "来源",
  "materials.files.column.savedAt": "保存时间",
  "materials.files.column.actions": "操作",
  "materials.files.action.preview": "预览",
  "materials.files.action.openFolder": "打开文件夹",
  "materials.files.source.material": "资料箱",
  "materials.files.source.photo": "个人照片",
  "materials.files.source.jobNote": "岗位备注图",
  "materials.files.source.candidateImage": "备选岗位截图",
  "materials.files.source.chatAttachment": "助手附件",
  "materials.files.source.unknown": "未知来源",
  "materials.files.pdfPreviewTitle": "PDF 预览",
  "materials.files.toast.loadFailed": "加载文件列表失败",
  "materials.files.toast.revealed": "已打开所在文件夹",
  "materials.files.toast.revealFailed": "打开文件夹失败",
  "materials.files.previewTitle": "文件预览",
  "materials.files.previewLoading": "正在读取文件内容…",
  "materials.files.previewTextNote":
    "下面是系统从文件里提取的文字，不是原文件的排版；要看原件请用「打开所在文件夹」。",
  "materials.files.previewImageTitle": "图片预览",
} as const;

export default materials;
