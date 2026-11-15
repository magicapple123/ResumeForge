// SPDX-License-Identifier: Apache-2.0
/**
 * 公司与岗位背景调研（T07）的中文文案。
 *
 * 命名空间刻意叫 `companyResearch` 而不是 `research`：`research.*` 已经被简历里的
 * 「科研（论文 / 项目 / 专利）」占用，两者语义完全不同，合并会互相覆盖。
 */
const companyResearch = {
  "companyResearch.title": "公司与岗位调研",
  "companyResearch.intro": "投递前先看清这家公司和这个岗位：资料卡片来自搜索，联网简报带引用编号。",
  "companyResearch.field.company": "公司名",
  "companyResearch.field.companyPlaceholder": "例如：腾讯",
  "companyResearch.field.role": "岗位名",
  "companyResearch.field.roleOptional": "岗位名（可选）",
  "companyResearch.field.rolePlaceholder": "例如：后端开发工程师",
  "companyResearch.field.jd": "招聘描述",
  "companyResearch.field.jdOptional": "招聘描述（可选）",
  "companyResearch.field.jdPlaceholder": "把 JD 粘贴进来，简报会按它解读岗位",
  "companyResearch.action.submit": "开始调研",
  "companyResearch.action.rerun": "重新调研",
  "companyResearch.error.companyRequired": "先填公司名再开始调研",
  "companyResearch.error.request": "这次调研没有完成",
  "companyResearch.cards.title": "资料卡片",
  "companyResearch.cards.empty": "这次没搜到可展示的公开资料，可以换个公司全名再试",
  "companyResearch.card.official": "官网",
  "companyResearch.card.news": "近期新闻",
  "companyResearch.card.overview": "公司介绍",
  "companyResearch.card.authorityBadge": "极权威",
  "companyResearch.card.openAria": "在新窗口打开这条资料：{title}",
  "companyResearch.brief.title": "联网简报",
  "companyResearch.brief.failed": "这次没生成联网简报",
  "companyResearch.brief.empty": "输入公司名后开始调研，简报会出现在这里",
  "companyResearch.brief.sources": "引用来源",
  "companyResearch.brief.noSources": "这份简报没有可展示的来源",
  "companyResearch.brief.citationAria": "查看第 {number} 条引用来源",
  "companyResearch.deep.label": "深度调研",
  "companyResearch.deep.hint":
    "开启后做多轮深度搜索，最多约 20 次工具调用；搜索按查询词条数计费，费用比默认档高得多。",
  "companyResearch.deep.defaultOff": "深度调研默认关闭，只做一次普通搜索",
  "companyResearch.usage.summary": "本次共 {count} 次搜索，耗时 {seconds} 秒",
  "companyResearch.usage.billing": "搜索按查询词条数计费，深度调研会明显增加次数",
  "companyResearch.notes.title": "这次调用的说明",
  /** 多条说明之间的分隔（中文用全角分号，英文用半角）。 */
  "companyResearch.notes.separator": "；",
};

export default companyResearch;
