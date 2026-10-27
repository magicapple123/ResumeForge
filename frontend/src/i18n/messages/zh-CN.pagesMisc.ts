// SPDX-License-Identifier: Apache-2.0
/**
 * 四个页面剩下的展示文案：投递台、面试深挖页、首页与岗位广场。
 *
 * 面试深挖页的统计卡、历史列表与开场面板在 `zh-CN.drill.ts`；这里只补页面里还没迁移的
 * 两段（底部的打开方式提示），其余三个页面的文案全部在本包。
 */
const pagesMisc = {
  // ── 投递台（ApplyPage） ─────────────────────────────────────────
  "pagesMisc.applyPage.title": "投递台",
  "pagesMisc.applyPage.subtitle":
    "采集岗位 → 判断匹配度 → 显式确认 → 自动投递。所有对招聘网站的动作都由你显式发起，登录在你自己的浏览器窗口里完成。",
  "pagesMisc.applyPage.action.settings": "投递设置",
  "pagesMisc.applyPage.progress.loading": "正在读取任务进度…",
  "pagesMisc.applyPage.progress.notFound": "任务记录不存在，可能已被清理。",
  "pagesMisc.applyPage.tab.queue": "投递队列",
  "pagesMisc.applyPage.tab.collect": "自动采集",
  "pagesMisc.applyPage.tab.collectRecords": "采集记录",
  "pagesMisc.applyPage.tab.records": "投递记录",
  "pagesMisc.applyPage.tab.referrals": "内推",
  /** 暂停 / 继续 / 停止失败时的兜底原因（后面由 `formatErrorGuidance` 补建议与编号）。 */
  "pagesMisc.applyPage.error.controlFailed": "调整任务失败",

  // ── 面试深挖页（DrillPage）：只剩底部那句打开方式的提示 ───────────
  /** 图标（+）前面的半句。 */
  "pagesMisc.drillPage.openHint.before": "点上方「继续」或「看复盘」打开某一场；也可以",
  /** 图标后面的半句。 */
  "pagesMisc.drillPage.openHint.after": "直接开始新的一场。",

  // ── 首页（HomePage） ───────────────────────────────────────────
  /** 加载失败的横幅标题；`{error}` 是原始错误消息。 */
  "pagesMisc.homePage.loadFailed.title": "首页数据加载失败：{error}",
  "pagesMisc.homePage.section.todos": "接下来做什么",
  "pagesMisc.homePage.loading": "正在读取…",
  "pagesMisc.homePage.todos.empty":
    "眼下没有待办。可以去「岗位广场」收几个岗位，或到「求职助手」聊聊下一步。",
  /** 待办一：未核实的主张条数。 */
  "pagesMisc.homePage.todo.claims.text": "有 {count} 条事实还没核实",
  "pagesMisc.homePage.todo.claims.hint": "没核实的主张不能进正式简历，导出时会被拦下",
  /** 待办二：投递队列里的岗位条数。 */
  "pagesMisc.homePage.todo.queue.text": "投递队列里有 {count} 个岗位在等",
  "pagesMisc.homePage.todo.queue.hint": "排好队、启动浏览器就能投",
  /** 待办三：超过一周没更新的投递条数。 */
  "pagesMisc.homePage.todo.stalled.text": "有 {count} 条投递超过一周没更新",
  "pagesMisc.homePage.todo.stalled.hint": "去看看要不要补一句跟进或改状态",

  // ── 岗位广场（JobsPage） ───────────────────────────────────────
  "pagesMisc.jobsPage.error.deleteFailed": "删除失败",
  "pagesMisc.jobsPage.error.favoriteFailed": "更新收藏状态失败",
  "pagesMisc.jobsPage.toast.webFormOpened": "已在网申专用浏览器中打开投递页面",
  "pagesMisc.jobsPage.error.webFormFailed": "打开网申页面失败",
  "pagesMisc.jobsPage.backfill.none": "当前页没有需要补齐详情的岗位",
  /** `{count}` 是本次补详情的岗位数。 */
  "pagesMisc.jobsPage.backfill.started":
    "已开始为 {count} 个岗位补齐详情，进度见「投递台 → 自动采集」",
  "pagesMisc.jobsPage.error.backfillFailed": "补齐详情失败",
  "pagesMisc.jobsPage.match.enteredSelection": "已进入选择模式，勾选岗位后点分析",
  "pagesMisc.jobsPage.match.needJobs": "请先选择岗位",
  "pagesMisc.jobsPage.match.tooMany": "一次最多分析 50 个岗位",
  "pagesMisc.jobsPage.candidate.imported": "备选岗位已导入正式岗位",
  "pagesMisc.jobsPage.candidate.markFailed": "标记导入状态失败",
} as const;

export default pagesMisc;
