// SPDX-License-Identifier: Apache-2.0
/** 「通知」设置分组（CR-29）：六个开关与静默时段。 */
const zhCNNotificationsSettings = {
  /** 左侧导航与分组标题。 */
  "notificationsSettings.nav": "通知",
  "notificationsSettings.intro": "决定什么该打断你：要你做决定的默认提醒，只告知结果的默认安静。",
  "notificationsSettings.summary": "要你做决定的默认打断，只告知结果的默认安静。",
  "notificationsSettings.loadFailed": "通知设置读取失败",
  "notificationsSettings.saveFailed": "通知设置保存失败",
  "notificationsSettings.reminderDue.label": "提醒到点",
  "notificationsSettings.reminderDue.hint": "提醒到期时写一条通知，并出现在页头铃铛里。",
  "notificationsSettings.taskWaiting.label": "需要你确认",
  "notificationsSettings.taskWaiting.hint":
    "助手任务停在「等你确认」时提醒你——不处理它就不会继续。",
  "notificationsSettings.taskDone.label": "任务完成",
  "notificationsSettings.taskDone.hint":
    "简历生成、批量解读等任务结束时的提示。默认关：结果回来看铃铛即可。",
  "notificationsSettings.batchDone.label": "批次完成",
  "notificationsSettings.batchDone.hint":
    "投递 / 采集批次跑完时的提示。默认关：结果回来看铃铛即可。",
  "notificationsSettings.sound.label": "提示音",
  "notificationsSettings.sound.hint": "出现提示时播放两声短音；关掉后彻底安静。",
  "notificationsSettings.quietHours.label": "静默时段",
  "notificationsSettings.quietHours.hint":
    "{start}–{end} 内不弹窗、不出声；通知仍会记入铃铛，回来看得到。",
  /** 页头「任务」按钮里的待确认入口（与铃铛未读是两个口径）。 */
  "notificationsSettings.waiting.badge": "有 {count} 个任务等你确认",
  "notificationsSettings.waiting.action": "去处理",
};

export default zhCNNotificationsSettings;
