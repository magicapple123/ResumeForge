// SPDX-License-Identifier: Apache-2.0
/**
 * 投递记录面板：按投递批次分组的记录表（列头、行内操作、软删确认、重投、空态与分页）。
 *
 * 记录的状态标签与失败分类仍取自 `types` 里的映射表（协议值 → 展示名），不在本包范围。
 */
const applyRecords = {
  "applyRecords.column.job": "岗位",
  "applyRecords.column.result": "结果",
  "applyRecords.column.failureKind": "失败分类",
  "applyRecords.column.resume": "简历",
  "applyRecords.column.greeting": "招呼语",
  "applyRecords.column.finishedAt": "投递时间",
  "applyRecords.column.actions": "操作",
  "applyRecords.deletedJob": "（岗位已删除）",
  "applyRecords.defaultGreeting": "（默认）",
  "applyRecords.action.retry": "重投",
  "applyRecords.action.viewDetail": "查看详情",
  "applyRecords.retryHint": "以该条目为唯一目标重新投递（仍走去重与每日上限）",
  "applyRecords.confirm.deleteRecord":
    "删除这条投递记录？会进回收站，之后可以恢复；也会从统计与每日上限里去掉。",
  "applyRecords.deleteNoun": "条投递记录",
  "applyRecords.empty": "还没有投递记录",
  "applyRecords.pagination.total": "共 {count} 个批次",
  "applyRecords.toast.retried": "已新建一个重投批次",
  "applyRecords.toast.retriedFailed": "已重投 {count} 条失败记录",
  "applyRecords.toast.movedToTrash": "已移入回收站",
  "applyRecords.toast.batchDeleted": "已删除 {count} 条投递记录，可在「回收站」里恢复",
  "applyRecords.error.retryFailed": "重投失败",
  "applyRecords.error.retryFailedBatch": "批量重投失败",
  "applyRecords.error.deleteFailed": "删除失败",
  "applyRecords.error.batchDeleteFailed": "批量删除失败，请重试",

  // #14C 跟进闭环：静默提醒条与行内「更新进度」。
  "applyRecords.stale.title": "7 天以上没有回音的有 {count} 条",
  "applyRecords.stale.body": "点「批量标为跟进中」把它们记进求职进度，之后在求职进度里更新阶段。",
  "applyRecords.stale.markAll": "批量标为跟进中",
  "applyRecords.stale.view": "查看这 {count} 条",
  "applyRecords.stale.hide": "收起",
  "applyRecords.stale.line": "{title}｜{company}｜已投 {days} 天",
  "applyRecords.stale.done": "已把 {count} 条标为跟进中",
  "applyRecords.stale.partial": "成功 {ok} 条，{failed} 条没记上，请重试",
  "applyRecords.action.track": "更新进度",
  "applyRecords.track.hint": "在求职进度里留一条记录（已有则复用），之后可在那边更新阶段",
  "applyRecords.toast.tracked": "已在求职进度里记录这条投递",
  "applyRecords.toast.trackUpdated": "已更新求职进度里的这条投递",
  "applyRecords.error.trackFailed": "记到求职进度失败，请重试",
} as const;

export default applyRecords;
