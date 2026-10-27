// SPDX-License-Identifier: Apache-2.0
/**
 * 月历（CalendarView）与进度卡（TrackCard）：月份导航、日期格的读屏标签、当天明细，
 * 以及进度记录的状态、来源与各字段的展示名。
 *
 * 提醒类型 / 状态与记录来源的取值是**协议值**（英文 code，见 `types/reminder.ts` /
 * `types/tracker.ts`，与后端逐字对应）；本包只提供它们的显示名，组件里用
 * `Record<…, MessageKey>` 表按协议值取 key。进度状态名另复用 `trackerForm.status.*`
 * ——同一个协议值在两处必须是同一个名字，各写一份迟早会漂。`types/*.ts` 的中文表
 * 一个字都没动（提醒面板与提醒行仍在用提醒类型/状态表）。
 */
const trackerUi = {
  "trackerUi.calendar.prevMonth": "上个月",
  "trackerUi.calendar.nextMonth": "下个月",
  "trackerUi.calendar.thisMonth": "回到本月",
  "trackerUi.calendar.monthTitle": "YYYY 年 M 月",
  "trackerUi.calendar.dayTitle": "YYYY 年 M 月 D 日",
  "trackerUi.calendar.hint": "点日期格看当天的安排",
  "trackerUi.calendar.weekday.mon": "一",
  "trackerUi.calendar.weekday.tue": "二",
  "trackerUi.calendar.weekday.wed": "三",
  "trackerUi.calendar.weekday.thu": "四",
  "trackerUi.calendar.weekday.fri": "五",
  "trackerUi.calendar.weekday.sat": "六",
  "trackerUi.calendar.weekday.sun": "日",
  "trackerUi.calendar.dayAria": "{date}，{count} 条提醒，查看当天安排",
  "trackerUi.calendar.dayAriaEmpty": "{date}，查看当天安排",
  "trackerUi.calendar.monthEmpty": "这个月还没有提醒，把面试、测评截止这些时点记下来吧",
  "trackerUi.calendar.detailTitle": "{date} · {count} 条提醒",
  "trackerUi.calendar.dayEmpty": "这一天没有安排",

  "trackerUi.reminderKind.interview": "面试",
  "trackerUi.reminderKind.assessmentDeadline": "测评/笔试截止",
  "trackerUi.reminderKind.hrReply": "催 HR 回复",
  "trackerUi.reminderKind.other": "其他",
  "trackerUi.reminderStatus.pending": "待办",
  "trackerUi.reminderStatus.done": "已完成",
  "trackerUi.reminderStatus.dismissed": "已忽略",

  "trackerUi.card.emptyCompany": "（未填公司）",
  "trackerUi.card.emptyTitle": "（未填岗位）",
  "trackerUi.card.action.edit": "编辑",
  "trackerUi.card.action.delete": "删除",
  "trackerUi.card.aria.more": "更多操作 {name}",
  "trackerUi.card.fallbackName": "进度",
  "trackerUi.card.appliedAt": "投递于 {date}",
  "trackerUi.card.statusDate": "状态更新 {date}",
  "trackerUi.card.resume": "简历：{title}",
  "trackerUi.card.resumeHistorical": "（历史关联）",
  "trackerUi.card.nextStep": "下一步",
  "trackerUi.card.emptyNextAction": "（未填写内容）",
  "trackerUi.card.overdue": "已过期",
  "trackerUi.card.evidence": "依据：{evidence}",

  "trackerUi.source.apply": "投递台自动记录",
  "trackerUi.source.manual": "手动添加",
  "trackerUi.source.recognized": "识别导入",
} as const;

export default trackerUi;
