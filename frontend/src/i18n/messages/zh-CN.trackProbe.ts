// SPDX-License-Identifier: Apache-2.0
/** 申请状态回读（R-15 C）的文案。 */
export default {
  "trackProbe.action": "刷新状态",
  "trackProbe.running": "正在回读 {done}/{total}",
  "trackProbe.manualHint":
    "去岗位页或候选人门户读一遍申请状态。只有读到明确依据才改，读不到就不动。",
  "trackProbe.auto": "每日自动",
  "trackProbe.autoHint": "打开进度页时，距上次回读超过 {hours} 小时就自动检查一次。",
  "trackProbe.autoOn": "已开启每日自动回读",
  "trackProbe.autoOff": "已关闭每日自动回读",
  "trackProbe.done": "回读完成：{count} 条进度有更新",
  "trackProbe.noChange": "回读完成：没有变化",
  "trackProbe.failed": "回读失败，请稍后重试",
  "trackProbe.failedHint": "{count} 条抓取失败：门户多半需要登录，或暂时不可用。",
  "trackProbe.empty": "没有进行中的记录可回读",
  "trackProbe.partial": "本次最多回读 48 条，还有 {rest} 条下次再刷。",
  "trackProbe.dailyChanged": "自动回读：{count} 条进度有更新",
  "trackProbe.resultTitle": "回读结果",
  "trackProbe.outcome.changed": "已更新",
  "trackProbe.outcome.unchanged": "无变化",
  "trackProbe.outcome.skipped": "跳过",
  "trackProbe.outcome.failed": "失败",
  "trackProbe.settingsTitle": "回读设置",
  "trackProbe.pageUrl": "投递记录页",
  // 示例串是技术格式（域名/分号分隔），两种语言同值；放进语言包只是为了让守卫看得见它。
  "trackProbe.pageUrlExample": "https://acme.jobs.feishu.cn/.../applications",
  "trackProbe.cookieExample": "session=...; other=...",
  "trackProbe.pageUrlHint":
    "把「我的投递记录」那一页的网址贴进来（可选）。配了它，点一次刷新会先读这一页——一次就能覆盖所有公司；页面上没找到的记录再逐条读岗位页。",
  "trackProbe.cookieTitle": "配置候选人门户的登录 Cookie",
  "trackProbe.cookieHint":
    "「筛选中 / 面试」这类状态只有登录后才看得到。在浏览器登录门户后，从开发者工具任意请求的请求头里复制 Cookie 粘到下面；它只存在本机数据库，不会上传。",
  "trackProbe.cookieSave": "保存并继续",
  "trackProbe.cookieSkip": "先用公开页试一次",
  "trackProbe.cookieAction": "配置 Cookie 以读取具体阶段",
};
