// SPDX-License-Identifier: Apache-2.0
/** 求职进度里的提醒行：勾选、完成/忽略、详情与菜单。 */
const reminderItem = {
  "reminderItem.aria.select": "选择提醒 {title}",
  "reminderItem.action.detail": "详情",
  "reminderItem.aria.done": "完成提醒 {title}",
  "reminderItem.action.done": "完成",
  "reminderItem.aria.ignore": "忽略提醒 {title}",
  "reminderItem.action.ignore": "忽略",
  "reminderItem.action.edit": "编辑",
  /** CR-28：跳过"这一次"（重复提醒会排下一次），与"删除整条提醒"不同。 */
  "reminderItem.action.skip": "跳过",
  "reminderItem.aria.skip": "跳过这一次提醒 {title}",
  "reminderItem.action.snooze": "稍后",
  "reminderItem.aria.snooze": "稍后提醒 {title}",
  "reminderItem.action.delete": "删除",
  "reminderItem.confirm.delete": "删除这条提醒？",
  /** 逾期红标（T06）：只在 pending 且 days_until < 0 时出现；`{days}` 是逾期天数。 */
  "reminderItem.tag.overdue": "已逾期 {days} 天",
} as const;

export default reminderItem;
