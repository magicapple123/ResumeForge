// SPDX-License-Identifier: Apache-2.0
/**
 * 「表达资产库」（W17 / D16）这一批**新增**的界面文案。
 *
 * 拆法与 `zh-CN.outline.ts` / `zh-CN.research.ts` 一致：扁平点分 key、默认导出、`as const`；
 * 由 lead 在 `zh-CN.namespaces.ts` 聚合一行。术语：资产 = 一条可复用的表达（成果/方法/结果/总结），
 * 条目 = 简历里的一段经历/项目，要点 = 条目里的一条 bullet。
 */
const assets = {
  // ── 面板与列表 ──────────────────────────────────────────────
  "assets.panel.title": "表达资产库",
  "assets.panel.hint": "收藏好用的表达，换简历时直接插入",
  "assets.list.count": "共 {count} 条",
  "assets.list.selectedCount": "已选 {count} 条",
  "assets.empty": "还没有收藏的表达",
  "assets.empty.hint": "在简历要点上点「收藏为资产」即可开始",
  "assets.empty.filtered": "没有符合筛选条件的表达",
  "assets.empty.filteredAction": "清空筛选条件",
  "assets.error": "资产列表没加载出来",
  "assets.error.retry": "重新加载",
  "assets.loadMore": "加载更多",
  "assets.delete.done": "已删除这条表达",
  "assets.delete.undo": "撤销删除",
  "assets.delete.failed": "删除没有成功",
  "assets.collect.done": "已收藏这条表达",
  "assets.collect.failed": "收藏没有成功",
  "assets.collect.noSelection": "先在中栏选中一条内容",
  "assets.insert.done": "已插入到简历",
  "assets.insert.newObject": "新条目 {id}",
  "assets.insert.failed": "插入没有成功",
  "assets.insert.noTarget": "先选中要插入的位置",
  "assets.insert.locked": "先保存当前修改，再插入资产",

  // ── 筛选 ────────────────────────────────────────────────────
  "assets.filter.search": "搜索表达",
  "assets.filter.searchPlaceholder": "搜关键词，也搜岗位标签",
  "assets.filter.kind": "类型",
  "assets.filter.kind.all": "全部类型",
  "assets.filter.language": "语言",
  "assets.filter.language.all": "全部语言",
  "assets.filter.tag": "岗位标签",
  "assets.filter.tag.all": "全部标签",
  "assets.filter.sort": "排序",
  "assets.filter.sort.recent": "最近使用",
  "assets.filter.sort.usage": "用的次数",
  "assets.filter.sort.created": "收藏时间",
  "assets.filter.reset": "清空筛选",
  "assets.filter.active": "已启用 {count} 个筛选",

  // ── 类型与来源 ──────────────────────────────────────────────
  "assets.kind.achievement": "成果",
  "assets.kind.method": "方法",
  "assets.kind.result": "结果",
  "assets.kind.summary": "总结",
  "assets.kind.custom": "其他",
  "assets.language.zh-CN": "中文",
  "assets.language.en-US": "英文",
  "assets.language.unknown": "未标注",
  "assets.source.claim": "来自事实台账",
  "assets.source.resume": "来自简历",
  "assets.source.manual": "手工收藏",
  "assets.usage": "用过 {count} 次",
  "assets.usage.never": "还没用过",

  // ── 动作 ────────────────────────────────────────────────────
  "assets.action.insert": "插入到简历",
  "assets.action.insertAria": "把资产第 {index} 条插入到简历",
  "assets.action.delete": "删除这条资产",
  "assets.action.deleteTitle": "删除这条资产",
  "assets.action.deleteBody": "删除后可在回收站恢复",
  "assets.action.deleteConfirm": "删除",
  "assets.action.copy": "复制文字",
  "assets.action.copyAria": "复制资产第 {index} 条的文字",
  "assets.action.collect": "收藏为资产",
  "assets.action.collectAria": "把当前要点收藏为资产",
  "assets.action.collected": "已收藏这条表达",
  "assets.action.copied": "已复制这条表达",
  "assets.action.insertUnavailable": "先打开一份简历才能插入",
  "assets.action.viewSource": "查看来源",

  // ── 预览与更新 ──────────────────────────────────────────────
  "assets.preview.title": "资产详情",
  "assets.preview.quality": "为什么留着它",
  "assets.preview.updated": "插入后生成新的条目身份，不与原简历联动",
} as const;

export default assets;
