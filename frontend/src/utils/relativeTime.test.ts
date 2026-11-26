// SPDX-License-Identifier: Apache-2.0
/**
 * 事件行副行的相对时间（整改 #13）。
 *
 * 时间断言必须显式固定"现在"与 TZ，否则同一条用例在 CI（UTC）与本机（+08:00）
 * 会得出不同结论。这里的做法与 `serverTime.test.ts` 一致：`now` 由参数注入，
 * 服务端时间戳按 UTC 解释。
 */
import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import { relativeTimeLabel } from "./relativeTime";

/** 设备时区的"现在"：2026-11-26 16:00（本地）。 */
const NOW = new Date("2026-11-26T16:00:00");

describe("relativeTimeLabel", () => {
  it("今天的事件写成「今天 HH:mm」", () => {
    const label = relativeTimeLabel("2026-11-26T06:12:00Z", NOW);
    const clock = new Date("2026-11-26T06:12:00Z").toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    expect(label).toBe(t("notifications.relative.today", { time: clock }));
    expect(label).toContain("今天");
  });

  it("昨天的事件写成「昨天 HH:mm」", () => {
    const label = relativeTimeLabel("2026-11-25T01:20:00Z", NOW);
    expect(label).toContain("昨天");
    expect(label).not.toContain("今天");
  });

  it("更早（同年）只留「月-日」，不带年份", () => {
    // 与"现在"隔了 6 天：不是今天也不是昨天。
    expect(relativeTimeLabel("2026-11-20T02:00:00Z", NOW)).toMatch(/^11-(19|20)$/);
  });

  it("跨年的旧事件补上年份，能看出是哪一年", () => {
    expect(relativeTimeLabel("2025-11-20T02:00:00Z", NOW)).toMatch(/^2025-11-(19|20)$/);
  });

  it("空值 / 解析不了的值返回空串（不渲染 Invalid Date，也不凭空说今天）", () => {
    expect(relativeTimeLabel("", NOW)).toBe("");
    expect(relativeTimeLabel(null, NOW)).toBe("");
    expect(relativeTimeLabel("不是时间", NOW)).toBe("");
  });
});
