// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒面板：卡片、视图切换、新建/编辑表单、详情抽屉与删除确认。
 *
 * 删除确认正文这里写成完整句，而不是复用 `common.note.trashRecovery`（十三个删除入口
 * 共用的后果段）：本句的主语是「提醒」，独立成句更好读，措辞与那条 key 同口径。
 */
const reminder = {
  "reminder.toast.loadFailed": "读取提醒失败",
  "reminder.toast.created": "已新建提醒",
  "reminder.toast.updated": "已更新提醒",
  "reminder.toast.saveFailed": "保存提醒失败",
  "reminder.toast.done": "已标记完成",
  "reminder.toast.ignored": "已忽略",
  "reminder.toast.updateFailed": "更新提醒失败",
  "reminder.toast.deleted": "已删除 {count} 条提醒",
  "reminder.toast.deletedPartial": "已删除 {ok} 条，{failed} 条失败，请重试",
  "reminder.toast.deletedOne": "已删除这条提醒",
  "reminder.toast.deleteFailed": "删除失败",

  "reminder.confirm.deleteTitle": "删除选中的提醒？",
  "reminder.confirm.deleteBody": "这 {count} 条提醒会移入回收站，之后可以在「回收站」里恢复。",
  "reminder.confirm.deleteOneTitle": "删除这条提醒？",
  "reminder.confirm.deleteOneBody": "这条提醒会移入回收站，之后可以在「回收站」里恢复。",

  "reminder.selectMode": "批量选择",
  "reminder.card.title": "日历提醒",
  "reminder.filter.placeholder": "按类型筛选",
  /** 时间范围筛选（T06）：全部 / 已逾期 / 今天 / 以后。 */
  "reminder.filter.range.placeholder": "时间范围",
  "reminder.filter.range.all": "全部",
  "reminder.filter.range.overdue": "已逾期",
  "reminder.filter.range.today": "今天",
  "reminder.filter.range.future": "以后",
  /** 当前筛选下一条都没有时的空态（与"还没有提醒"分开）。 */
  "reminder.emptyFiltered": "当前筛选下没有提醒",
  "reminder.action.create": "新建提醒",
  "reminder.view.list": "列表",
  "reminder.view.calendar": "月历",
  "reminder.empty": "还没有提醒，把面试、测评截止这些时点记下来吧",
  "reminder.batch.delete": "删除所选",
  "reminder.table.total": "共 {count} 条",

  "reminder.modal.edit": "编辑提醒",
  "reminder.modal.save": "保存提醒",
  "reminder.field.content": "提醒内容",
  "reminder.required.content": "请填写提醒内容",
  "reminder.placeholder.content": "例如：参加某司二面",
  "reminder.field.time": "提醒时间",
  "reminder.required.time": "请选择提醒时间",
  /** 新建时不允许过去时间；编辑时放行（只改备注不该被卡）。 */
  "reminder.required.futureTime": "提醒时间需要晚于当前时间",
  /** 时间字段下方的任务卡提示：开关开启。 */
  "reminder.hint.taskCardOn": "到期会生成一张「准备：提醒内容」任务卡，在首页查看",
  /** 时间字段下方的任务卡提示：开关关闭。 */
  "reminder.hint.taskCardOff": "任务卡已关闭，到期只提醒、不生成卡片",
  "reminder.field.kind": "类型",
  /** 三个关联字段的总标题（收进折叠区，默认收起）。 */
  "reminder.field.linkSection": "关联（选填）",
  /** 折叠区收起时标题旁的计数；`{count}` 是已填的关联项数。 */
  "reminder.field.linkedCount": "已关联 {count} 项",
  "reminder.field.track": "关联求职进度（选填）",
  "reminder.placeholder.track": "输入关键词搜索求职进度",
  "reminder.field.job": "关联岗位（选填）",
  "reminder.placeholder.job": "输入关键词搜索岗位",
  "reminder.field.resume": "关联简历（选填）",
  "reminder.placeholder.resume": "输入关键词搜索简历",
  "reminder.field.note": "备注",
  "reminder.placeholder.note": "补充说明（选填）",

  "reminder.detail.title": "提醒详情",
  "reminder.detail.track": "关联求职进度",
  "reminder.detail.job": "关联岗位",
  "reminder.detail.resume": "关联简历",
  "reminder.detail.createdAt": "创建时间",
  "reminder.detail.updatedAt": "更新时间",
  "reminder.action.markDone": "标记完成",
  "reminder.action.edit": "编辑",
} as const;

export default reminder;
