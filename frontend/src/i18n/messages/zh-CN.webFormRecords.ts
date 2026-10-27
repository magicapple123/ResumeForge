// SPDX-License-Identifier: Apache-2.0
/**
 * 网申「填充记录」面板：列表摘要、明细表、批量删除与分页。
 *
 * `ITEM_STATUS_META` 的状态键（filled / unverified / failed / skipped / conflict）是协议值，
 * 只有显示名走 `labelKey`；批量正文的 `{note}` 插的是 `common.note.trashRecovery`（共用 key）。
 */
const webFormRecords = {
  "webFormRecords.column.field": "字段",
  "webFormRecords.column.value": "填入的值",
  "webFormRecords.column.status": "结果",
  "webFormRecords.status.filled": "已填入",
  "webFormRecords.status.unverified": "待核对",
  "webFormRecords.status.failed": "失败",
  "webFormRecords.status.skipped": "已跳过",
  "webFormRecords.status.conflict": "冲突",
  "webFormRecords.action.deleteSelected": "删除所选",
  "webFormRecords.confirm.batchTitle": "删除选中的填充记录？",
  "webFormRecords.confirm.batchBody": "这 {count} 条填充记录{note}",
  "webFormRecords.confirm.deleteOne": "删除这条填充记录？会进回收站，之后可以恢复。",
  "webFormRecords.toast.deleted": "已删除 {count} 条填充记录",
  "webFormRecords.toast.partialDeleted": "已删除 {done} 条，{failed} 条失败，请重试",
  "webFormRecords.error.load": "读取填充记录失败",
  "webFormRecords.empty.none": "还没有填充记录",
  "webFormRecords.aria.selectRecord": "选择填充记录 {id}",
  "webFormRecords.untitled": "（无标题）",
  "webFormRecords.tag.filled": "成功 {count}",
  "webFormRecords.tag.unverified": "待核对 {count}",
  "webFormRecords.tag.failed": "失败 {count}",
  "webFormRecords.tag.live": "逐项填",
  "webFormRecords.field.page": "页面",
  "webFormRecords.table.empty": "这一轮没有可填的字段",
  "webFormRecords.snapshot.summary":
    "填完后页面上共 {filled} 个框是我们填的；其余为你原有的内容或页面自己算出来的。",
  "webFormRecords.pagination.total": "共 {count} 条",
} as const;

export default webFormRecords;
