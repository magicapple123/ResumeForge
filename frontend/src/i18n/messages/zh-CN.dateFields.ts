// SPDX-License-Identifier: Apache-2.0
/**
 * 个人资料日期字段（年 / 月 / 日下拉、至今勾选、年份分组与解析失败提示）的界面文案。
 */
const dateFields = {
  "dateFields.aria.year": "{label}年份",
  "dateFields.aria.month": "{label}月份",
  "dateFields.aria.day": "{label}日期",
  "dateFields.placeholder.year": "年",
  "dateFields.placeholder.month": "月",
  "dateFields.placeholder.day": "日",
  "dateFields.ongoing": "至今",
  "dateFields.parseUnsupported": "当前日期格式无法识别；请选择日期后保存，旧值暂时保留。",
  "dateFields.yearGroup.past": "今年及以前",
  "dateFields.yearGroup.future": "未来年份",
} as const;

export default dateFields;
