// SPDX-License-Identifier: Apache-2.0
/** 历史条件快照的兼容：旧版本把站点筛选项存成单个字符串，读取时要归一成编码数组（§15.3-A）。 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_HISTORY_KEY,
  normalizeFilterValues,
  readConfigHistory,
} from "./collectConfigHistory";

afterEach(() => {
  localStorage.clear();
});

describe("normalizeFilterValues", () => {
  it("旧快照的单个字符串折成单元素数组", () => {
    expect(normalizeFilterValues({ degree: "203" })).toEqual({ degree: ["203"] });
  });

  it("新快照的编码数组原样保留，并去掉重复与空值", () => {
    expect(normalizeFilterValues({ degree: ["203", "203", "", "202"], city: [] })).toEqual({
      degree: ["203", "202"],
    });
  });

  it("缺失/非对象输入回退成空对象", () => {
    expect(normalizeFilterValues(undefined)).toEqual({});
    expect(normalizeFilterValues("203")).toEqual({});
    expect(normalizeFilterValues([])).toEqual({});
  });
});

describe("readConfigHistory", () => {
  it("读到旧版快照时把 filters 归一成数组（否则回填表单会填错控件）", () => {
    localStorage.setItem(
      CONFIG_HISTORY_KEY,
      JSON.stringify([
        {
          savedAt: "2026-11-01T00:00:00.000Z",
          config: { keywords: ["python"], city: "北京", filters: { degree: "203" } },
        },
      ]),
    );
    const [snapshot] = readConfigHistory();
    expect(snapshot.config.filters).toEqual({ degree: ["203"] });
    expect(snapshot.config.keywords).toEqual(["python"]);
  });

  it("损坏的 localStorage 回退空数组，不抛错", () => {
    localStorage.setItem(CONFIG_HISTORY_KEY, "{不是 JSON");
    expect(readConfigHistory()).toEqual([]);
  });
});
