// SPDX-License-Identifier: Apache-2.0
/**
 * `formatStepTime`：历史步骤的时间文本（今天 HH:mm，跨天 MM-DD HH:mm）。
 *
 * 断言全部用**注入的 now**：真实 `new Date()` 会让"今天/不是今天"取决于运行时刻，
 * 正是本仓禁止的一类偶发失败。
 */
import { describe, expect, it } from "vitest";
import { formatStepTime } from "./formatStepTime";

/** 本地时区的固定时刻：不受运行环境时区影响（构造函数按本地时间解释）。 */
function localTime(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe("formatStepTime", () => {
  it("same local day -> HH:mm with leading zeros", () => {
    const now = new Date(localTime(2026, 10, 29, 15, 0));
    expect(formatStepTime(localTime(2026, 10, 29, 9, 5), now)).toBe("09:05");
    expect(formatStepTime(localTime(2026, 10, 29, 15, 0), now)).toBe("15:00");
  });

  it("another day -> MM-DD HH:mm (so two 10:05 steps never look identical)", () => {
    const now = new Date(localTime(2026, 10, 29, 15, 0));
    expect(formatStepTime(localTime(2026, 10, 28, 23, 59), now)).toBe("10-28 23:59");
    expect(formatStepTime(localTime(2026, 1, 2, 3, 4), now)).toBe("01-02 03:04");
  });

  it("invalid timestamps render nothing instead of NaN", () => {
    expect(formatStepTime(Number.NaN)).toBe("");
    expect(formatStepTime(Number.POSITIVE_INFINITY)).toBe("");
  });
});
