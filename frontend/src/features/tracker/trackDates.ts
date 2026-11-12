// SPDX-License-Identifier: Apache-2.0
/**
 * 进度记录的日期口径：只比"年月日"，不碰时区。
 *
 * `next_action_date` 是后端下发的纯日期字符串（`YYYY-MM-DD`）。直接 `new Date("2026-10-31")`
 * 会按 **UTC** 解析，在东八区再取本地日期就差一天——同一份数据在 UTC+8 与 UTC-5 会给出
 * 不同的"逾期几天"。所以两端都按本地零点的年月日重新构造，差值才是真实天数。
 */

/** 今天（本地）的 `YYYY-MM-DD`；与行内已有的字符串比较口径同一个格式。 */
export function todayStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * 距截止日期过去多少天：今天 `0`、昨天 `1`、明天 `-1`。
 *
 * 格式不认识时返回 `-1`（当作"没有截止日期"，不显示逾期标记）——空字符串、后端将来
 * 换格式都不会让某一行凭空变成"逾期 20000 天"。
 */
export function daysOverdue(dateText: string, now: Date = new Date()): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return -1;
  const [year, month, day] = dateText.split("-").map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // 用 round 而不是 floor：夏令时切换那天只差 23 小时，floor 会把 1 天算成 0。
  return Math.round((today.getTime() - target.getTime()) / 86_400_000);
}
