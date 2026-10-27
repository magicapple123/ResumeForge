// SPDX-License-Identifier: Apache-2.0
/**
 * 知识库条目编辑弹窗：标题、分类、标签、来源与 Markdown 正文的标签、占位符与说明。
 *
 * 分类与来源的兜底值 `其他` / `手动录入` 是协议值（写进提交给后端的 payload，也是列表
 * 的分组键），不在本文件；分类下拉的选项文字来自后端返回的自定义分类与
 * `KNOWLEDGE_CATEGORIES`，同样原样显示。
 */
const knowledgeForm = {
  "knowledgeForm.title.edit": "编辑知识条目",
  "knowledgeForm.title.create": "新建知识",
  "knowledgeForm.action.save": "保存知识",
  "knowledgeForm.intro":
    "知识库用来沉淀愿意反复查阅的成文内容：面经总结、简历技巧、求职策略、行业笔记等。 正文支持 Markdown，保存后会按标题、列表、表格等结构渲染。",
  "knowledgeForm.hint.shortcut": "Ctrl / ⌘ + Enter 或 S 保存，Esc 取消",
  "knowledgeForm.label.title": "标题",
  "knowledgeForm.label.category": "分类",
  "knowledgeForm.label.tags": "标签",
  "knowledgeForm.label.source": "来源",
  "knowledgeForm.label.content": "正文内容",
  "knowledgeForm.error.titleRequired": "请填写标题",
  "knowledgeForm.placeholder.title": "如：STAR 法则 / 自我介绍模板",
  "knowledgeForm.placeholder.category": "选择或输入一个新分类",
  "knowledgeForm.placeholder.tags": "输入标签后回车，如：简历、STAR、量化",
  "knowledgeForm.placeholder.source": "如：手动录入 / 面经导入",
  "knowledgeForm.placeholder.content":
    "支持 Markdown：\n# 标题\n- 列表项\n**加粗**、`代码`、表格等",
} as const;

export default knowledgeForm;
