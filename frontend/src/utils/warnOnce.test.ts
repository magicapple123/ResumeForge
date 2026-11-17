// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWarnOnce, warnOnce } from "./warnOnce";

afterEach(() => {
  resetWarnOnce();
  vi.restoreAllMocks();
});

describe("warnOnce（T12）", () => {
  it("同一个 key 只打一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnOnce("k", "第一次");
    warnOnce("k", "第二次");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("第一次");
  });

  it("不同 key 各自打一次", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnOnce("a", "a");
    warnOnce("b", "b");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("reset 之后可以重新打（测试之间不互相污染）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnOnce("k", "x");
    resetWarnOnce();
    warnOnce("k", "x");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
