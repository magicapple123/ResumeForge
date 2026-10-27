// SPDX-License-Identifier: Apache-2.0
/**
 * 首页：统计卡、最近动态三卡、近期提醒卡与启动提醒弹窗、全局搜索卡。
 *
 * ## 协议值不在这里
 *
 * 近期提醒卡的 `Segmented` 取值为 `list` / `calendar`，紧急度取值为 `overdue` /
 * `soon` / `upcoming` / `later`，搜索命中的分组键是 `referral` / `reminder` / …：
 * 它们参与视图判定或与后端下发字段对齐，只翻它们的显示名。
 *
 * ## 「列表 / 月历」与求职进度页各自成句
 *
 * 求职进度页的日历提醒包（`reminder.view.list` / `reminder.view.calendar`）也是这两个词。
 * 这里是首页这张卡自己的控件，两边互不引用，改一屏不会牵动另一屏。
 */
const homePage = {
  // ── 统计卡 ────────────────────────────────────────────────
  /** 岗位总数。 */
  "homePage.stats.jobCount": "岗位总数",
  /** 状态为开放中的岗位数。 */
  "homePage.stats.openJobCount": "开放中岗位",
  /** 已生成的简历份数。 */
  "homePage.stats.resumeCount": "已生成简历",
  /** 最近 7 天生成的简历份数。 */
  "homePage.stats.weekResumeCount": "近 7 天生成",

  // ── 卡片右上角的通用动作 ──────────────────────────────────
  /** 「最近岗位」「最近生成的简历」「近期提醒」右上角的链接。 */
  "homePage.action.viewAll": "查看全部",
  /** 「最近投出去的」右上角的链接：进求职进度看投递进展。 */
  "homePage.action.viewProgress": "看进度",

  // ── 最近动态三卡 ──────────────────────────────────────────
  /** 「最近岗位」卡标题。 */
  "homePage.latest.jobs.title": "最近岗位",
  /** 还没有岗位时的空态：点名去哪个页面添加。 */
  "homePage.latest.jobs.empty": "暂无岗位，去「岗位广场」手动添加",
  /** 「最近生成的简历」卡标题。 */
  "homePage.latest.resumes.title": "最近生成的简历",
  /** 还没有简历记录时的空态。 */
  "homePage.latest.resumes.empty": "暂无简历记录，去「岗位广场」选个岗位试试",
  /** 「最近投出去的」卡标题。 */
  "homePage.latest.applications.title": "最近投出去的",
  /** 投递记录没关联岗位名时的兜底显示。 */
  "homePage.latest.untitledJob": "未命名岗位",

  // ── 近期提醒卡与启动弹窗 ────────────────────────────────────
  /** 卡片标题与启动弹窗标题（同一处含义，共用一条）。 */
  "homePage.reminders.title": "近期提醒",
  /** 启动弹窗底部的关闭按钮。 */
  "homePage.reminders.gotIt": "知道了",
  /** 列表 / 月历切换控件的无障碍名。 */
  "homePage.reminders.viewSwitchAria": "近期提醒视图切换",
  /** 视图切换的选项：列表。 */
  "homePage.reminders.view.list": "列表",
  /** 视图切换的选项：月历。 */
  "homePage.reminders.view.calendar": "月历",
  /** 一条待办提醒都没有时的空态。 */
  "homePage.reminders.empty": "近期没有待办提醒",
  /** 紧急度显示名：已过提醒时间。 */
  "homePage.reminders.urgency.overdue": "已逾期",
  /** 紧急度显示名：即将到期。 */
  "homePage.reminders.urgency.soon": "即将到期",
  /** 紧急度显示名：还没到提醒时间。 */
  "homePage.reminders.urgency.upcoming": "未到期",
  /** 紧急度显示名：提醒时间较远。 */
  "homePage.reminders.urgency.later": "较远",
  /** 后端下发了未知紧急度时的兜底显示名。 */
  "homePage.reminders.urgency.unknown": "未知",
  /** 紧急度着色点的无障碍名；`{level}` 是上面的显示名。 */
  "homePage.reminders.urgencyAria": "紧急度：{level}",
  /** 整行提醒的无障碍名：点它可以打开提醒弹窗。 */
  "homePage.reminders.openAria": "查看提醒：{title}",

  // ── 全局搜索卡 ────────────────────────────────────────────
  /** 卡片标题。 */
  "homePage.search.title": "全局搜索",
  /** 搜索框占位符：同时说明能搜哪些数据域，并给一个例子。 */
  "homePage.search.placeholder":
    "搜索岗位、简历，或内推、提醒、面经、事实台账、资料、技能，如：市场营销 / 财务会计",
  /** 搜索按钮。 */
  "homePage.search.action": "搜索",
  /** 请求失败且异常没有消息时的兜底。 */
  "homePage.search.failed": "搜索失败，请重试",
  /** 岗位命中分组的标题；`{count}` 是命中条数。 */
  "homePage.search.jobsTitle": "匹配的岗位（{count}）",
  /** 岗位没有命中时的空态。 */
  "homePage.search.jobsEmpty": "没有匹配的岗位",
  /** 岗位没填薪资时的兜底显示。 */
  "homePage.search.salaryNegotiable": "薪资面议",
  /** 简历命中分组的标题；`{count}` 是命中条数。 */
  "homePage.search.resumesTitle": "匹配的简历记录（{count}）",
  /** 简历没有命中时的空态。 */
  "homePage.search.resumesEmpty": "没有匹配的简历记录",
  /** 「更多结果」整块的标题；`{count}` 是命中条数。 */
  "homePage.search.moreTitle": "更多结果（{count}）",
  /** 单个数据域分组的小标题；`{name}` 是下面六条显示名之一。 */
  "homePage.search.groupHeading": "{name}（{count}）",
  /** 更多结果的数据域显示名：内推。 */
  "homePage.search.more.referral": "内推",
  /** 更多结果的数据域显示名：提醒。 */
  "homePage.search.more.reminder": "提醒",
  /** 更多结果的数据域显示名：面经。 */
  "homePage.search.more.experience": "面经",
  /** 更多结果的数据域显示名：事实台账。 */
  "homePage.search.more.claim": "事实台账",
  /** 更多结果的数据域显示名：资料。 */
  "homePage.search.more.material": "资料",
  /** 更多结果的数据域显示名：技能。 */
  "homePage.search.more.skill": "技能",
} as const;

export default homePage;
