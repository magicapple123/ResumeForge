// SPDX-License-Identifier: Apache-2.0
/**
 * 投递台的共享界面文案：投递记录详情抽屉、记录批次组、记录筛选栏、「受控浏览器」字段、
 * 浏览器设置弹窗、自动采集面板、采集记录面板与当前站点提示条。
 *
 * 两处**不在本包范围**的文案（都在清单外的文件里，未改）：
 * - 记录状态标签、失败分类名、批次状态与浏览器类型的展示名仍取自 `types` 的映射表
 *   （协议值 → 展示名）；其中「Google Chrome」「Microsoft Edge」是纯 ASCII 品牌名，进语言包
 *   会被 `messageContract` 判成"源文是英文"，需要同时登记 equality 例外，属于另一批的事。
 * - 记录详情抽屉的字段名（岗位 / 简历 / 招呼语 / 结果 / 失败分类）与「（岗位已删除）」
 *   直接复用 `zh-CN.applyRecords.ts` 里同名的 key——同一面板、逐字相同，不另造一份。
 */
const applyUi = {
  "applyUi.recordDetail.title": "投递记录详情",
  "applyUi.recordDetail.time": "时间",
  "applyUi.recordDetail.taskBatch": "任务 / 批次",
  "applyUi.recordDetail.defaultGreeting": "（默认招呼语）",
  "applyUi.recordDetail.failureDetail": "失败信息（含页面 URL / 标题）",
  "applyUi.recordDetail.batchAttempt": "批次 #{id} · 第 {attempt} 次尝试",

  // #39：失败详情抽屉的三段结构（发生了什么 / 在哪一步 / 你该怎么做）。
  "applyUi.recordDetail.section.what": "发生了什么",
  "applyUi.recordDetail.section.where": "在哪一步",
  "applyUi.recordDetail.section.advice": "你该怎么做",
  "applyUi.recordDetail.failureCode": "失败子码",
  "applyUi.recordDetail.step": "步骤",
  "applyUi.recordDetail.target": "环节",
  "applyUi.recordDetail.unidentified": "未识别",
  "applyUi.recordDetail.advice.site_changed":
    "把这条诊断反馈给维护者；急着投就先到浏览器里手动投这一家。",
  "applyUi.recordDetail.advice.render_timeout": "稍后重试；一直超时先确认网络能正常打开该站点。",
  "applyUi.recordDetail.advice.page_not_navigated":
    "确认浏览器能访问该站点后重试；仍不行就手动打开岗位页投递。",
  "applyUi.recordDetail.advice.selector_missing":
    "重试一次；还失败就反馈诊断（多半是页面结构又变了）。",
  "applyUi.recordDetail.advice.login_required": "到投递浏览器里扫码登录一次，再点「重投」。",
  "applyUi.recordDetail.advice.captcha_required":
    "到投递浏览器窗口里手动完成验证码，再点「继续」。",
  "applyUi.recordDetail.advice.greeting_missing":
    "到投递队列里给这个岗位填一句招呼语，或设置默认招呼语。",
  "applyUi.recordDetail.advice.network_timeout": "稍后重试；检查网络与代理。",
  "applyUi.recordDetail.advice.upload_failed": "检查简历文件能否打开、格式是否支持，再重投。",
  "applyUi.recordDetail.advice.site_unsupported": "这个岗位来源不支持自动投递，请到原站手动投递。",
  "applyUi.recordDetail.advice.profile_insufficient": "先在简历中心补一份可用简历，再重投。",
  "applyUi.recordDetail.advice.unconfirmed": "到投递浏览器里核对是否已经投出；确认前不要重复重投。",
  "applyUi.recordDetail.advice.unknown": "先重试一次；仍失败就把这条诊断反馈给维护者。",

  "applyUi.batch.selectMode": "批量选择",
  "applyUi.batch.deleteBatch": "删除本批（{count} 条）",
  "applyUi.batch.deleteConfirm": "删除这一批的记录？",
  "applyUi.batch.deleteConfirmBody":
    "这 {count} 条投递记录会移入回收站，之后可以在「回收站」里恢复。统计与每日上限也会一并扣减。",
  "applyUi.batch.heading": "批次 #{id}",
  "applyUi.batch.recordCount": "{count} 条记录",
  "applyUi.batch.succeeded": "成功 {count}",
  "applyUi.batch.failed": "失败 {count}",
  "applyUi.batch.skipped": "跳过 {count}",
  "applyUi.batch.retryFailed": "只重试这 {count} 条",
  "applyUi.batch.loadingItems": "正在加载明细…",
  "applyUi.batch.emptyItems": "该批次没有命中的记录",

  "applyUi.toolbar.searchPlaceholder": "搜索岗位 / 公司",
  "applyUi.toolbar.resultSuccess": "成功",
  "applyUi.toolbar.resultFailed": "失败",
  "applyUi.toolbar.resultSkipped": "已跳过",
  "applyUi.toolbar.goTracker": "去求职进度跟进",
  "applyUi.toolbar.groupHint": "按投递批次分组：一次投出的多个岗位归在一组，点击展开看明细",

  "applyUi.browserChoice.label": "受控浏览器",
  "applyUi.browserChoice.pathLabel": "自定义浏览器路径",
  "applyUi.browserChoice.pathExtra": "仅在「自定义路径」时生效；必须是真实存在的可执行文件。",
  "applyUi.browserChoice.pathPlaceholder": "例如：C:\\Program Files\\MyBrowser\\browser.exe",

  "applyUi.browserSettings.title": "浏览器设置",
  "applyUi.browserSettings.save": "保存浏览器设置",
  "applyUi.browserSettings.intro":
    "投递台和网申填表会分别打开独立浏览器窗口与登录态；这里选择的浏览器类型对两边都生效。",
  "applyUi.browserSettings.effectiveHint":
    "换过浏览器后，回页面点「关闭浏览器」再点「启动浏览器」才会生效",
  "applyUi.browserSettings.saved": "浏览器设置已保存",
  "applyUi.browserSettings.saveFailed": "保存失败",

  "applyUi.collect.saved": "采集条件已保存",
  "applyUi.collect.saveFailed": "保存采集条件失败",
  "applyUi.collect.needKeywords": "请至少填写一个关键词或城市",
  "applyUi.collect.startedWithSamples":
    "已开始采集，进度见「采集批次」；本次会保存站点原文，完成时提示位置",
  "applyUi.collect.started": "已开始采集，进度见「采集批次」",
  "applyUi.collect.startFailed": "开始采集失败",
  "applyUi.collect.flowTitle": "采集之后还有两步才轮到投递",
  "applyUi.collect.flowStepStage":
    "采集把岗位放进下面的「本次采集结果」，不会直接进岗位广场——采到的噪声由你筛掉。",
  "applyUi.collect.flowStepImport": "在结果里勾选要留下的岗位，点「导入选中的岗位」。",
  "applyUi.collect.flowStepQueue":
    "到「投递队列」把它们排进队列并显式开始投递， 结果在「投递记录」里看。",
  "applyUi.collect.historyLabel": "历史条件",
  "applyUi.collect.clearHistory": "清空历史",
  "applyUi.collect.clearHistoryConfirm":
    "清空历史条件？会删除全部已保存的采集条件快照，且不可恢复。",

  "applyUi.collectRecords.conditionKeywords": "关键词：{keywords}",
  "applyUi.collectRecords.conditionCity": "城市：{city}",
  "applyUi.collectRecords.conditionEmpty": "（未记录采集条件）",
  "applyUi.collectRecords.keywordSeparator": "、",
  "applyUi.collectRecords.conditionSeparator": "；",
  "applyUi.collectRecords.resultSaved": "已暂存 {count} 个",
  "applyUi.collectRecords.resultDuplicate": "重复 {count} 个",
  "applyUi.collectRecords.resultFiltered": "筛选掉 {count} 个",
  "applyUi.collectRecords.resultFailed": "失败 {count} 个",
  "applyUi.collectRecords.resultBackfilled": "已补齐 {count} 条",
  "applyUi.collectRecords.resultSkipped": "跳过 {count} 条",
  "applyUi.collectRecords.resultBackfillFailed": "失败 {count} 条",
  "applyUi.collectRecords.resultSeparator": "，",
  "applyUi.collectRecords.empty":
    "还没有采集记录。到「自动采集」页签设置条件并点「开始采集」，这里就会出现每一次的记录。",
  "applyUi.collectRecords.nextStep": "挑选导入之后：",
  "applyUi.collectRecords.viewJobs": "查看候选岗位",
  "applyUi.collectRecords.paginationTotal": "共 {count} 次采集",

  "applyUi.siteBar.currentLabel": "当前招聘网站：",
  "applyUi.siteBar.capabilityCollect": "采集",
  "applyUi.siteBar.capabilityApply": "投递",
  "applyUi.siteBar.onlyOne": "目前仅支持这一个招聘网站，后续会陆续增加。",
  "applyUi.siteBar.switchHint": "可在「投递设置」里切换要使用的招聘网站。",
  "applyUi.siteBar.degradedFallback":
    "最近采集异常，站点可能已改版——先重试一次；如果一直这样，请到项目仓库反馈。",
  "applyUi.siteBar.degradedTag": "站点可能已改版",
  "applyUi.siteBar.healthAria": "站点健康度告警：{reason}",

  // #14F 页头漏斗条：最近 7 天的执行量，点击下钻到投递记录 / 求职进度。
  "applyUi.funnel.applied": "已投递",
  "applyUi.funnel.succeeded": "成功",
  "applyUi.funnel.failed": "失败",
  "applyUi.funnel.interviewing": "面试中",
  "applyUi.funnel.hint": "近 {days} 天",
  "applyUi.funnel.drillAria": "近 {days} 天{dimension} {value}，点击查看",

  // T07「我已提交」：成功记录详情抽屉里的记录动作、提醒日期与一次性引导。
  "applyUi.recordDetail.submitted.section": "记录投递结果",
  "applyUi.recordDetail.submitted.hint":
    "投递成功了就记录一下；会挂一条跟进提醒，不记录也不影响现有统计。",
  "applyUi.recordDetail.submitted.action": "把这笔记为已提交",
  "applyUi.recordDetail.submitted.done": "已记录为已提交",
  "applyUi.recordDetail.submitted.toast": "已记录这条投递为已提交",
  "applyUi.recordDetail.submitted.reminder": "跟进提醒：{date}",
  "applyUi.recordDetail.submitted.error": "这条投递没有记录上，请重试一次",
  "applyUi.recordDetail.submitted.hintTitle": "投递后可以这样跟进",
  "applyUi.recordDetail.submitted.hintBody":
    "超过 7 天没有记录到状态变化时，首页「任务」卡会提醒你跟进；可在设置 → 记忆与技能里关掉任务卡。",
  // ===== 登录状态面板（Q12）=====
  "applyUi.loginStatus.button": "登录状态",
  "applyUi.loginStatus.title": "登录状态",
  "applyUi.loginStatus.intro":
    "投递浏览器、网申浏览器与门户 Cookie 是三处彼此独立的登录态，任何一处掉线都只影响它自己。",
  "applyUi.loginStatus.probeHint":
    "检测会真的拉起对应浏览器并访问一次站点，所以只在你点的时候才跑。",
  "applyUi.loginStatus.status.ok": "正常",
  "applyUi.loginStatus.status.expired": "已失效",
  "applyUi.loginStatus.status.unknown": "无法判断",
  "applyUi.loginStatus.status.unchecked": "未检测",
  "applyUi.loginStatus.checkedAt": "上次检测：{time}",
  "applyUi.loginStatus.never": "还没检测过",
  "applyUi.loginStatus.action.check": "检测",
  "applyUi.loginStatus.action.relogin": "重新登录",
  "applyUi.loginStatus.action.checkAll": "全部检测",
  "applyUi.loginStatus.action.paste": "粘贴 Cookie",
  "applyUi.loginStatus.cookiePlaceholder": "粘贴门户 Cookie（留空并保存 = 清除）",
  "applyUi.loginStatus.cookieSave": "保存并复检",
  "applyUi.loginStatus.cookieSaved": "Cookie 已保存并复检",
  "applyUi.loginStatus.opened": "已在浏览器里打开登录页，登录完关掉窗口再点一次检测",
  "applyUi.loginStatus.rateLimited": "刚检测过，{seconds} 秒后可以再检测",
  "applyUi.loginStatus.unknownHint": "拿不到登录特征时显示「无法判断」，不会误报成「已失效」。",
  "applyUi.loginStatus.checkAllHint": "全部检测是**串行**的：同时拉起两个浏览器会互相抢焦点。",
  "applyUi.loginStatus.progress": "正在检测 {done}/{total}",
  "applyUi.loginStatus.siteHint": "网申浏览器按站点逐项检测：一个站点掉线不影响其它站点。",
  "applyUi.loginStatus.siteTruncated": "还有 {count} 个站点未列出（按最近使用只显示前 12 个）。",
  "applyUi.loginStatus.site.check": "检测",
  "applyUi.loginStatus.site.relogin": "重新登录",
  "applyUi.loginStatus.noProbe.apply": "先选择一个投递站点，再回来检测。",
  "applyUi.loginStatus.noProbe.webform": "先在网申填表里打开一个网址，再回来检测。",
  "applyUi.loginStatus.noProbe.track": "先配置投递记录页，再回来检测。",
} as const;

export default applyUi;
