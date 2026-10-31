// SPDX-License-Identifier: Apache-2.0
/**
 * 「分页控制」（W08 / P1-03）这一批**新增**的界面文案。
 *
 * 拆法与其它领域一致：扁平点分 key、默认导出 `pagination`、`as const`；登记到
 * `messages/zh-CN.namespaces.ts`，主文件 `zh-CN.ts` 不动。
 *
 * ## 边界（与契约 §3 一致）
 *
 * - 草稿预览**看不到**手动断页（多列不是分页媒体）：文案如实说明并用精确预览核对，
 *   不画假分页线；
 * - 续页信息只在精确 PDF / Word 生效；草稿标注不支持；
 * - 页数措辞与制作台/精确预览/试模板同一套："按当前设置约需 N 页（上限 M 页）"。
 */

const pagination = {
  // ── 分组与范围 ─────────────────────────────────────────────
  "pagination.group.title": "分页",
  /** 条目级控件的范围说明。 */
  "pagination.scope.entry": "这一条",
  /** 板块级控件的范围说明。 */
  "pagination.scope.section": "整个板块",
  /** 没有选中对象时的提示。 */
  "pagination.scope.pick": "先在大纲或纸面选中一条内容",
  /** 板块选择器的无障碍名。 */
  "pagination.scope.sectionAria": "选择要设置的板块",

  // ── 板块分页方式（全局显式选择，2026-10-25）───────────────────
  /** 全局控件：整份简历的板块之间默认怎么排。 */
  "pagination.mode.title": "板块分页方式",
  "pagination.mode.aria": "板块分页方式",
  /** 默认：板块自然续排（不是按模块断开）。 */
  "pagination.mode.flow": "自然填充",
  /** 每个板块都从新页开始。 */
  "pagination.mode.page": "每板块新页",
  /** 如实说明默认行为：避免用户以为精确模式默认按模块断开。 */
  "pagination.mode.note": "板块默认自然续排，只有设了「从新页开始」的板块才从新页开始",
  /** 部分板块有断页时的小结（自然填充模式下显示，把隐藏状态变可见）。 */
  "pagination.mode.partial": "{count} 个板块从新页开始",
  /** 切回「自然填充」会清掉全部板块断页：这是不可撤销的批量操作，先确认一次。 */
  "pagination.mode.confirmTitle": "切回自然填充？",
  "pagination.mode.confirmBody":
    "会清掉 {count} 个板块的「从新页开始」，条目级断页与续页信息都不受影响",
  "pagination.mode.confirmOk": "切回自然填充",
  "pagination.mode.confirmCancel": "取消",

  // ── 已设置的板块断页（可见 / 可清除）──────────────────────────
  "pagination.breaks.title": "已设置断页",
  /** 芯片上的清除按钮：动作写清对象。 */
  "pagination.breaks.clearOne": "清除「{label}」的断页",
  /** 一键恢复默认：清全部板块断页（条目级不动）。 */
  "pagination.breaks.restore": "恢复自然分页",
  "pagination.breaks.restoreHint": "清除所有板块的断页设置，条目级断页不受影响",
  /** 条目芯片：条目已从简历里删掉、但断页意图还在（仍可清除）。 */
  "pagination.breaks.unknownEntry": "已删除的条目",
  /** 条目芯片的清除按钮：动作写清是哪一条。 */
  "pagination.breaks.clearEntry": "清除「{label}」的条目断页",
  /** 汇总芯片上的 ✕：label 已包含板块/条目名与开关名，这里只补动作。 */
  "pagination.breaks.clearChip": "清除断页设置：{label}",
  /** 还没有任何断页时的空态（不编造数字）。 */
  "pagination.breaks.empty": "还没有设置断页",
  /** 芯片点击跳转的说明：这是唯一能"看它落在哪"的入口。 */
  "pagination.breaks.jumpHint": "跳到结构页签的这条设置",
  /** 条目芯片的说明：两层断页互不干扰，别让用户以为「恢复自然分页」能清掉条目断页。 */
  "pagination.breaks.entryHint": "条目断页只作用于这一条，「恢复自然分页」不会清除它",

  // ── 逐板块设置（可折叠，不默认占满高度）──────────────────────
  "pagination.sections.settings": "逐板块设置",
  /** 还没选板块时的提示。 */
  "pagination.sections.pick": "选一个板块后可微调它的分页",
  /** 折叠头右侧的已设断页计数。 */
  "pagination.sections.summary": "{count} 个板块已设断页",

  // ── 条目级分页（选中条目时出现）──────────────────────────────
  "pagination.entry.title": "这一条的断页",
  /** 没选中条目时的指路：告诉用户"选中一条才会出现这一条的控件"。 */
  "pagination.entry.pick": "在大纲或纸面选中一条内容，这里会多出「这一条的断页」",

  // ── 三种分页意图 ───────────────────────────────────────────
  "pagination.breakBefore": "从新页开始",
  /** 说明：只在打印/导出生效。 */
  "pagination.breakBefore.hint": "打印与导出从新页开始，草稿预览不显示断页",
  "pagination.keepWithNext": "标题跟随",
  /** 标题跟随的用途说明：解释「避免标题单独落在页尾」这件事本身。 */
  "pagination.keepWithNext.hint":
    "避免标题单独落在页尾：让标题与后续 N 行保持同页；「默认」按模板默认处理",
  /** 0 档 = 按模板默认（板块级预留高度里本来就保底 1 行，"不跟随"是错的描述）。 */
  "pagination.keepWithNext.none": "默认",
  /** 跟随后续 N 行。 */
  "pagination.keepWithNext.lines": "跟随 {count} 行",
  /** 跟随行数选择器的无障碍名。 */
  "pagination.keepWithNext.aria": "「{label}」跟随后续几行",
  "pagination.allowSplit": "允许跨页",
  "pagination.allowSplit.hint": "放不下时允许拆到下一页，避免整条被顶到新页",
  /** 默认行为说明（等于今天的行为）。 */
  "pagination.allowSplit.default": "默认保持整条不跨页",

  // ── 续页信息 ───────────────────────────────────────────────
  "pagination.continuation.title": "续页信息",
  "pagination.continuation.repeatName": "续页重复姓名",
  "pagination.continuation.pageNumbers": "显示页码",
  /** 草稿不支持续页信息：如实标注。 */
  "pagination.continuation.note": "只在精确 PDF 与 Word 生效，草稿预览没有页",

  // ── 草稿说明 ───────────────────────────────────────────────
  "pagination.draft.note": "手动分页在草稿预览里不显示，用精确预览核对实际断页",
  /** Q09：面板顶部固定说明旁的「切到精确预览」。 */
  "pagination.exactPreview.switch": "切到精确预览",
  "pagination.exactPreview.hint": "断页只在精确预览与导出里生效",
  "pagination.exactPreview.already": "当前已在精确预览",

  // ── 格式支持（矩阵口径）─────────────────────────────────────
  "pagination.capability.title": "格式支持",
  /** 没有矩阵时的指引：说清"去哪里能拿到"，而不是让用户自己去猜"检查"在哪。 */
  "pagination.capability.pending":
    "在「检查」里生成一次报告后，这里会按能力矩阵说明各格式的支持情况",
  "pagination.capability.allSupported": "三种格式都支持",
  "pagination.capability.details": "分页报告",
  "pagination.capability.entryBreak": "手动分页",
  "pagination.capability.keepWithNext": "标题跟随",
  "pagination.capability.pageNumbers": "页码/续页",

  // ── 页缩略图（W08：实际页数 / 末页占用 / 问题位置）────────────
  /** 缩略图区标题。 */
  "pagination.thumbnails.title": "页缩略图",
  /** 还没有分页报告时的空态（不编页数）。 */
  "pagination.thumbnails.empty": "还没有分页报告",
  /** 空态指引：点名真实的「获取分页报告」按钮（用户指南引用必须逐字一致）。 */
  "pagination.thumbnails.hint": "点「获取分页报告」后按真实 PDF 排版测量",
  /** 缩略图内的取报告按钮：用户就在看缩略图，不必回画布顶部找。 */
  "pagination.thumbnails.refresh": "获取分页报告",
  /** 单页的读屏名。 */
  "pagination.thumbnails.page": "第 {page} 页",
  /** 末页徽标。 */
  "pagination.thumbnails.last": "末页",
  /** 有页数上限时的汇总。 */
  "pagination.thumbnails.summary": "实际 {pages} 页（上限 {limit} 页）",
  /** 没有页数上限时的汇总。 */
  "pagination.thumbnails.summaryNoLimit": "实际 {pages} 页",
  /** 自然排版需要的页数（溢出时补一句）。 */
  "pagination.thumbnails.needed": "自然排版约需 {pages} 页",
  /** 末页占用（有实测比例时）。 */
  "pagination.thumbnails.fill": "末页占用 {percent}%",
  /** 溢出但后端未给末页比例：只能确定"满页被截断"，不编百分比。 */
  "pagination.thumbnails.fillTruncated": "末页已截断（满页）",
  /** 后端未提供末页占用时的如实说明。 */
  "pagination.thumbnails.fillUnknown": "末页占用未测量",
  /** 溢出页徽标。 */
  "pagination.thumbnails.truncatedBadge": "溢出",
  /** 手动分页落点徽标。 */
  "pagination.thumbnails.manualBreakBadge": "新页起",
  /** 页级问题数（严重度由颜色 + 文案共同表达）。 */
  "pagination.thumbnails.issue": "{count} 个问题",
  /** 全局注意事项（不属于某一页）。 */
  "pagination.thumbnails.warnings": "{count} 条注意事项",
  /** 单页读屏名后缀：这一页有几条问题。 */
  "pagination.thumbnails.pageIssues": "，{count} 个问题",
  /** 读屏名多段拼接用的分隔符（全角逗号；放在语言包里，源码里不写中文标点）。 */
  "pagination.thumbnails.ariaJoin": "，",

  // ── 分页报告与溢出定位 ──────────────────────────────────────
  /** 报告区的标题。 */
  "pagination.report.title": "分页报告",
  "pagination.report.pages": "按当前设置约需 {pages} 页（上限 {limit} 页）",
  "pagination.report.overflow": "超出上限，导出会截断到上限页",
  "pagination.report.empty": "还没有分页报告",
  "pagination.report.refresh": "获取分页报告",
  "pagination.report.loading": "正在测量分页",
  "pagination.report.failed": "分页报告获取失败",
  "pagination.report.retry": "重新获取",
  /** 第一条未显示内容的说明（text_preview 是用户原文片段）。 */
  "pagination.report.truncated": "第一条未显示：{preview}",
  /** 截断位置的种类。 */
  "pagination.report.kind.entry": "条目",
  "pagination.report.kind.point": "要点",
  "pagination.report.kind.section": "板块",
  "pagination.report.kind.meta": "日期行",
  /** 定位按钮：滚到画布并高亮（宿主复用既有选中/高亮机制）。 */
  "pagination.report.locate": "定位这条",
  "pagination.report.manualBreaks": "手动断页",
  /** 手动断页行：第 N 页起是某条/某板块。 */
  "pagination.report.manualBreak": "第 {page} 页起：{name}",
  "pagination.report.warnings": "注意事项",
  /** 快照不一致：报告基于上一版内容/参数。 */
  "pagination.report.stale": "报告基于上一版，改动后请重新获取",
} as const;

export default pagination;
