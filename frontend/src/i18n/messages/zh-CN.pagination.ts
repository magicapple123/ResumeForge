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

  // ── 三种分页意图 ───────────────────────────────────────────
  "pagination.breakBefore": "从新页开始",
  /** 说明：只在打印/导出生效。 */
  "pagination.breakBefore.hint": "打印与导出从新页开始，草稿预览不显示断页",
  "pagination.keepWithNext": "标题跟随",
  /** 不跟随（0 行）。 */
  "pagination.keepWithNext.none": "不跟随",
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

  // ── 格式支持（矩阵口径）─────────────────────────────────────
  "pagination.capability.title": "格式支持",
  "pagination.capability.pending": "格式支持以检查模块的能力矩阵为准",
  "pagination.capability.allSupported": "三种格式都支持",
  "pagination.capability.details": "分页报告",
  "pagination.capability.entryBreak": "手动分页",
  "pagination.capability.keepWithNext": "标题跟随",
  "pagination.capability.pageNumbers": "页码/续页",

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
