// SPDX-License-Identifier: Apache-2.0
/**
 * 事实台账卡片（一条只读条目）：抬头兜底标题与核实日期、行内动作、正文标签、
 * 证据与页脚提示。
 */
const claimCard = {
  /** 没有标题与主体时的兜底：用条目 id 指代。 */
  "claimCard.header.fallbackTitle": "条目 {id}",
  /** 抬头右侧的最近核实日期。 */
  "claimCard.header.lastVerified": "最近核实 {date}",
  /** 批量选择模式下勾选框的无障碍名。 */
  "claimCard.header.selectAria": "选择台账条目 {name}",

  /** 行内「标记已确认」按钮。 */
  "claimCard.action.confirm": "标记已确认",
  /** 悬停在确认按钮上的说明：讲清确认后才进生成。 */
  "claimCard.action.confirmTooltip": "确认后这条才会作为事实进入简历生成",
  /** 行内操作菜单：编辑。 */
  "claimCard.action.edit": "编辑",
  /** 行内操作菜单：删除（软删，撤销入口在 Toast 上）。 */
  "claimCard.action.delete": "删除",
  /** 三点菜单按钮的无障碍名。 */
  "claimCard.action.moreAria": "更多操作 {name}",

  /** 原文或表述为空时的占位。 */
  "claimCard.wording.empty": "（未填写）",

  /** 正文第一行的标签。 */
  "claimCard.field.sourceFact": "原始事实",
  /** 正文第二行的标签。 */
  "claimCard.field.wording": "简历表述",
  /** 个人边界一行的标签。 */
  "claimCard.field.boundary": "个人边界",
  /** 可用范围一行的标签。 */
  "claimCard.field.allowedUses": "可用范围",

  /** 页脚证据区的标签。 */
  "claimCard.evidence.title": "证据",
  /** 证据不公开时接在出处后面的后缀。 */
  "claimCard.evidence.privateSuffix": "（不公开）",

  /** 页脚：已填过面试细节的提示。 */
  "claimCard.interview.prepared": "已备面试细节（决策 / 难点 / 验证 / 结果）",
} as const;

export default claimCard;
