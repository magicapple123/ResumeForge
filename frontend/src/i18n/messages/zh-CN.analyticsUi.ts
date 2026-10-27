// SPDX-License-Identifier: Apache-2.0
/**
 * 求职统计页图表组件的通用文案：数据缺口提示与漏斗图的无障碍名。
 *
 * 数据缺口提示的「共 N 条记录」是**条件片段**（只有调用方传了 `available` 才渲染），
 * 所以单独成 key；两段在渲染处直接相接，中文里不需要空格。
 */
const analyticsUi = {
  /** 数据缺口提示的第一句：`{missing}` 缺失条数，`{label}` 缺的是什么（调用方已翻译）。 */
  "analyticsUi.dataGap.notice": "有 {missing} 条{label}，未计入图表",
  /** 数据缺口提示的括号补充：`{total}` 是「计入 + 未计入」的总条数。 */
  "analyticsUi.dataGap.total": "（共 {total} 条记录）",

  /** 漏斗图的无障碍名（每张图必须不同，见 `HorizontalBarChart` 的 `ariaLabel`）。 */
  "analyticsUi.funnel.aria": "求职漏斗",
} as const;

export default analyticsUi;
