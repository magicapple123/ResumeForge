// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireStartupSlot,
  consumeFirstVisitGuide,
  markUserGuideSeen,
  releaseStartupSlot,
  setUserGuideVisible,
  shouldShowUserGuide,
  STARTUP_SLOT_TIMEOUT_MS,
  USER_GUIDE_STORAGE_KEY,
} from "./userGuide";

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
  // 队列是模块级状态：每个用例结束后把三个槽位都清掉，避免串味。
  setUserGuideVisible(false);
  releaseStartupSlot("welcome");
  releaseStartupSlot("reminder");
  releaseStartupSlot("update");
});

describe("user guide persistence", () => {
  it("only consumes the first visit", () => {
    expect(consumeFirstVisitGuide(window.localStorage)).toBe(true);
    expect(consumeFirstVisitGuide(window.localStorage)).toBe(false);
    expect(window.localStorage.getItem(USER_GUIDE_STORAGE_KEY)).toBe("1");
  });

  it("supports reopening without changing the first-visit marker", () => {
    markUserGuideSeen(window.localStorage);
    expect(shouldShowUserGuide(window.localStorage)).toBe(false);
  });

  it("does not throw when browser storage is unavailable", () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
    };

    expect(() => consumeFirstVisitGuide(unavailableStorage)).not.toThrow();
    expect(consumeFirstVisitGuide(unavailableStorage)).toBe(true);
  });
});

describe("startup prompt queue", () => {
  it("grants slots in the fixed order welcome → reminder → update", async () => {
    const granted: string[] = [];
    setUserGuideVisible(true);
    const reminder = acquireStartupSlot("reminder").then(() => granted.push("reminder"));
    const update = acquireStartupSlot("update").then(() => granted.push("update"));

    await Promise.resolve();
    expect(granted).toEqual([]);

    setUserGuideVisible(false);
    await reminder;
    expect(granted).toEqual(["reminder"]);

    releaseStartupSlot("reminder");
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(2000);
    await update;
    expect(granted).toEqual(["reminder", "update"]);
    releaseStartupSlot("update");
  });

  it("does not let the update slot jump ahead of a reminder that registers late", async () => {
    vi.useFakeTimers();
    const granted: string[] = [];
    const update = acquireStartupSlot("update").then(() => granted.push("update"));
    const reminder = acquireStartupSlot("reminder").then(() => granted.push("reminder"));

    await vi.advanceTimersByTimeAsync(2000);
    expect(granted).toEqual(["reminder"]);

    releaseStartupSlot("reminder");
    await vi.advanceTimersByTimeAsync(2000);
    expect(granted).toEqual(["reminder", "update"]);
    releaseStartupSlot("update");
    await Promise.all([update, reminder]);
  });

  it("releases a stuck slot after the timeout so later prompts still appear", async () => {
    vi.useFakeTimers();
    const granted: string[] = [];
    setUserGuideVisible(true);
    const reminder = acquireStartupSlot("reminder").then(() => granted.push("reminder"));

    await vi.advanceTimersByTimeAsync(STARTUP_SLOT_TIMEOUT_MS + 10);
    await reminder;
    expect(granted).toEqual(["reminder"]);
    releaseStartupSlot("reminder");
  });

  it("ignores duplicate release calls", () => {
    setUserGuideVisible(true);
    releaseStartupSlot("welcome");
    expect(() => releaseStartupSlot("welcome")).not.toThrow();
  });
});
