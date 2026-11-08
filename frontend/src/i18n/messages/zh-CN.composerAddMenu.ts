// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区左侧「+」入口（R06-A）：一个面板收掉附件 / 关联岗位 / 关联简历 / 技能。
 *
 * 只放这个面板**自己才有**的文案。组内控件沿用既有 key：
 * - 两个下拉的占位与无障碍名来自 `assistantComposer.placeholder.*` / `assistantComposer.aria.*`；
 * - 技能行与二级列表沿用 `assistantComposer.skills.*` 与 `conversationSkills.*`；
 * - 返回按钮沿用 `common.action.back`。
 *
 * 同义文案不在这里复制一份——两处一旦措辞分叉，同一个动作就会有两种叫法。
 */
const composerAddMenu = {
  /** 触发按钮的无障碍名（静态：开合状态由 Dropdown 挂的 aria-expanded 表达）。 */
  "composerAddMenu.aria.trigger": "添加附件、关联或技能",
  /** 悬停提示：一句话说清这个按钮后面有什么。 */
  "composerAddMenu.tooltip": "添加附件 / 关联岗位或简历 / 技能",
  /** 关联岗位一行的标签。 */
  "composerAddMenu.section.job": "关联岗位",
  /** 关联简历一行的标签。 */
  "composerAddMenu.section.resume": "关联简历",
  /** 技能二级面板的标题（同时也是返回按钮的落点说明）。 */
  "composerAddMenu.section.skills": "技能",
  /** 添加附件这一行动作的文字（可点区域等于原来那枚附件按钮）。 */
  "composerAddMenu.action.attach": "添加附件",
} as const;

export default composerAddMenu;
