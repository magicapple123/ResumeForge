// SPDX-License-Identifier: Apache-2.0
/**
 * 按条审阅弹窗（RF-13）：AI 润色 / 手填的待审变更在落表单前的逐条 diff 审阅。
 *
 * key 按区块分组：`modal` 是弹窗标题，`footer` 是底部进度与主/次按钮，`action` 是
 * 「全部接受 / 接受 / 拒绝」这类动作，`item` 是单条变更内部的来源、改写要求与多原因
 * 分隔符，`verdict` 是预检结论的词表与台账出口，`diff` 是空 diff 占位。
 *
 * 「取消」复用 `common.action.cancel`，本包不复制通用动作。
 */
const resumeChangeReview = {
  // ── 弹窗骨架 ────────────────────────────────────────────────
  /** 弹窗标题（顶部只读审阅，不改简历）。 */
  "resumeChangeReview.modal.title": "逐条审阅改动",

  // ── 底部：审阅进度与主/次按钮 ────────────────────────────────
  /** 底部左端的进度：只有已接受数。 */
  "resumeChangeReview.footer.accepted": "已接受 {count} 条",
  /** 底部左端的进度：还有未决条目时把两对数一起给（不做字符串拼接）。 */
  "resumeChangeReview.footer.acceptedWithUndecided": "已接受 {accepted} 条，未决 {undecided} 条",
  /** 主按钮：应用所选变更（没有已接受条目时）。 */
  "resumeChangeReview.footer.applySelected": "应用所选",
  /** 主按钮：带上将被应用的条数。 */
  "resumeChangeReview.footer.applySelectedCount": "应用所选（{count}）",

  // ── 顶部工具行 ──────────────────────────────────────────────
  /** 一次性接受全部条目。 */
  "resumeChangeReview.action.acceptAll": "全部接受",
  /** 顶部说明：讲清只有被接受的改动会落进表单，本弹窗不直接改简历。 */
  "resumeChangeReview.hint.acceptedOnly": "只有被接受的改动会填入表单；保存后才会更新简历。",

  // ── 单条变更 ────────────────────────────────────────────────
  /** 来源标签：AI 改写产生的变更。 */
  "resumeChangeReview.origin.aiRewrite": "AI 改写",
  /** 来源标签：用户手填的变更。 */
  "resumeChangeReview.origin.userSupplement": "用户补充",
  /** 改写要求一行；`{instruction}` 是用户当初给模型的原话。 */
  "resumeChangeReview.item.instruction": "改写要求：{instruction}",
  /** 单条接受。 */
  "resumeChangeReview.action.accept": "接受",
  /** 单条拒绝。 */
  "resumeChangeReview.action.reject": "拒绝",

  // ── 预检结论 ────────────────────────────────────────────────
  /** 预检通过，可直接应用。 */
  "resumeChangeReview.verdict.ok": "预检通过",
  /** 涉及事实：提示回事实台账核实（同时用作 Tag 与 Alert 标题）。 */
  "resumeChangeReview.verdict.factCheckNeeded": "涉及事实，建议回台账核实",
  /** 含未完成标记：这一条不能写入。 */
  "resumeChangeReview.verdict.blocked": "含未完成标记，不能写入",
  /** blocked 且后端没给具体原因时的兜底提示。 */
  "resumeChangeReview.verdict.blockedFallback": "内容含未完成标记，请先补全",
  /** Alert 里的出口链接：去事实台账核对。 */
  "resumeChangeReview.verdict.factCheckLink": "去事实台账核实",
  /** 多条预检原因之间的分隔符（中文用全角分号，英文换成半角分号加空格）。 */
  "resumeChangeReview.item.reasonSeparator": "；",

  // ── 空 diff ─────────────────────────────────────────────────
  /** 原值为空时，diff 区域里的占位。 */
  "resumeChangeReview.diff.empty": "（这一栏原来是空的）",
} as const;

export default resumeChangeReview;
