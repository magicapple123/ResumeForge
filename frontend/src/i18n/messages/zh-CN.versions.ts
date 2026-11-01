// SPDX-License-Identifier: Apache-2.0
/**
 * 「命名版本与岗位变体」这一批**新增**的界面文案（W13-FE）。
 *
 * 拆法与其他 domain 语言包相同：扁平点分 key、default as const、zh-CN 聚合展开。
 * 文案口径：标题 ≤7 字、正文 ≤30 字、Toast ≤20 字；按钮写具体动作。
 */

const versions = {
  // ── 弹窗骨架 ───────────────────────────────────────────────
  "versions.title": "版本与变体",
  "versions.tab.versions": "命名版本",
  "versions.tab.variants": "岗位变体",
  "versions.hint": "命名版本是不可变快照；恢复会生成新的当前版本",
  "versions.error.title": "版本加载失败",
  "versions.error.retry": "重新加载",

  // ── 命名版本：列表与创建 ───────────────────────────────────
  "versions.empty": "还没有命名版本，创建一份保存当前内容与排版",
  "versions.create.title": "保存命名版本",
  "versions.create.name": "版本名称",
  "versions.create.namePlaceholder": "可不填，自动按时间命名",
  "versions.create.summary": "变化摘要",
  "versions.create.summaryPlaceholder": "可不填，服务端按上一版生成行数摘要",
  "versions.create.action": "创建版本",
  /** #28：名称留空时的一键保存名，按钮不再因为"没内容可命名"而禁用。 */
  "versions.create.defaultName": "版本 {time}",
  "versions.create.success": "已创建命名版本「{name}」",
  "versions.create.nameRequired": "先填写版本名称",
  "versions.frozen.tag": "已冻结",
  "versions.source.restore": "恢复生成",
  "versions.source.manual": "手动创建",
  "versions.job.none": "未关联岗位",
  "versions.time.unknown": "时间未知",
  "versions.action.freeze": "冻结版本",
  "versions.action.unfreeze": "解除冻结",
  "versions.frozen.hint": "冻结只做标记；版本内容本来就不可变",
  "versions.action.compare": "比较",
  "versions.action.restore": "恢复这个版本",
  "versions.restore.title": "恢复版本",
  "versions.restore.body": "会生成一个新的当前版本，历史版本与已投递记录不变",
  "versions.restore.ok": "恢复",
  "versions.restore.success": "已恢复为新版本",
  "versions.restore.conflict": "当前简历已被更新，刷新后再试",
  "versions.restore.conflictAction": "刷新版本列表",
  "versions.action.refresh": "刷新",

  // ── 比较 ───────────────────────────────────────────────────
  "versions.compare.title": "版本比较",
  "versions.compare.againstCurrent": "与当前简历比较",
  "versions.compare.againstVersion": "与「{name}」比较",
  "versions.compare.content": "正文变化",
  "versions.compare.noContentChanges": "正文没有字段变化",
  "versions.compare.changeStats": "新增 {added} 条 / 修改 {changed} 处 / 删除 {removed} 条",
  "versions.compare.changesTruncated": "变化太多，只显示前 {count} 条",
  "versions.compare.kind.added": "新增",
  "versions.compare.kind.removed": "删除",
  "versions.compare.kind.changed": "修改",
  "versions.compare.entry.added": "新增条目",
  "versions.compare.entry.removed": "删除条目",
  "versions.compare.section.added": "新增板块",
  "versions.compare.section.removed": "删除板块",
  "versions.compare.value.old": "旧值",
  "versions.compare.value.new": "新值",
  "versions.compare.value.empty": "（空）",
  "versions.compare.layout": "排版差异",
  "versions.compare.layoutEqual": "排版完全一致",
  "versions.compare.layoutAdded": "新增排版项：{keys}",
  "versions.compare.layoutRemoved": "移除排版项：{keys}",
  "versions.compare.layoutChanged": "变更排版项：{keys}",
  "versions.compare.identical": "两份内容完全一致",
  "versions.compare.close": "收起比较",
  "versions.compare.loading": "正在比较版本…",

  // ── 岗位变体 ───────────────────────────────────────────────
  "versions.variants.empty": "还没有岗位变体，派生一份用于特定岗位表达",
  "versions.variants.create.title": "创建变体",
  /** #29a：一句话定义变体，两块重复表单合并后只留这一处说明。 */
  "versions.variants.create.hint": "变体是同一份简历针对不同岗位或场景的独立副本，改动互不影响",
  "versions.variants.create.modeAria": "创建方式",
  "versions.variants.mode.scenario": "从职业场景派生",
  "versions.variants.mode.manual": "从当前简历派生",
  "versions.variants.create.name": "变体名称",
  "versions.variants.create.namePlaceholder": "可不填，自动按时间命名",
  "versions.variants.create.action": "创建变体",
  "versions.variants.create.success": "已创建变体「{name}」",
  "versions.variants.create.defaultName": "变体 {time}",
  "versions.variants.create.scenarioRequired": "先选择职业场景",
  "versions.variants.list.title": "已有变体",
  "versions.variants.refreshAction": "刷新变体列表",
  "versions.variants.scenario.title": "场景变体候选",
  "versions.variants.scenario.hint": "生成候选只预览、不写入，看差异后再采纳",
  "versions.variants.sync.title": "同步到已有变体",
  "versions.variants.sync.groupHint": "把当前简历的改动同步过去，不会反向影响当前简历",
  "versions.variants.base.current": "基于当前简历",
  "versions.variants.base.version": "基于「{name}」",
  "versions.variants.lastSynced": "上次同步基于版本 {id}",
  "versions.variants.neverSynced": "还没有同步过",
  "versions.variants.selectTargets": "选择要同步的变体",
  "versions.variants.selectPaths": "选择要同步的内容",
  "versions.variants.selectAll": "全选",
  "versions.variants.clearAll": "清空",
  "versions.variants.selectedCount": "已选 {count} 条",
  "versions.variants.groupCount": "共 {count} 条",
  "versions.variants.groupToggle": "展开或收起「{name}」",
  "versions.variants.syncPartial": "有 {count} 条未应用：目标变体里没有对应条目",
  "versions.variants.syncAction": "同步选中内容",
  "versions.variants.syncHint": "只改选中路径，其它岗位定制保持原样",
  "versions.variants.syncSuccess": "已同步 {count} 个变体",
  "versions.variants.syncEmpty": "先选择变体与内容路径",
  "versions.variants.syncedPaths": "已写入 {count} 条路径",
  "versions.variants.group.other": "其它内容",

  // ── 导出弹窗的变体选项（fe-delivery 只读消费 buildVariantExportOptions） ──
  "versions.variants.exportOption": "{name}{job}{layout}",
  "versions.variants.exportOption.job": " · {job}",
  "versions.variants.exportOption.layout": " · 独立排版",
  "versions.variants.exportOption.inherited": " · 继承排版",
  "versions.variants.hasLayout": "独立排版",
  "versions.variants.exportSelect": "导出版本",
  "versions.variants.exportSelectHint": "选中的版本会连同它自己的排版一起导出",
  "versions.variants.exportCurrent": "当前简历（不选版本）",

  // ── 通用 ───────────────────────────────────────────────────
  "versions.action.cancel": "取消",
  /** 动作条入口按钮（打开「版本与变体」）。 */
  "versions.action.open": "版本",
  /** 入口按钮的无障碍名。 */
  "versions.action.openAria": "打开版本与变体",
  "versions.action.close": "关闭",
  "versions.loading": "正在加载版本…",
} as const;

export default versions;
