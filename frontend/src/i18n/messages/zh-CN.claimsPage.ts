// SPDX-License-Identifier: Apache-2.0
/**
 * 事实台账页：标题、统计读数、筛选、条目列表与删除/确认动作的提示。
 *
 * 分类与核实状态的中文值是**协议值**（`types/claim.ts` 定义，提交给后端并参与校验），
 * 这里只把它们的显示名映射成 key：`CATEGORY_LABEL_KEYS` / `STATUS_LABEL_KEYS` 的键是协议值，
 * 值是语言包 key，使用处 `t(MAP[value])`。`types/claim.ts` 一个字都没改。
 */
const claimsPage = {
  "claimsPage.title": "事实台账",
  "claimsPage.subtitle":
    "每条对外说得出的话，都能回到一个出处。只有「已确认」的条目会作为事实进入简历生成；其余说法会被显式避开。",
  "claimsPage.action.drill": "开始深挖",
  "claimsPage.action.fromProfile": "从资料生成",
  "claimsPage.action.create": "新建条目",
  "claimsPage.stat.total": "条目总数",
  "claimsPage.stat.confirmed": "已确认（可进正式简历）",
  "claimsPage.stat.pending": "待确认",
  "claimsPage.stat.baseline": "生成时可用的事实",
  "claimsPage.stat.blocked": "会被避开的未确认说法",
  "claimsPage.filter.categoryAria": "事实分类筛选",
  "claimsPage.filter.statusAria": "事实核实状态筛选",
  "claimsPage.filter.allCategories": "全部分类",
  "claimsPage.filter.allStatuses": "全部状态",
  "claimsPage.filter.countSuffix": "（{count}）",
  "claimsPage.filter.searchPlaceholder": "搜索标题、主体、事实或表述",
  "claimsPage.status.confirmed": "已确认",
  "claimsPage.status.pending": "待确认",
  "claimsPage.status.expired": "已过期",
  "claimsPage.status.rejected": "不采用",
  "claimsPage.category.education": "教育经历",
  "claimsPage.category.internship": "实习/工作",
  "claimsPage.category.project": "项目经历",
  "claimsPage.category.campus": "校园经历",
  "claimsPage.category.skills": "专业技能",
  "claimsPage.category.awards": "荣誉奖项",
  "claimsPage.category.other": "其他",
  "claimsPage.deleteNoun": "条台账",
  "claimsPage.empty.filtered": "没有符合条件的条目",
  "claimsPage.empty.initial": "事实台账还是空的。可以先「从资料生成」一批草稿，或者手工新建一条。",
  "claimsPage.pagination.total": "共 {count} 条",
  "claimsPage.toast.confirmed": "已标记为已确认",
  "claimsPage.toast.confirmedWithTodo": "已标记为已确认，但还有待办：{warning}",
  "claimsPage.error.confirmFailed": "标记为已确认失败",
  "claimsPage.toast.batchDeleted": "已删除 {count} 条台账条目，可在「回收站」里恢复",
  "claimsPage.error.batchDeleteFailed": "批量删除失败，请重试",
  "claimsPage.error.deleteFailed": "删除失败",
  "claimsPage.error.loadFailed": "加载条目失败",
} as const;

export default claimsPage;
