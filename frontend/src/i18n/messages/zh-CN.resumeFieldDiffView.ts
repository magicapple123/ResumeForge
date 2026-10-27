// SPDX-License-Identifier: Apache-2.0
/**
 * 版本对比的字段级视图：顶部对比条与三项计数、单个字段/列表区块的三态标签、
 * 空值占位、未变化折叠头，以及底部「查看原始差异」兜底。
 *
 * key 按区块分组：`tag`/`column` 描述一个区块内部的标签，`stats` 是顶部的计数，
 * `raw` 是原始源码差异的折叠入口。`subFieldLabel` 带 `{label}` 占位符，字段名本身
 * 来自数据层（不在本包内）。
 */
const resumeFieldDiffView = {
  // ── 顶部对比条 ──────────────────────────────────────────────
  "resumeFieldDiffView.compare": "对比：",
  /** 顶部三个计数标签；数值由调用方传入。 */
  "resumeFieldDiffView.stats.added": "新增 {added}",
  "resumeFieldDiffView.stats.removed": "删除 {removed}",
  "resumeFieldDiffView.stats.unchanged": "未变 {unchanged}",

  // ── 区块三态标签 ────────────────────────────────────────────
  "resumeFieldDiffView.tag.added": "新增",
  "resumeFieldDiffView.tag.removed": "删除",
  "resumeFieldDiffView.tag.modified": "修改",

  // ── 字符串字段：旧→新两列 ────────────────────────────────────
  "resumeFieldDiffView.column.old": "原",
  "resumeFieldDiffView.column.new": "新",
  /** 一侧没有内容时的占位。 */
  "resumeFieldDiffView.empty": "（空）",
  /** 列表条目既无标题也无键时的占位。 */
  "resumeFieldDiffView.itemFallback": "（条目）",
  /** 子字段行首：`{label}` 是字段名，冒号是全角。 */
  "resumeFieldDiffView.subFieldLabel": "{label}：",

  // ── 未变化折叠 ──────────────────────────────────────────────
  "resumeFieldDiffView.unchangedItems": "{count} 个条目未变化",
  "resumeFieldDiffView.unchangedFields": "{count} 个字段未变化",

  // ── 空态与原始差异兜底 ──────────────────────────────────────
  "resumeFieldDiffView.emptyDescription": "两份简历内容完全一致，没有差异",
  "resumeFieldDiffView.raw.toggle": "查看原始差异",
} as const;

export default resumeFieldDiffView;
