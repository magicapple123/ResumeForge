// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的软件更新卡片：检查、下载、重启安装与结果提示。
 *
 * 带 `<code>` 内嵌的说明段落不在本文件——片段拼接在英文里语序不通，
 * 需要单独设计成整段 key（与投递队列页同一处理）。
 */
const update = {
  "update.size.unknown": "未知大小",
  "update.toast.doneTitle": "ResumeForge 已更新",
  "update.toast.doneBody": "已更新到 {version}。你的岗位、简历和设置仍保留在原数据目录中。",
  "update.toast.failedTitle": "上次更新失败",
  "update.toast.interruptedTitle": "上次更新没有完成",
  "update.error.check": "检查更新失败",
  "update.error.download": "下载更新失败",
  "update.error.install": "启动安装失败",
  "update.confirm.title": "重启并安装更新？",
  "update.confirm.body":
    "应用会先退出，覆盖程序文件后自动重启。岗位、简历、对话和设置保存在 data/ 中，不会被更新包覆盖。",
  "update.confirm.ok": "重启并安装",
  "update.confirm.cancel": "稍后安装",
  "update.card.title": "软件更新",
  "update.field.channel": "更新方式",
  "update.field.current": "当前版本",
  "update.field.target": "目标版本",
  "update.value.checkFirst": "点「检查更新」获取",
  "update.action.check": "检查更新",
  "update.action.download": "下载更新",
  "update.action.recheck": "重新检查",
  "update.action.install": "重启并安装",
  "update.bgDownload": "后台下载（下载完成后提醒我安装）",
  "update.action.retryStatus": "重试读取状态",
  "update.installing.title": "更新器已启动，应用即将退出并自动重启。",
  "update.hint.restart": "点击「重启并安装」后，应用会在原路径覆盖旧版本并自动重启。",
  "update.action.release": "打开发布页面",
  "update.result.title": "检查完成",
  "update.result.latest": "最新版本：{version}",
  "update.result.published": "发布时间：{date}",
} as const;

export default update;
