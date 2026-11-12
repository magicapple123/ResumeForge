// SPDX-License-Identifier: Apache-2.0
/**
 * 逾期天数（第 4 条）：纯日期字符串的差值口径。
 *
 * 这是"逾期 N 天"的唯一计算入口：用 `new Date("YYYY-MM-DD")` 会按 UTC 解析，
 * 在东八区取本地日期就差一天，所以用例把"今天"注入进来，只验证日期算术本身。
 */
import { describe, expect, it } from "vitest";
import { daysOverdue, todayStamp } from "./trackDates";

/** 本地零点的某一天（月份从 0 开始，与 Date 一致）。 */
function localDay(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

describe("daysOverdue", () => {
  it("昨天是 1 天、今天是 0、明天是负数", () => {
    const now = localDay(2026, 11, 10);
    expect(daysOverdue("2026-11-09", now)).toBe(1);
    expect(daysOverdue("2026-11-10", now)).toBe(0);
    expect(daysOverdue("2026-11-11", now)).toBe(-1);
  });

  it("跨月按真实天数算（10-31 → 11-01 是 1 天）", () => {
    expect(daysOverdue("2026-10-31", localDay(2026, 11, 1))).toBe(1);
    // 10 月 31 天：从 10-01 到 11-01 是 31 天。
    expect(daysOverdue("2026-10-01", localDay(2026, 11, 1))).toBe(31);
  });

  it("空串与不认识的格式当作没有截止日期（-1，不显示标记）", () => {
    expect(daysOverdue("", localDay(2026, 11, 10))).toBe(-1);
    expect(daysOverdue("2026/11/01", localDay(2026, 11, 10))).toBe(-1);
    expect(daysOverdue("2026-11-01T09:00:00", localDay(2026, 11, 10))).toBe(-1);
  });

  it("todayStamp 用本地年月日补零，与后端下发的格式逐字一致", () => {
    expect(todayStamp(localDay(2026, 1, 5))).toBe("2026-01-05");
  });
});
