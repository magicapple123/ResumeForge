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
  "versions.create.namePlaceholder": "例如：投递某公司终稿",
  "versions.create.summary": "变化摘要",
  "versions.create.summaryPlaceholder": "可不填，服务端按上一版生成行数摘要",
  "versions.create.action": "创建版本",
  "versions.create.success": "已创建命名版本",
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
  "versions.compare.content": "正文差异",
  "versions.compare.layout": "排版差异",
  "versions.compare.layoutEqual": "排版完全一致",
  "versions.compare.layoutAdded": "新增排版项：{keys}",
  "versions.compare.layoutRemoved": "移除排版项：{keys}",
  "versions.compare.layoutChanged": "变更排版项：{keys}",
  "versions.compare.identical": "两份内容完全一致",
  "versions.compare.close": "收起比较",
  "versions.compare.loading": "正在比较版本…",
  /** 比较摘要里的正文行数。 */
  "versions.compare.contentStats": "正文 +{added} / -{removed} 行",

  // ── 岗位变体 ───────────────────────────────────────────────
  "versions.variants.empty": "还没有岗位变体，派生一份用于特定岗位表达",
  "versions.variants.create.title": "派生岗位变体",
  "versions.variants.create.name": "变体名称",
  "versions.variants.create.namePlaceholder": "例如：后端岗位版",
  "versions.variants.create.action": "派生变体",
  "versions.variants.create.success": "已派生岗位变体",
  "versions.variants.create.nameRequired": "先填写变体名称",
  "versions.variants.base.current": "基于当前简历",
  "versions.variants.base.version": "基于「{name}」",
  "versions.variants.lastSynced": "上次同步基于版本 {id}",
  "versions.variants.neverSynced": "还没有同步过",
  "versions.variants.selectTargets": "选择要同步的变体",
  "versions.variants.selectPaths": "选择要同步的内容",
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
