// SPDX-License-Identifier: Apache-2.0
/** 阶段构成条的百分比：最大余数法保证五个数加起来正好 100（12.2 验收点）。 */
import { describe, expect, it } from "vitest";
import { largestRemainderPercents } from "./trackComposition";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("largestRemainderPercents", () => {
  it("3/1/1/2/1 → 38/12/12/25/13，且合计恰好 100", () => {
    const percents = largestRemainderPercents([3, 1, 1, 2, 1]);
    expect(percents).toEqual([38, 12, 12, 25, 13]);
    expect(sum(percents)).toBe(100);
  });

  it("全部为 0：返回等长全 0，不整除也不崩", () => {
    expect(largestRemainderPercents([0, 0, 0, 0, 0])).toEqual([0, 0, 0, 0, 0]);
  });

  it("单一阶段占满：100 归到那一格", () => {
    expect(largestRemainderPercents([0, 0, 0, 0, 7])).toEqual([0, 0, 0, 0, 100]);
  });

  it("各种计数组合的合计都是 100（不会出现 102%）", () => {
    const cases = [
      [1, 1, 1, 1, 1],
      [2, 1, 0, 2, 0],
      [5, 3, 2, 1, 1],
      [1, 0, 0, 0, 2],
      [7, 7, 7, 7, 7],
      [9, 1, 0, 0, 0],
    ];
    for (const counts of cases) {
      expect(sum(largestRemainderPercents(counts)), `counts=${counts.join("/")}`).toBe(100);
    }
  });

  it("负数按 0 处理（脏数据不产生负百分比）", () => {
    const percents = largestRemainderPercents([-1, 1, 1, 0, 0]);
    expect(percents.every((value) => value >= 0)).toBe(true);
    expect(sum(percents)).toBe(100);
  });
});
