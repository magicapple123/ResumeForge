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
  "applyRecords.toast.movedToTrash": "已移入回收站",
  "applyRecords.toast.batchDeleted": "已删除 {count} 条投递记录，可在「回收站」里恢复",
  "applyRecords.error.retryFailed": "重投失败",
  "applyRecords.error.deleteFailed": "删除失败",
  "applyRecords.error.batchDeleteFailed": "批量删除失败，请重试",
} as const;

export default applyRecords;
