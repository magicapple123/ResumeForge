// SPDX-License-Identifier: Apache-2.0
/**
 * 网申填表页：浏览器控制、读取与填充的结果提示、安全说明与页面内的两张卡标题。
 *
 * 本页只做编排（各步骤的卡片都在 `pages/webform/` 下），所以文案集中在「动作反馈」
 * 与「卡片标题」两类；填表引擎与预览明细的文案不在这里。
 */
const webFormPage = {
  "webFormPage.notice.title": "这个功能只负责把资料填进页面，不会替你提交",
  "webFormPage.notice.body":
    "填充完成后请回到浏览器窗口逐项核对，确认无误后由你自己点击页面上的提交按钮。",
  "webFormPage.hint.expandLater":
    "浏览器就绪后，安全说明、AI 辅助、放宽模式等控制项会在这里逐步展开。",
  "webFormPage.card.pending": "页面还要求这些",
  "webFormPage.card.records": "填充记录",
  "webFormPage.toast.targetOpened": "目标网申页面已打开；已有网页不会被覆盖",
  "webFormPage.toast.browserStarted":
    "浏览器已启动。请在这个窗口里打开目标公司的网申页面，再回来点「读取当前表单」",
  "webFormPage.toast.sessionEnded": "本次网申填写已结束",
  "webFormPage.toast.statusRefreshed": "浏览器状态已刷新",
  "webFormPage.toast.diagnosticsExported": "已导出脱敏诊断信息，可连同截图提交排查",
  "webFormPage.toast.liveOn": "已开启。回到浏览器窗口，点到哪个框就在旁边给你要填的值",
  "webFormPage.toast.liveOff": "已关闭，悬浮球保留为灰色，页面不会再显示提示卡",
  "webFormPage.toast.nothingToFill": "这一页没找到能自动填的字段，可以看看下面的清单",
  "webFormPage.toast.filled": "已填 {count} 项，请到浏览器窗口里核对后自己提交",
  "webFormPage.toast.remembered": "已记住 {count} 项，下次遇到同一个框会自动填",
  "webFormPage.toast.memorySaved": "已保存到你选择的资料目标，下次可以继续复用",
  "webFormPage.error.startFailed": "启动浏览器失败",
  "webFormPage.error.openUrlFailed": "打开网申页面失败",
  "webFormPage.error.deleteHistoryFailed": "删除网址记录失败",
  "webFormPage.error.stopFailed": "关闭浏览器失败",
  "webFormPage.error.endFailed": "结束本次填写失败",
  "webFormPage.error.refreshFailed": "刷新浏览器状态失败",
  "webFormPage.error.diagnosticsFailed": "导出诊断信息失败",
  "webFormPage.error.liveToggleFailed": "切换点击填表失败",
  "webFormPage.error.readFailed": "读取表单失败",
  "webFormPage.error.fillFailed": "填充失败",
  "webFormPage.error.rememberFailed": "记住失败，请稍后再试",
  "webFormPage.error.memorySaveFailed": "保存资料失败，请稍后重试",
} as const;

export default webFormPage;
