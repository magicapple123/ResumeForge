// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面壳角标聚合（CR-24）：未读通知 + 待确认任务 = 一个数字。
 *
 * 价值全在"两路相加"这条规则上：任何一方直接调 `setBadge` 都会把对方的数字覆盖掉，
 * 所以这里既测加法，也测"没桥时不崩"与"重复上报不重复推"。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportBadgePart, resetBadgeParts } from "./desktopBadge";

const setBadge = vi.fn();

beforeEach(() => {
  setBadge.mockReset();
  resetBadgeParts();
  (window as { resumeForge?: unknown }).resumeForge = { setBadge };
});

afterEach(() => {
  delete (window as { resumeForge?: unknown }).resumeForge;
});

describe("desktopBadge", () => {
  it("两路相加：未读 3 + 待确认 2 → 推 5", () => {
    reportBadgePart("unread", 3);
    reportBadgePart("pending", 2);
    expect(setBadge).toHaveBeenLastCalledWith(5);
  });

  it("只变一路时，另一路的数不被清掉", () => {
    reportBadgePart("unread", 3);
    reportBadgePart("pending", 2);
    reportBadgePart("unread", 0);
    expect(setBadge).toHaveBeenLastCalledWith(2);
  });

  it("同一个数重复上报不重复推（避免无谓 IPC）", () => {
    reportBadgePart("unread", 4);
    reportBadgePart("unread", 4);
    expect(setBadge).toHaveBeenCalledTimes(1);
  });

  it("脏值按 0 处理：负数、NaN 都不会把角标变成怪数", () => {
    reportBadgePart("unread", 4);
    reportBadgePart("unread", -5);
    reportBadgePart("pending", Number.NaN);
    expect(setBadge).toHaveBeenLastCalledWith(0);
  });

  it("浏览器里没有桥时不抛错（网页版同一个组件）", () => {
    delete (window as { resumeForge?: unknown }).resumeForge;
    expect(() => reportBadgePart("unread", 2)).not.toThrow();
  });
});
