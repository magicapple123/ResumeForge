// SPDX-License-Identifier: Apache-2.0
/**
 * 「投递设置」弹窗：间隔、上限、熔断阈值、默认招呼语与专用浏览器端口。
 *
 * ## `defaults.*` 的三个 key 是一条模板 + 两个取值
 *
 * 每个字段下面回显**出厂默认值**（`出厂默认：30`）。开关类字段的值是布尔，显示成
 * 「开启 / 关闭」——这两个词是取值，模板由 `defaults.hint` 的 `{value}` 接住，
 * 不在语言包里拼（拼接在英文里会变成 "Factory default: On"，语序由模板管）。
 *
 * ## `intro` 是一整段、不保留内嵌强调
 *
 * 原文里「成功投递」外面套了 `<Typography.Text strong>`。i18n 没有富文本插值，
 * 而「前半句 + <b>词</b> + 后半句」的切法在英文里语序不通（强调的位置随语言变），
 * 所以按交接单先例**整段合成一个 key、去掉标签**，让两种语言都是完整的一句话。
 *
 * ## `skipSameCompany.extra` 同理
 *
 * 原文跨三行、含「已跳过」的引号，按一整段处理；光看标签「同公司只投一个岗位」会被
 * 读成全历史，作用域只能由这段说明来界定，所以它必须是一句能独立读通的话。
 */
const applySettings = {
  "applySettings.title": "投递设置",
  "applySettings.intro":
    "这些设置决定投递的节奏与安全网：岗位之间会随机等待，连续失败会自动暂停，每日上限只统计成功投递的数量。",

  /** 布尔默认值的两个取值（模板在 `defaults.hint`）。 */
  "applySettings.defaults.on": "开启",
  "applySettings.defaults.off": "关闭",
  "applySettings.defaults.hint": "出厂默认：{value}",

  "applySettings.interval.label": "岗位间隔（秒）",
  "applySettings.interval.required": "请填写岗位间隔",
  "applySettings.jitter.label": "随机抖动（秒）",
  "applySettings.dailyLimit.label": "每日上限（成功数）",
  "applySettings.dailyLimit.required": "请填写每日上限",
  "applySettings.perTaskLimit.label": "单批上限",
  "applySettings.breaker.label": "连续失败熔断阈值",

  "applySettings.greeting.label": "默认招呼语",
  "applySettings.greeting.extra": "队列条目没有单独填写招呼语时使用；投递前可逐岗位预览并修改。",

  "applySettings.site.label": "当前招聘网站",
  "applySettings.site.extra": "目前仅支持一个招聘网站，后续会陆续增加；新增站点无需你手动配置。",
  /** 站点下拉为空时的占位符；具体站点名由后端 `display_name` 下发，不在这里。 */
  "applySettings.site.placeholder": "使用默认站点",

  /** 传给 `BrowserChoiceFields` 的字段标签（默认值说的是两处通用的说法）。 */
  "applySettings.browser.label": "投递台使用的浏览器",
  "applySettings.browserPort.label": "投递专用浏览器调试端口",

  "applySettings.skipSameCompany.label": "同公司只投一个岗位",
  "applySettings.skipSameCompany.extra":
    "只在本批内生效：同一批里同一家公司的多个岗位只投最先的那个，其余标为「已跳过」并写明原因；换一批再遇到这家公司仍会投。判断忽略公司名的空格与大小写，失败的那次也算「投过」（招呼语可能已经发出去了）。",

  "applySettings.realGap.label": "默认允许「真实缺口」岗位直接入队",
  "applySettings.realGap.extra":
    "默认关闭：命中真实缺口的岗位需要你逐条确认；开启后仍会在记录里标注。",

  "applySettings.action.save": "保存设置",
  "applySettings.saved": "投递设置已保存",
  "applySettings.saveFailed": "保存投递设置失败",

  // #14D/#14E：弹窗改成三个页签，新增「话术库」与「屏蔽清单」。
  "applySettings.tab.cadence": "投递节奏",
  "applySettings.tab.templates": "话术库",
  "applySettings.tab.blocklist": "屏蔽清单",

  "applySettings.blocklist.intro":
    "命中的岗位在采集、入队、投递三处都会被拦下；一行填一项，留空即不屏蔽。",
  "applySettings.blocklist.companies": "屏蔽公司",
  "applySettings.blocklist.companiesHint": "按公司名比较，忽略空格与大小写。例如：某某科技有限公司",
  "applySettings.blocklist.keywords": "屏蔽关键词",
  "applySettings.blocklist.keywordsHint":
    "岗位名或描述里包含这些词就跳过；至少两个字，避免一个词屏蔽整座城市。例如：外包、驻场",
  "applySettings.blocklist.save": "保存屏蔽清单",
  "applySettings.blocklist.saved": "屏蔽清单已保存",
  "applySettings.blocklist.saveFailed": "保存屏蔽清单失败",
  "applySettings.blocklist.loadFailed": "屏蔽清单读取失败，请重试",

  "applySettings.templates.intro":
    "把常用招呼语存成模板，编辑队列条目时可直接套用；正文里可用 {company}、{job_title}、{name} 三个变量。",
  "applySettings.templates.name": "模板名",
  "applySettings.templates.body": "招呼语正文",
  "applySettings.templates.namePlaceholder": "例如：通用开场",
  "applySettings.templates.bodyPlaceholder":
    "例如：您好，我是{name}，看到贵司的{job_title}岗位，想进一步沟通。",
  "applySettings.templates.add": "新建模板",
  "applySettings.templates.remove": "删除这条模板",
  "applySettings.templates.save": "保存话术库",
  "applySettings.templates.saved": "话术库已保存",
  "applySettings.templates.saveFailed": "保存话术库失败",
  "applySettings.templates.loadFailed": "话术库读取失败，请重试",
  "applySettings.templates.empty": "还没有模板：点「新建模板」写一条，编辑队列条目时就能直接套用。",
  "applySettings.templates.uses": "用过 {count} 次",
  "applySettings.templates.needName": "请先填写模板名",
  "applySettings.templates.needBody": "请先填写招呼语正文",
} as const;

export default applySettings;
