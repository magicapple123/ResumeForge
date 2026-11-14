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

  /** 查看态卡片头（替代原来那条整宽 Alert）：返回入口 + 「时间 · 岗位/简历」。 */
  "interviewReview.header.back": "返回复盘列表",
  "interviewReview.header.meta": "{time} · {target}",

  "interviewReview.card.setup": "面试复盘",
  "interviewReview.placeholder.question":
    "录入面试里真实被问的问题，例如：你这个项目的难点是怎么解决的？",
  "interviewReview.placeholder.job": "关联岗位（选填，输入关键词搜索）",
  "interviewReview.placeholder.resume": "关联简历（反向优化必选，输入关键词搜索）",
  /** 简历来源这一块的标签与说明：下拉本身含内部/外部两组，文件走同一块的「导入文件」。 */
  "interviewReview.resume.label": "简历",
  "interviewReview.resume.hint":
    "下拉里有两组：本应用的简历、外部简历（上传的）；也可以直接导入一份简历文件",
  "interviewReview.action.analyze": "分析答题思路",

  "interviewReview.card.analysis": "答题思路",
  "interviewReview.section.keyPoints": "要点",
  /**
   * 短板 / 追问是**可编辑输入**（问题 12），标签不能再用只读列表时的「常见误区」「可能的追问」：
   * 那两句话描述的是模型给的展示内容，不是"这里要你填什么"。
   */
  "interviewReview.field.weaknesses": "面试暴露的短板",
  "interviewReview.field.followUps": "面试官的高频追问",
  "interviewReview.placeholder.weaknesses":
    "每行一条，例如：被问到指标口径时答不上来；留空也可以，只要追问里写了内容",
  "interviewReview.placeholder.followUps": "每行一条，例如：这个指标具体怎么算的",

  "interviewReview.action.optimize": "反向优化简历",
  "interviewReview.action.save": "保存复盘",
  "interviewReview.optimize.note": "只产出建议列表，不直接改简历正文。",
  /** 两个输入都空时的说明，同时是按钮禁用原因（此前用户只看到"请至少填写一条…"却找不到地方填）。 */
  "interviewReview.optimize.needInput": "先写一条面试里被问住的地方，或让面试官追问过的问题",
  /** 超过后端 `MAX_OPTIMIZE_ITEMS` 时提示：前端已截断，提交不会 422。 */
  "interviewReview.optimize.truncated": "一次最多提交 {limit} 条，已保留前 {limit} 条",
  "interviewReview.empty": "录入问题后，先分析答题思路",

  "interviewReview.card.legacy": "历史复盘",
  "interviewReview.legacy.title": "此为旧版记录，仅可查看",
  "interviewReview.legacy.body": "旧版历史以纯文本保存，无法还原为结构化复盘，仅展示原始内容。",

  // ===== 历史列表的折叠摘要（展开只看摘要，完整内容点进详情） =====
  "interviewReview.history.summary.suggestions": "{count} 条改进建议",
  "interviewReview.history.summary.empty": "这条记录没有可摘要的内容，点「查看详情」看原文",

  "interviewReview.error.needQuestion": "请先录入真实被问的问题",
  "interviewReview.error.analyzeFailed": "分析答题思路失败",
  "interviewReview.error.needResume": "请先选择要优化的简历",
  "interviewReview.error.needAnalysis": "请先分析答题思路",
  "interviewReview.error.autoSaveFailed": "自动保存复盘历史失败",
  "interviewReview.error.writeBackFailed": "建议已生成，但写回历史失败",
  "interviewReview.error.notPersisted":
    "建议已生成，但这条复盘还没保存成功，先点「保存复盘」再试写回。",
  "interviewReview.error.optimizeFailed": "反向优化失败",
  "interviewReview.deleted": "已删除复盘历史",
  "interviewReview.error.deleteFailed": "删除复盘历史失败",
} as const;

export default interviewReview;
