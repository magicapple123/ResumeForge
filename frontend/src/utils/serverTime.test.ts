// SPDX-License-Identifier: Apache-2.0
/**
 * 服务端时间戳工具（问题 14）：naive UTC → 设备时区。
 *
 * 所有断言都**显式传 `timeZone`**：`process.env.TZ` 的生效时机在 Node 各版本间不一致，
 * 靠"在 setup 里改 TZ"会让这批用例在不同机器上飘（+8 机器绿、UTC CI 红）。
 */
import { describe, expect, it } from "vitest";
import { formatServerTime, parseServerTime } from "./serverTime";

const SH = "Asia/Shanghai";

describe("parseServerTime", () => {
  it("无偏移量按 UTC 解释", () => {
    const date = parseServerTime("2026-11-03T15:50:11");
    expect(date?.toISOString()).toBe("2026-11-03T15:50:11.000Z");
  });

  it("已带 Z / +00:00 / +08:00 时不重复追加（幂等）", () => {
    expect(parseServerTime("2026-11-03T15:50:11Z")?.toISOString()).toBe(
      "2026-11-03T15:50:11.000Z",
    );
    expect(parseServerTime("2026-11-03T15:50:11+00:00")?.toISOString()).toBe(
      "2026-11-03T15:50:11.000Z",
    );
    // +08:00 的 23:50 就是 UTC 15:50——与上面同一个时刻。
    expect(parseServerTime("2026-11-03T23:50:11+08:00")?.toISOString()).toBe(
      "2026-11-03T15:50:11.000Z",
    );
    expect(parseServerTime("2026-11-03T23:50:11+0800")?.toISOString()).toBe(
      "2026-11-03T15:50:11.000Z",
    );
  });

  it("空值与非法值返回 null", () => {
    expect(parseServerTime("")).toBeNull();
    expect(parseServerTime("   ")).toBeNull();
    expect(parseServerTime("not-a-timestamp")).toBeNull();
  });
});

describe("formatServerTime", () => {
  it("naive UTC 15:50 在东八区显示 23:50（问题现象里的那一条）", () => {
    expect(formatServerTime("2026-11-03T15:50:11", { timeZone: SH })).toBe("2026-11-03 23:50");
  });

  it("跨日：UTC 23:50 → 东八区次日的 07:50", () => {
    expect(formatServerTime("2026-11-03T23:50:00", { timeZone: SH })).toBe("2026-11-04 07:50");
  });

  it("带偏移量的值按同一个时刻渲染（不重复加 Z）", () => {
    expect(formatServerTime("2026-11-03T15:50:11Z", { timeZone: SH })).toBe("2026-11-03 23:50");
    expect(formatServerTime("2026-11-03T15:50:11+00:00", { timeZone: SH })).toBe(
      "2026-11-03 23:50",
    );
    expect(formatServerTime("2026-11-03T23:50:11+08:00", { timeZone: SH })).toBe(
      "2026-11-03 23:50",
    );
  });

  it("按传入时区渲染，而不是硬编码 +8", () => {
    // 同一条 naive UTC：纽约（11 月为 EST，UTC-5）= 10:50，UTC = 15:50。
    expect(formatServerTime("2026-11-03T15:50:11", { timeZone: "America/New_York" })).toBe(
      "2026-11-03 10:50",
    );
    expect(formatServerTime("2026-11-03T15:50:11", { timeZone: "UTC" })).toBe(
      "2026-11-03 15:50",
    );
  });

  it("seconds 输出到秒", () => {
    expect(formatServerTime("2026-11-03T15:50:11", { timeZone: SH, seconds: true })).toBe(
      "2026-11-03 23:50:11",
    );
  });

  it("dateOnly 只输出日期，跨午夜落到本地的那一天", () => {
    // UTC 10-30 16:30 → 东八区 10-31 00:30（旧写法会显示成 10-30，差一天）。
    expect(formatServerTime("2026-10-30T16:30:00", { timeZone: SH, dateOnly: true })).toBe(
      "2026-10-31",
    );
    expect(formatServerTime("2026-10-30T15:30:00", { timeZone: SH, dateOnly: true })).toBe(
      "2026-10-30",
    );
  });

  it("非法值原样返回（不产出 Invalid Date）", () => {
    expect(formatServerTime("not-a-timestamp", { timeZone: SH })).toBe("not-a-timestamp");
    expect(formatServerTime("", { timeZone: SH })).toBe("");
    expect(formatServerTime("2026-11-03T25:70:70", { timeZone: SH })).toBe("2026-11-03T25:70:70");
  });
});
