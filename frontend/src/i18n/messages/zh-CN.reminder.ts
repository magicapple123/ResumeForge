// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒面板：卡片、视图切换、新建/编辑表单、详情抽屉与删除确认。
 *
 * 删除确认正文这里写成完整句，而不是引用 `TRASH_RECOVERY_NOTE`：那个常量是十三个
 * 删除入口的唯一出口，要连它一起改必须同时动 rowActionMenu 与全部调用点（另一批）。
 * 在英文包还没有对应的 note 之前，把它拼进英文句子里会出现"半句中文"，
 * 所以本文件先用自己的完整句；等那批统一收口时再合并。
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
  "reminder.field.kind": "类型",
  "reminder.field.track": "绑定漏斗（选填）",
  "reminder.placeholder.track": "输入关键词搜索进度",
  "reminder.field.job": "绑定岗位（选填）",
  "reminder.placeholder.job": "输入关键词搜索岗位",
  "reminder.field.resume": "绑定简历（选填）",
  "reminder.placeholder.resume": "输入关键词搜索简历",
  "reminder.field.note": "备注",
  "reminder.placeholder.note": "补充说明（选填）",

  "reminder.detail.title": "提醒详情",
  "reminder.detail.track": "绑定漏斗",
  "reminder.detail.job": "绑定岗位",
  "reminder.detail.resume": "绑定简历",
  "reminder.detail.createdAt": "创建时间",
  "reminder.detail.updatedAt": "更新时间",
  "reminder.detail.none": "（无）",
  "reminder.action.markDone": "标记完成",
  "reminder.action.edit": "编辑",
} as const;

export default reminder;
