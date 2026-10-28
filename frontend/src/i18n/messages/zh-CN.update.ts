// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的软件更新卡片：检查、下载、重启安装与结果提示。
 *
 * 带 `<code>` 内嵌的说明段落拆成首/中/尾三条：段落本身仍是一条完整的话，
 * 但 `<code>` 两侧的空格留在 JSX 的 `{" "}` 里，不写进 key —— 中英文的空格
 * 规则不同，把空格冻进译文会在另一种语言里多出一个空格。
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
  "update.side.title": "版本信息",
  "update.field.latest": "最新版本",
  "update.side.note": "更新只替换程序文件，data/ 中的数据保持不动。",
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

  /** 安装结果里后端没给原因时的兜底。 */
  "update.installResult.noReason": "更新器没有给出原因。",
  /** 安装结果说明的前半句；`{log}` 路径以 <code> 内嵌在它后面。 */
  "update.installResult.lead": "应用本身还能正常使用，数据没有被改动。日志在",
  /** 日志路径与 `update.cmd` 之间的连接语（中文里以一个逗号开头）。 */
  "update.installResult.middle": "，也可以双击",
  /** 安装结果说明的收尾。 */
  "update.installResult.tail": "重新更新一次。",
  /** 卡片说明的前半句：更新只换程序文件；后面接 <code>data/</code>。 */
  "update.intro.filesOnly": "更新只替换程序文件，不会覆盖",
  /** <code>data/</code> 之后的半句：数据目录里有什么不会被覆盖。 */
  "update.intro.dataSuffix": "里的岗位、简历、助手对话和设置。",
  /** 卡片说明的第二句：更新前先备份。 */
  "update.intro.backupHint": "更新前仍建议先在「数据集与备份」里导出一份备份。",
  /** 下载进度；两个占位符都是格式化后的体积。 */
  "update.downloading": "正在下载更新包：{downloaded} / {total}",
} as const;

export default update;
