// SPDX-License-Identifier: Apache-2.0
/** 匹配分析进行中登记表：列表/详情上的「分析中」标志依赖它。 */
import { describe, expect, it, vi } from "vitest";
import {
  beginMatchAnalysis,
  endMatchAnalysis,
  getMatchAnalyzingIds,
  isMatchAnalyzing,
  subscribeMatchAnalysis,
} from "./jobMatchAnalysisState";

describe("jobMatchAnalysisState", () => {
  it("begin 后可见进行中，end 后消失", () => {
    beginMatchAnalysis(1);
    expect(isMatchAnalyzing(1)).toBe(true);
    expect(getMatchAnalyzingIds().has(1)).toBe(true);

    endMatchAnalysis(1);
    expect(isMatchAnalyzing(1)).toBe(false);
  });

  it("begin/end 触发订阅；重复 begin 与未登记的 end 都不触发", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMatchAnalysis(listener);

    beginMatchAnalysis(2);
    expect(listener).toHaveBeenCalledTimes(1);

    beginMatchAnalysis(2);
    expect(listener).toHaveBeenCalledTimes(1);

    endMatchAnalysis(2);
    expect(listener).toHaveBeenCalledTimes(2);

    endMatchAnalysis(2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    beginMatchAnalysis(3);
    expect(listener).toHaveBeenCalledTimes(2);
    endMatchAnalysis(3);
  });

  it("取消订阅后不再收到通知", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeMatchAnalysis(listener);
    unsubscribe();

    beginMatchAnalysis(4);
    expect(listener).not.toHaveBeenCalled();
    endMatchAnalysis(4);
  });
});
