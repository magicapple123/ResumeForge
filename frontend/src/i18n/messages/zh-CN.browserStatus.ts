// SPDX-License-Identifier: Apache-2.0
/**
 * 投递专用浏览器的状态条：启动 / 打开站点 / 关闭 / 刷新，以及两段说明。
 *
 * 两段说明原本用 `<Typography.Text strong>` 做内嵌强调，这里按既有先例
 * （见 zh-CN.datasets.ts 顶部注释）整段合成一个 key、去掉标签，强调改用「」表达：
 * 切成 before/strong/after 三段在英文里语序不通，而 i18n 没有富文本插值。
 *
 * 轮询间隔是展示用的数字，走 `{seconds}` 参数；「刷新中」与「空闲」是两套措辞。
 */
const browserStatus = {
  "browserStatus.title": "投递专用浏览器",
  "browserStatus.port": "调试端口 {port}",
  "browserStatus.action.start": "启动浏览器",
  "browserStatus.action.openSite": "打开招聘网站",
  "browserStatus.action.stop": "关闭浏览器",
  "browserStatus.action.reload": "刷新状态",
  "browserStatus.aria.reload": "刷新状态",
  "browserStatus.tooltip.openSite": "在这个窗口里重新打开招聘网站首页",
  "browserStatus.tooltip.openSiteDisabled": "浏览器启动后可用；用于标签页被关掉或跳走时找回登录页",
  "browserStatus.tooltip.reload": "正在刷新；平时约每 {seconds} 秒自动检查一次",
  "browserStatus.tooltip.reloadIdle": "平时约每 {seconds} 秒自动检查一次；点击立即检查",
  "browserStatus.intro":
    "投递与采集都在这个「独立窗口」里进行（用的是专用数据目录，和你日常的浏览器互不影响）。点「启动浏览器」后，这个窗口会「直接打开招聘网站首页」，请在那里扫码登录一次——登录由你自己完成，应用不保存密码、Cookie 或验证码；登录态由浏览器自己保留，下次启动无需重复登录。若你把标签页关掉或跳到了别处，点「打开招聘网站」即可找回来，不用重启浏览器。",
  "browserStatus.adopted":
    "这个窗口是「上一次运行」打开的，应用重启时丢掉了它的进程句柄，因此「关不掉它」——应用只关自己启动的窗口，不按进程号去猜（免得误关你自己的浏览器）。直接关闭那个窗口即可，「采集与投递不受影响」。",
  "browserStatus.entry": "站点入口：{url}",
  "browserStatus.browser": "使用浏览器：",
  "browserStatus.browserWithName": "{name}（{path}）",
  "browserStatus.toast.started": "投递专用浏览器已启动，请在弹出的窗口里扫码登录一次",
  "browserStatus.toast.siteOpened": "已在该窗口里打开招聘网站，请在里面扫码登录",
  "browserStatus.toast.stopped": "已关闭投递专用浏览器",
  "browserStatus.error.startFailed": "启动投递专用浏览器失败",
  "browserStatus.error.openSiteFailed": "打开招聘网站失败",
  "browserStatus.error.stopFailed": "关闭投递专用浏览器失败",
} as const;

export default browserStatus;
