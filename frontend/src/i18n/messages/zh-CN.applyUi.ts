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
} as const;

export default applyUi;
