// SPDX-License-Identifier: Apache-2.0
/**
 * 通知中心（inbox）文案：页头铃铛、未读角标、下拉列表（今天/更早）、空态与动作。
 */
const notifications = {
  "notifications.bell.aria": "通知中心",
  /** 事件行副行的相对时间（整改 #13）：`{time}` 是时刻。 */
  "notifications.relative.today": "今天 {time}",
  "notifications.relative.yesterday": "昨天 {time}",
  /** 铃铛的无障碍名（整改 #14）：有未读时带条数，角标对读屏本来就是不可见的。 */
  "notifications.bell.ariaUnread": "通知，{count} 条未读",
  "notifications.title": "通知",
  "notifications.group.today": "今天",
  "notifications.group.earlier": "更早",
  "notifications.empty": "都处理完了",
  "notifications.action.readAll": "全部已读",
  "notifications.action.retry": "重试",
  "notifications.unread.mark": "标记为已读",
  "notifications.error.load": "通知加载失败，请稍后重试",
  "notifications.error.read": "标记已读失败，请稍后重试",
};

export default notifications;
