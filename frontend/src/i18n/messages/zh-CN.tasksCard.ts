// SPDX-License-Identifier: Apache-2.0
/** 首页「任务」卡（T02）：卡片标题、副标题与折叠/展开动作。 */
const tasksCard = {
  /** 卡片标题（与设置页「任务卡」开关同名，界面上是同一件事）。 */
  "tasksCard.title": "任务",
  /** 副标题：一句话说明这张卡是什么。 */
  "tasksCard.subtitle": "助手正在推进的事",
  /** 未结束任务超出上限时的就地展开按钮；`{count}` 是被收起的条数。 */
  "tasksCard.more": "还有 {count} 条",
  /** 「已结束」分区的折叠标题；`{count}` 是已结束任务总数（默认收起）。 */
  "tasksCard.finishedCount": "已结束（{count}）",
} as const;

export default tasksCard;
