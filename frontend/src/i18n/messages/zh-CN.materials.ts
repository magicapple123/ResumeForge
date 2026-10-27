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
} as const;

export default materials;
