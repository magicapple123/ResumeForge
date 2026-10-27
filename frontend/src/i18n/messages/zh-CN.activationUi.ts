// SPDX-License-Identifier: Apache-2.0
/**
 * 首页「第一份交付」进度面板：面板标题、完成标记、底部说明与三阶段文案。
 *
 * 阶段文案在 `useActivationProgress` 的函数体内取（`t()` 不在模块作用域求值），
 * 组件 `FirstDeliveryPanel` 只负责自己的标题、完成标记与底部说明。
 */
const activationUi = {
  /** 面板标题。 */
  "activationUi.panel.title": "从零到第一份可交付简历",
  /** 已完成阶段标题旁的标记。 */
  "activationUi.panel.done": "已完成",
  /** 面板底部的补充说明：哪些事不需要配置模型。 */
  "activationUi.panel.note":
    "手动填写、本地检查与导出不需要配置模型；需要 AI 的功能随时可在设置里配。",

  /** 阶段 1 的标题。 */
  "activationUi.facts.title": "准备事实",
  /** 阶段 1 的说明：资料关键字段齐了，或已有台账/简历事实。 */
  "activationUi.facts.description":
    "填好「我的资料」关键字段（姓名与联系方式），或先有台账/简历事实",
  /** 阶段 1 的 CTA 按钮。 */
  "activationUi.facts.cta.label": "去我的资料录入",
  /** 资料关键字段已齐时的 CTA 提示。 */
  "activationUi.facts.cta.hintReady": "手动填写不需要模型",
  /** 缺关键字段时的 CTA 提示。 */
  "activationUi.facts.cta.hintMissing": "姓名与联系方式是生成简历的关键字段，先补全这两项",

  /** 阶段 2 的标题。 */
  "activationUi.target.title": "选择目标岗位",
  /** 阶段 2 的说明。 */
  "activationUi.target.description": "收一个岗位，为它生成或关联一份简历",
  /** 还没有岗位时的 CTA 按钮。 */
  "activationUi.target.cta.labelNoJobs": "去岗位广场收岗位",
  /** 还没有岗位时的 CTA 提示。 */
  "activationUi.target.cta.hintNoJobs": "手动录入或自动采集都行",
  /** 已有岗位时的 CTA 按钮。 */
  "activationUi.target.cta.labelWithJob": "为岗位生成或关联简历",
  /** 已有岗位时的 CTA 提示。 */
  "activationUi.target.cta.hintWithJob": "有岗位了，还差一份对着它的简历",

  /** 阶段 3 的标题。 */
  "activationUi.deliver.title": "核实并交付",
  /** 阶段 3 的说明。 */
  "activationUi.deliver.description": "把台账里的主张逐条核实，有简历后导出或投出",
  /** 台账为空时的进度文案。 */
  "activationUi.deliver.progressEmpty": "台账为空：还没有可核实的主张",
  /** 台账为空时的 CTA 按钮。 */
  "activationUi.deliver.cta.labelEmpty": "去事实台账录入主张",
  /** 台账为空时的 CTA 提示。 */
  "activationUi.deliver.cta.hintEmpty": "把要写进简历的话先记成一条，才谈得上核实",
  /** 已核实 N/M 条主张的进度文案；`{verified}` 是已核实数，`{total}` 是总数。 */
  "activationUi.deliver.progressVerified": "已核实 {verified}/{total} 条主张",
  /** 有未核实主张时的 CTA 按钮。 */
  "activationUi.deliver.cta.labelPending": "核实 {count} 条待确认事实",
  /** 有未核实主张时的 CTA 提示。 */
  "activationUi.deliver.cta.hintPending": "没核实的说法不会进简历",
  /** 全部核实但还没有简历时的 CTA 按钮。 */
  "activationUi.deliver.cta.labelNoResume": "去简历中心生成或关联简历",
  /** 全部核实但还没有简历时的 CTA 提示。 */
  "activationUi.deliver.cta.hintNoResume": "事实都核实了，还差一份对着岗位的简历",
} as const;

export default activationUi;
