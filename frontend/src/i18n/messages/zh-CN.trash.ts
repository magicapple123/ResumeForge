// SPDX-License-Identifier: Apache-2.0
/**
 * 回收站页：工具栏、表格列、批量操作、清空确认与空态。
 *
 * 「取消」复用 `common.action.cancel`；其余动作词（恢复 / 彻底删除 / 清空）只在本页
 * 出现，留在本命名空间，不动 common。
 */
const trash = {
  "trash.page.title": "回收站",
  "trash.page.subtitle":
    "删除的内容会先到这里，不会直接消失；恢复是一键的。「彻底删除」才会真正抹掉，不可撤销。",
  "trash.selectMode": "批量选择",
  "trash.exitSelect": "退出多选",
  "trash.action.restore": "恢复",
  "trash.action.purge": "彻底删除",
  "trash.action.clear": "清空",
  "trash.batch.restore": "批量恢复（{count}）",
  "trash.batch.purge": "批量彻底删除",

  "trash.column.type": "类型",
  "trash.column.name": "名称",
  "trash.column.deletedAt": "删除时间",
  "trash.column.actions": "操作",
  "trash.untitled": "（无标题）",

  "trash.confirm.purgeOne": "「{title}」将被彻底删除，无法恢复。",
  "trash.confirm.purgeOneTitle": "彻底删除？",
  "trash.confirm.confirmAria": "确认彻底删除 {title}",
  "trash.confirm.cancelAria": "取消彻底删除 {title}",
  "trash.aria.restore": "恢复 {title}",
  "trash.aria.purge": "彻底删除 {title}",

  "trash.batch.confirmTitle": "彻底删除选中的记录？",
  "trash.batch.confirmDescription": "这 {count} 条将彻底删除，无法恢复。",
  "trash.batch.confirmAria": "确认批量彻底删除",
  "trash.batch.cancelAria": "取消批量彻底删除",

  "trash.emptyOut.titleAll": "清空回收站？",
  "trash.emptyOut.titleType": "清空这一类？",
  "trash.emptyOut.description": "将彻底删除 {count} 条内容，无法恢复。",
  "trash.emptyOut.confirmAria": "确认清空回收站",
  "trash.emptyOut.cancelAria": "取消清空回收站",
  "trash.emptyOut.actionAll": "清空回收站",
  "trash.emptyOut.actionType": "清空这一类",

  "trash.filter.all": "全部（{count}）",
  "trash.filter.labeled": "{label}（{count}）",
  "trash.filters.aria": "回收站分类",

  "trash.toast.restored": "已恢复 {count} 条",
  "trash.toast.restoredOne": "已恢复「{title}」",
  "trash.toast.restoredPartial": "已恢复 {ok} 条，{failed} 条恢复失败，请重试",
  "trash.toast.restoreFailed": "恢复失败",
  "trash.toast.purged": "已彻底删除 {count} 条",
  "trash.toast.purgedOne": "已彻底删除「{title}」",
  "trash.toast.purgedPartial": "已彻底删除 {ok} 条，{failed} 条删除失败，请重试",
  "trash.toast.purgeFailed": "彻底删除失败",
  "trash.toast.emptied": "回收站已清空",
  "trash.toast.emptyFailed": "清空回收站失败",

  "trash.tip.title": "回收站里的内容不会出现在其它页面",
  "trash.tip.description":
    "岗位、简历、投递记录、事实台账条目、资料箱里的资料与助手会话——删除后它们立刻从各自的列表、首页统计和搜索里消失，只在这里可见。",
  "trash.emptyState.description": "回收站是空的。删除内容后，它们会出现在这里，可以随时恢复。",
} as const;

export default trash;
