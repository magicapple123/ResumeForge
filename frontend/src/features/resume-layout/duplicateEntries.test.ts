// SPDX-License-Identifier: Apache-2.0
/** 重复条目判据（D03）：按归一化内容分组，不按 id / 下标。 */
import { describe, expect, it } from "vitest";
import { findDuplicateTargets } from "./duplicateEntries";

describe("duplicateEntries", () => {
  it("标题 + 元信息都相同才算重复", () => {
    const duplicates = findDuplicateTargets([
      { id: "exp_11111111", label: "星河科技", meta: "2023-01 至 2024-06" },
      { id: "exp_22222222", label: " 星河科技 ", meta: "2023-01 至 2024-06" },
      { id: "exp_33333333", label: "星河科技", meta: "2021-01 至 2022-06" },
    ]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.ids).toEqual(["exp_11111111", "exp_22222222"]);
    expect(duplicates[0]?.count).toBe(2);
  });

  it("空标题不参与（数据缺失不是重复内容）", () => {
    expect(
      findDuplicateTargets([
        { id: "exp_11111111", label: " " },
        { id: "exp_22222222", label: "" },
      ]),
    ).toEqual([]);
  });

  it("组按重复条数降序、同数按内容键稳定排序", () => {
    const duplicates = findDuplicateTargets([
      { id: "a1234567", label: "B" },
      { id: "b1234567", label: "B" },
      { id: "c1234567", label: "A" },
      { id: "d1234567", label: "A" },
      { id: "e1234567", label: "A" },
    ]);
    expect(duplicates.map((group) => group.count)).toEqual([3, 2]);
    expect(duplicates[0]?.label).toBe("A");
  });

  it("大小写与多余空白归一", () => {
    const duplicates = findDuplicateTargets([
      { id: "exp_11111111", label: "Acme  Inc" },
      { id: "exp_22222222", label: "acme inc" },
    ]);
    expect(duplicates).toHaveLength(1);
  });
});
