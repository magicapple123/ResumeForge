// SPDX-License-Identifier: Apache-2.0
/** 字段对照纯规则（W16）：行数由数据决定、事实锁标记、差异/空态判定、数组摊平。 */
import { describe, expect, it } from "vitest";
import { MOCK_PRIMARY, MOCK_SECONDARY } from "./mock";
import { buildBilingualPairs, changedPairs, readFieldText } from "./fieldPairs";

describe("buildBilingualPairs", () => {
  const pairs = buildBilingualPairs(MOCK_PRIMARY, MOCK_SECONDARY);

  it("页眉字段全部生成，且姓名被标为事实锁", () => {
    const name = pairs.find((pair) => pair.path === "name");
    expect(name?.locked).toBe(true);
    expect(pairs.some((pair) => pair.path === "job_intent")).toBe(true);
    expect(pairs.some((pair) => pair.path === "summary")).toBe(true);
  });

  it("机构与时间字段被标为事实锁，普通描述不是", () => {
    const school = pairs.find((pair) => pair.path === "education.0.school");
    const start = pairs.find((pair) => pair.path === "education.0.start_date");
    const description = pairs.find((pair) => pair.path === "experience.0.description");
    expect(school?.locked).toBe(true);
    expect(start?.locked).toBe(true);
    expect(description?.locked).toBe(false);
  });

  it("两侧内容不同 → changed；相同 → same；两侧都空 → empty", () => {
    expect(pairs.find((pair) => pair.path === "summary")?.status).toBe("changed");
    expect(pairs.find((pair) => pair.path === "name")?.status).toBe("same");
    expect(pairs.find((pair) => pair.path === "gender")?.status).toBe("empty");
  });

  it("一侧条目更多时多出的行也生成（另一侧为空）", () => {
    const extra = buildBilingualPairs(MOCK_PRIMARY, {
      ...MOCK_SECONDARY,
      awards: [{ name: "Extra", date: "2024", description: "" }],
    });
    expect(extra.some((pair) => pair.path === "awards.0.name")).toBe(true);
  });

  it("null 内容也能生成完整结构（全部为空）", () => {
    const empty = buildBilingualPairs(null, null);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every((pair) => pair.status === "empty")).toBe(true);
  });
});

describe("changedPairs", () => {
  it("只保留有内容的行", () => {
    const pairs = buildBilingualPairs(MOCK_PRIMARY, MOCK_SECONDARY);
    const visible = changedPairs(pairs);
    expect(visible.length).toBeLessThan(pairs.length);
    expect(visible.every((pair) => pair.status !== "empty")).toBe(true);
  });
});

describe("readFieldText", () => {
  it("字符串原样、数组换行连接、缺失为空", () => {
    expect(readFieldText(MOCK_PRIMARY, "name")).toBe("Lin Zhiyuan");
    expect(readFieldText(MOCK_PRIMARY, "education.0.courses")).toBe("Data Structures");
    expect(readFieldText(MOCK_PRIMARY, "awards.9.name")).toBe("");
    expect(readFieldText(null, "name")).toBe("");
  });
});
