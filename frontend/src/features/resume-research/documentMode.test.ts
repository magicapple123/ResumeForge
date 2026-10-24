// SPDX-License-Identifier: Apache-2.0
/**
 * 长 CV 文档模式（W14）的纯规则：区间、夹紧、切换提示、超限判据。
 *
 * 这些数字必须与后端 `schemas/resume_generation.py` 一致（普通 1–3 页、长 CV 1–10 页），
 * 所以这里的断言刻意**写死** 3 / 10：后端改了这两条测试会红，提醒同批改契约与 UI。
 */
import { describe, expect, it } from "vitest";
import {
  LONG_CV_DEFAULT_PAGE_LIMIT,
  MODE_PAGE_LIMITS,
  RESUME_DEFAULT_PAGE_LIMIT,
  clampPageLimit,
  defaultPageLimit,
  isOverBudget,
  normalizeDocumentMode,
  pageLimitOnModeSwitch,
  pageLimitOptions,
  pageLimitRange,
} from "./documentMode";

describe("区间与默认值", () => {
  it("普通简历 1–3 页、长 CV 1–10 页（与后端一致）", () => {
    expect(MODE_PAGE_LIMITS.resume).toEqual([1, 3]);
    expect(MODE_PAGE_LIMITS.long_cv).toEqual([1, 10]);
    expect(pageLimitRange("resume")).toEqual([1, 3]);
    expect(pageLimitRange("long_cv")).toEqual([1, 10]);
  });

  it("默认页数：普通 1、长 CV 2", () => {
    expect(RESUME_DEFAULT_PAGE_LIMIT).toBe(1);
    expect(LONG_CV_DEFAULT_PAGE_LIMIT).toBe(2);
    expect(defaultPageLimit("resume")).toBe(1);
    expect(defaultPageLimit("long_cv")).toBe(2);
  });

  it("可选页数列表首尾正确", () => {
    expect(pageLimitOptions("resume")).toEqual([1, 2, 3]);
    expect(pageLimitOptions("long_cv")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("normalizeDocumentMode", () => {
  it("未知值一律当普通简历（旧记录没有这一列）", () => {
    expect(normalizeDocumentMode(undefined)).toBe("resume");
    expect(normalizeDocumentMode(null)).toBe("resume");
    expect(normalizeDocumentMode("")).toBe("resume");
    expect(normalizeDocumentMode("cv")).toBe("resume");
    expect(normalizeDocumentMode("long_cv")).toBe("long_cv");
  });
});

describe("clampPageLimit", () => {
  it("按模式夹紧并取整", () => {
    expect(clampPageLimit("resume", 4)).toBe(3);
    expect(clampPageLimit("resume", 0)).toBe(1);
    expect(clampPageLimit("long_cv", 10)).toBe(10);
    expect(clampPageLimit("long_cv", 11)).toBe(10);
    expect(clampPageLimit("long_cv", 2.6)).toBe(3);
  });

  it("NaN 落回该模式默认值", () => {
    expect(clampPageLimit("resume", Number.NaN)).toBe(1);
    expect(clampPageLimit("long_cv", Number.NaN)).toBe(2);
  });
});

describe("pageLimitOnModeSwitch", () => {
  it("切到长 CV 时页数不变（1–10 覆盖 1–3）", () => {
    expect(pageLimitOnModeSwitch(3, "long_cv")).toEqual({ pageLimit: 3, clamped: false });
  });

  it("切回普通简历时超出的页数被夹到 3，并标记 clamped", () => {
    expect(pageLimitOnModeSwitch(7, "resume")).toEqual({ pageLimit: 3, clamped: true });
    expect(pageLimitOnModeSwitch(2, "resume")).toEqual({ pageLimit: 2, clamped: false });
  });
});

describe("isOverBudget", () => {
  it("只有真实数字且大于上限才算超限", () => {
    expect(isOverBudget(3, 2)).toBe(true);
    expect(isOverBudget(2, 2)).toBe(false);
    expect(isOverBudget(null, 2)).toBe(false);
    expect(isOverBudget(Number.NaN, 2)).toBe(false);
  });
});
