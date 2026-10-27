// SPDX-License-Identifier: Apache-2.0
/**
 * 知识库页（`pages/KnowledgePage.tsx`）：页头说明、筛选、卡片与批量操作、空态、
 * 错误提示、删除撤销、卡片无障碍名与分页。
 *
 * 分类与标签的选项值来自后端（自定义分类 / 全库标签端点），原样显示，不在本文件；
 * 条目正文、标题、来源也是用户数据，同样不翻译。
 */
const knowledgePage = {
  // ── 页头与行操作 ─────────────────────────────────────────
  "knowledgePage.page.title": "知识库",
  "knowledgePage.page.subtitle":
    "沉淀面经总结、简历技巧、求职策略、行业笔记等成文内容。正文支持 Markdown， 保存后按标题、列表、表格等结构渲染。",
  /** 页头主按钮，也是空态里的主动作（同义复用一条 key）。 */
  "knowledgePage.action.create": "新建知识",
  "knowledgePage.action.edit": "编辑",
  "knowledgePage.action.delete": "删除",
  "knowledgePage.action.batchSelect": "批量选择",
  /** 批量操作条上「删除所选」的数量单位（由调用方传给 BatchDeleteButton）。 */
  "knowledgePage.batch.noun": "条知识",

  // ── 筛选 ─────────────────────────────────────────────────
  "knowledgePage.filter.search.placeholder": "搜索标题或正文",
  "knowledgePage.filter.category.aria": "分类筛选",
  "knowledgePage.filter.tag.aria": "标签筛选",
  "knowledgePage.filter.category.all": "全部分类",
  "knowledgePage.filter.tag.all": "全部标签",

  // ── 空态 ─────────────────────────────────────────────────
  "knowledgePage.empty.none": "还没有知识条目",
  "knowledgePage.empty.filtered": "没有符合筛选条件的条目",

  // ── 错误与提示（`error.message` 是后端原文，透传）─────────
  "knowledgePage.error.loadFailed": "知识库加载失败：{error}",
  "knowledgePage.error.loadEntryFailed": "读取条目失败",
  "knowledgePage.error.saveFailed": "保存失败",
  "knowledgePage.error.deleteFailed": "删除失败",
  "knowledgePage.error.batchDeleteFailed": "批量删除失败，请重试",
  "knowledgePage.toast.updated": "条目已更新",
  "knowledgePage.toast.created": "已加入知识库",
  "knowledgePage.toast.batchDeleted": "已删除 {count} 条知识，可在「回收站」里恢复",

  // ── 卡片无障碍名 ─────────────────────────────────────────
  "knowledgePage.card.openAria": "打开知识条目「{title}」的详情",
  "knowledgePage.card.selectAria": "选择知识条目 {title}",

  // ── 分页 ─────────────────────────────────────────────────
  "knowledgePage.pagination.total": "共 {count} 条",
} as const;

export default knowledgePage;
