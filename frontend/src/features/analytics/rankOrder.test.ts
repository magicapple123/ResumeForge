// SPDX-License-Identifier: Apache-2.0
/** 榜单本地排序（R13）：三段字段、平局按名称、柱长与数值跟着字段走、0% 不出柱子。 */
import { describe, expect, it } from "vitest";
import {
  barSuffixOf,
  barValueOf,
  DEFAULT_RANK_METRIC,
  interviewRateOf,
  sortRanked,
  type RankInput,
} from "./rankOrder";

interface Row extends RankInput {
  id: string;
}

function row(id: string, name: string, total: number, interviewCount: number): Row {
  return { id, name, total, interviewCount };
}

const read = (item: Row): RankInput => item;
const ids = (items: Row[]) => items.map((item) => item.id);

// 刻意让三种排序给出三个**不同**的次序，否则"恒定按入参顺序返回"也能通过。
const ROWS: Row[] = [
  row("a", "官网", 2, 0), // 投递 2、0 进面 → 0%
  row("b", "内推", 4, 2), // 投递 4、50%
  row("c", "猎头", 1, 1), // 投递 1、100%
];

describe("sortRanked", () => {
  it("默认按投递数降序（与后端聚合口径一致）", () => {
    expect(DEFAULT_RANK_METRIC).toBe("applications");
    expect(ids(sortRanked(ROWS, read, "applications"))).toEqual(["b", "a", "c"]);
  });

  it("按面试率降序：不是投递数最多的那个排第一", () => {
    expect(ids(sortRanked(ROWS, read, "interviewRate"))).toEqual(["c", "b", "a"]);
  });

  it("按名称升序（中文按拼音：猎头 lie < 内推 nei < 官网 guan… 用 localeCompare 口径）", () => {
    const byName = sortRanked(ROWS, read, "name");
    expect(byName.length).toBe(3);
    // 只断言"与 localeCompare 同序"，不在测试里重写一份拼音表。
    const expected = [...ROWS]
      .sort((left, right) =>
        left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" }),
      )
      .map((item) => item.id);
    expect(ids(byName)).toEqual(expected);
  });

  it("平局时按名称，名称也相同才保留原次序（稳定）", () => {
    const ties = [row("x", "乙公司", 3, 1), row("y", "甲公司", 3, 1)];
    expect(ids(sortRanked(ties, read, "applications"))).toEqual(["y", "x"]);
    // 反过来喂一次，结果不变：稳定性不依赖入参顺序里的"运气"。
    expect(ids(sortRanked([...ties].reverse(), read, "applications"))).toEqual(["y", "x"]);
  });

  it("不改入参（回到原次序）", () => {
    sortRanked(ROWS, read, "interviewRate");
    expect(ids(ROWS)).toEqual(["a", "b", "c"]);
  });
});

describe("柱长与右侧数值", () => {
  it("按投递数排时是次数，按面试率排时是百分比", () => {
    expect(barValueOf(ROWS[1], "applications")).toBe(4);
    expect(barValueOf(ROWS[1], "interviewRate")).toBe(50);
    expect(barSuffixOf("interviewRate")).toBe("%");
    expect(barSuffixOf("applications")).toBeUndefined();
  });

  it("0% 的柱值为 0（条图只在 >0 时画柱子，所以 0% 不会出现假柱子）", () => {
    expect(barValueOf(ROWS[0], "interviewRate")).toBe(0);
  });

  it("投递数为 0 时面试率是 0 而不是 NaN", () => {
    expect(interviewRateOf(row("z", "空", 0, 0))).toBe(0);
  });
});
