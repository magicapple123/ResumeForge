// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredWebSearch, writeStoredWebSearch } from "./webSearchPref";

const KEY = "resumeforge.assistant.web_search";

describe("webSearchPref", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("没有存储值时默认为关（联网不能靠默认值替用户决定）", () => {
    expect(readStoredWebSearch()).toBe(false);
  });

  it("存 1 读回开、存 0 读回关，编码是 1/0", () => {
    writeStoredWebSearch(true);
    expect(window.localStorage.getItem(KEY)).toBe("1");
    expect(readStoredWebSearch()).toBe(true);

    writeStoredWebSearch(false);
    expect(window.localStorage.getItem(KEY)).toBe("0");
    expect(readStoredWebSearch()).toBe(false);
  });

  it("损坏的值按关处理（不抛、不猜）", () => {
    window.localStorage.setItem(KEY, "yes");
    expect(readStoredWebSearch()).toBe(false);
  });

  it("getItem 抛异常时退回关（隐私模式不能白屏）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readStoredWebSearch()).toBe(false);
  });

  it("setItem 抛异常时不向上抛（记忆是便利功能）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeStoredWebSearch(true)).not.toThrow();
  });
});
