// SPDX-License-Identifier: Apache-2.0
/**
 * 画布页数的**唯一口径**（`resolvePageCounts`）：三个来源合成一组数。
 *
 * 这里守的是「不限篇幅」（`pageLimit === 0`）那一支——它没有任何上限，因此也**没有
 * 超额页**。把 0 夹成 1（`Math.max(1, …)`）会让画布声称"上限 1 页、第 2 页起不计入
 * 导出"，而实际导出一个字节都没裁；红框、页脚红带、"约需 2 页（上限 1 页）"全来自它。
 */
import { describe, expect, it } from "vitest";
import { resolvePageCounts } from "./overflow";

describe("resolvePageCounts · 有上限（常规路径，防回归）", () => {
  it("内容超限：画足页数、超额页按差值算", () => {
    const counts = resolvePageCounts({ pageLimit: 2, reportedPages: 3 });
    expect(counts.overflow).toBe(true);
    expect(counts.overflowPages).toBe(1);
    expect(counts.visualPages).toBe(3);
    expect(counts.pagesNeeded).toBe(3);
    expect(counts.unlimited).toBe(false);
  });

  it("装得下：没有超额页", () => {
    const counts = resolvePageCounts({ pageLimit: 3, reportedPages: 2 });
    expect(counts.overflow).toBe(false);
    expect(counts.overflowPages).toBe(0);
    expect(counts.visualPages).toBe(3);
  });

  it("报告缺席时退回浏览器测量（测量是下界）", () => {
    const counts = resolvePageCounts({ pageLimit: 1, measuredPages: 4 });
    expect(counts.visualPages).toBe(4);
    expect(counts.overflowPages).toBe(3);
  });

  it("两个来源都没有、只有溢出信号时兜底成「上限 + 1」", () => {
    const counts = resolvePageCounts({ pageLimit: 1, overflowSignal: true });
    expect(counts.visualPages).toBe(2);
    expect(counts.overflow).toBe(true);
  });
});

describe("resolvePageCounts · 不限篇幅（pageLimit = 0）", () => {
  it("不限：页数=真实需求，超额页 0、overflow=false、unlimited=true", () => {
    const counts = resolvePageCounts({ pageLimit: 0, reportedPages: 2 });
    expect(counts.unlimited).toBe(true);
    expect(counts.overflow).toBe(false);
    expect(counts.overflowPages).toBe(0);
    expect(counts.visualPages).toBe(2);
    // 「画几张纸」与「上限」在这一支里是同一个数：没有上限可比，就不该编一个 1 出来。
    expect(counts.pageLimit).toBe(2);
  });

  it("不限 + 溢出信号（单页装不下）：多画一页，但仍不算超额", () => {
    const counts = resolvePageCounts({ pageLimit: 0, overflowSignal: true });
    expect(counts.visualPages).toBe(2);
    expect(counts.overflowPages).toBe(0);
    expect(counts.overflow).toBe(false);
    expect(counts.unlimited).toBe(true);
  });

  it("不限且什么数都没有：至少画一页", () => {
    const counts = resolvePageCounts({ pageLimit: 0 });
    expect(counts.visualPages).toBe(1);
    expect(counts.overflow).toBe(false);
    expect(counts.unlimited).toBe(true);
  });

  it("不限时报告与测量取大（不许因为「没上限」就少画一张纸）", () => {
    const counts = resolvePageCounts({ pageLimit: 0, reportedPages: 2, measuredPages: 4 });
    expect(counts.visualPages).toBe(4);
    expect(counts.pagesNeeded).toBe(4);
    expect(counts.overflowPages).toBe(0);
  });
});
