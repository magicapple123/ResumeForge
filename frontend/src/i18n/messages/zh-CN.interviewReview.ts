// SPDX-License-Identifier: Apache-2.0
/**
 * 面试复盘面板：录入问题 → 分析答题思路 → 反向优化简历，以及历史记录富还原。
 *
 * ## 两个「关联」占位符是两句话，不是一条
 *
 * 岗位是**选填**、简历是反向优化的**必选**，所以 `placeholder.job` 与
 * `placeholder.resume` 各存一条：合并成一条会把"必选"写到选填字段上。
 * 历史视图里那颗简历下拉与新建时是同一个字段，文案相同，因此共用 `placeholder.resume`。
 *
 * ## `alert.viewing` 的括号进 key
 *
 * 中文用全角括号「（…）」、英文用 ASCII「(…)」，属于随语言变化的标点，
 * 不能留在代码里拼。`{time}` 由调用方格式化好（`created_at` 去 T、截到分钟）再传入。
 */
const interviewReview = {
  /** 历史视图顶部提示；`{id}` 是记录号，`{time}` 是格式化后的时间。 */
  "interviewReview.alert.viewing": "正在查看历史复盘 #{id}（{time}）",

  "interviewReview.card.setup": "面试复盘",
  "interviewReview.placeholder.question":
    "录入面试里真实被问的问题，例如：你这个项目的难点是怎么解决的？",
  "interviewReview.placeholder.job": "关联岗位（选填，输入关键词搜索）",
  "interviewReview.placeholder.resume": "关联简历（反向优化必选，输入关键词搜索）",
  "interviewReview.action.analyze": "分析答题思路",

  "interviewReview.card.analysis": "答题思路",
  "interviewReview.section.keyPoints": "要点",
  "interviewReview.section.followUp": "可能的追问",
  "interviewReview.section.pitfalls": "常见误区",

  "interviewReview.action.optimize": "反向优化简历",
  "interviewReview.action.save": "保存复盘",
  "interviewReview.optimize.note": "只产出建议列表，不直接改简历正文。",
  "interviewReview.empty": "录入问题后，先分析答题思路",

  "interviewReview.card.legacy": "历史复盘",
  "interviewReview.legacy.title": "此为旧版记录，仅可查看",
  "interviewReview.legacy.body": "旧版历史以纯文本保存，无法还原为结构化复盘，仅展示原始内容。",

  "interviewReview.error.needQuestion": "请先录入真实被问的问题",
  "interviewReview.error.analyzeFailed": "分析答题思路失败",
  "interviewReview.error.needResume": "请先选择要优化的简历",
  "interviewReview.error.needAnalysis": "请先分析答题思路",
  "interviewReview.error.autoSaveFailed": "自动保存复盘历史失败",
  "interviewReview.error.writeBackFailed": "建议已生成，但写回历史失败",
  "interviewReview.error.optimizeFailed": "反向优化失败",
  "interviewReview.deleted": "已删除复盘历史",
  "interviewReview.error.deleteFailed": "删除复盘历史失败",
} as const;

export default interviewReview;
