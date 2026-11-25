// SPDX-License-Identifier: Apache-2.0
/**
 * 展开状态持久化（CR-33）：`.v1` 键、坏 JSON 容错。
 *
 * 偏好数据坏了只该退回「全部折叠」，绝不能把简历列表整个打成白屏。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPANDED_GROUPS_KEY,
  readExpandedGroupKeys,
  writeExpandedGroupKeys,
} from "./expandedGroups";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("expandedGroups", () => {
  it("没存过时返回空数组（默认全部折叠）", () => {
    expect(readExpandedGroupKeys()).toEqual([]);
  });

  it("写入后能按原样读回", () => {
    writeExpandedGroupKeys(["job:17", "resume:3"]);
    expect(window.localStorage.getItem(EXPANDED_GROUPS_KEY)).toBe('["job:17","resume:3"]');
    expect(readExpandedGroupKeys()).toEqual(["job:17", "resume:3"]);
  });

  it("坏 JSON 容错为全部折叠", () => {
    window.localStorage.setItem(EXPANDED_GROUPS_KEY, "{not json");
    expect(readExpandedGroupKeys()).toEqual([]);
  });

  it("存了非数组时也退回全部折叠", () => {
    window.localStorage.setItem(EXPANDED_GROUPS_KEY, '{"job:17":true}');
    expect(readExpandedGroupKeys()).toEqual([]);
  });

  it("数组里混入非字符串时只保留字符串", () => {
    window.localStorage.setItem(EXPANDED_GROUPS_KEY, '["job:17",1,null,{"a":1}]');
    expect(readExpandedGroupKeys()).toEqual(["job:17"]);
  });

  it("localStorage 写入失败时不抛错（隐私模式 / 配额满）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeExpandedGroupKeys(["job:17"])).not.toThrow();
  });

  it("localStorage 读取失败时不抛错", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readExpandedGroupKeys()).toEqual([]);
  });
});
