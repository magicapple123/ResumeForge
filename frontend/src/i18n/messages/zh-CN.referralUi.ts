// SPDX-License-Identifier: Apache-2.0
/**
 * 内推界面：列表行、新建 / 编辑弹窗与转化率统计卡的展示文案。
 *
 * 通用的「保存 / 取消 / 删除 / 批量选择」沿用 `common` 语言包，本文件只放内推专属措辞。
 */
const referralUi = {
  "referralUi.form.title.edit": "编辑内推",
  "referralUi.form.title.create": "新建内推",
  "referralUi.list.action.detail": "详情",
  "referralUi.list.action.edit": "编辑",
  "referralUi.list.confirm.deleteTitle": "删除这条内推？",
  "referralUi.list.value.noReferrer": "未记内推人",
  "referralUi.list.tag.converted": "已转化",
  "referralUi.list.label.referralCode": "内推码：{code}",
  "referralUi.list.image.noteAlt": "备注图",
  "referralUi.list.aria.select": "选择内推 {name}",
  "referralUi.list.aria.moreActions": "更多操作 {name}",
  "referralUi.stats.title": "内推转化率",
  "referralUi.stats.valid": "有效内推",
  "referralUi.stats.converted": "已转化",
  "referralUi.stats.rate": "转化率",
} as const;

export default referralUi;
