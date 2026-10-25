// SPDX-License-Identifier: Apache-2.0
/**
 * 三栏宽度的**纯函数**边界（`clampWorkbenchWidth` / `parseStoredWidths`）。
 *
 * 为什么单独一个文件：拖拽路径要挂 React + jsdom 才能测（用例在
 * `ResumeZoomModal.test.tsx`），而"读到越界的历史值怎么办"是纯算术，一个像素都不需要
 * 渲染。
 *
 * 2026-10-25 的口径变化（用户："让简历制作台界面的第一列也支持调整宽度"）：参数栏从
 * 2026-10-23 的**固定 380** 回到可调，区间 360–640（下限 = 三列参数行不溢出，上限 =
 * 不把预览挤没；容器 clamp 还会在窗口不够宽时继续降上限）。默认仍是 380，所以旧偏好
 * （localStorage 里的 380）读出来原样有效；更早版本存的 260/300/320 会被抬到 360。
 */
import { describe, expect, it } from "vitest";
import {
  WORKBENCH_DEFAULT_WIDTHS,
  WORKBENCH_PARAMS_WIDTH,
  WORKBENCH_WIDTH_LIMITS,
  clampWorkbenchWidth,
  parseStoredWidths,
} from "./useWorkbenchColumns";

describe("三栏宽度 · 常量", () => {
  it("参数栏 360–640（默认 380）、内容栏 380–760（默认 448）", () => {
    expect(WORKBENCH_PARAMS_WIDTH).toBe(380);
    expect(WORKBENCH_DEFAULT_WIDTHS).toEqual({ params: 380, editor: 448 });
    expect(WORKBENCH_WIDTH_LIMITS.params).toEqual({ min: 360, max: 640 });
    expect(WORKBENCH_WIDTH_LIMITS.editor).toEqual({ min: 380, max: 760 });
    // 默认值必须自己就在区间内，否则首屏就与 clamp 打架。
    expect(WORKBENCH_DEFAULT_WIDTHS.params).toBeGreaterThanOrEqual(
      WORKBENCH_WIDTH_LIMITS.params.min,
    );
    expect(WORKBENCH_DEFAULT_WIDTHS.params).toBeLessThanOrEqual(WORKBENCH_WIDTH_LIMITS.params.max);
    expect(WORKBENCH_DEFAULT_WIDTHS.editor).toBeGreaterThanOrEqual(
      WORKBENCH_WIDTH_LIMITS.editor.min,
    );
  });
});

describe("clampWorkbenchWidth", () => {
  it("参数栏低于 360 抬到 360、高于 640 压到 640，区间内原样", () => {
    expect(clampWorkbenchWidth("params", 260)).toBe(360);
    expect(clampWorkbenchWidth("params", 300)).toBe(360);
    expect(clampWorkbenchWidth("params", 360)).toBe(360);
    expect(clampWorkbenchWidth("params", 380)).toBe(380);
    expect(clampWorkbenchWidth("params", 520)).toBe(520);
    expect(clampWorkbenchWidth("params", 640)).toBe(640);
    expect(clampWorkbenchWidth("params", 9999)).toBe(640);
  });

  it("内容栏低于下限抬到 380，高于上限压到 760", () => {
    expect(clampWorkbenchWidth("editor", 320)).toBe(380);
    expect(clampWorkbenchWidth("editor", 900)).toBe(760);
  });

  it("区间内原样返回，小数四舍五入（CSS 里不要 448.4px 这种值）", () => {
    expect(clampWorkbenchWidth("editor", 448.4)).toBe(448);
    expect(clampWorkbenchWidth("editor", 448.6)).toBe(449);
  });

  it("非有限数一律回落到下限，不污染 CSS", () => {
    expect(clampWorkbenchWidth("params", Number.NaN)).toBe(360);
    expect(clampWorkbenchWidth("editor", Number.POSITIVE_INFINITY)).toBe(380);
    expect(clampWorkbenchWidth("editor", Number.NEGATIVE_INFINITY)).toBe(380);
  });
});

describe("parseStoredWidths", () => {
  it("没有存过（null）→ 默认宽度", () => {
    expect(parseStoredWidths(null)).toEqual({ params: 380, editor: 448 });
  });

  it("坏 JSON / 非对象 / JSON null → 默认宽度，不抛异常", () => {
    expect(parseStoredWidths("{not json")).toEqual({ params: 380, editor: 448 });
    expect(parseStoredWidths('"a string"')).toEqual({ params: 380, editor: 448 });
    expect(parseStoredWidths("null")).toEqual({ params: 380, editor: 448 });
  });

  it("缺字段 → 缺的那个回落到下限（不是默认值：`Number(undefined)` 是 NaN）", () => {
    // 这是既有语义，特意钉住：NaN 走 `clampNumber` 的"回落下限"支路。
    expect(parseStoredWidths(JSON.stringify({ params: 380 }))).toEqual({
      params: 380,
      editor: 380,
    });
    expect(parseStoredWidths(JSON.stringify({ editor: 448 }))).toEqual({
      params: 360,
      editor: 448,
    });
  });

  it("越界历史值在**读取时**就被夹好（拖动上限前后不一致的安全网）", () => {
    expect(parseStoredWidths(JSON.stringify({ params: 300, editor: 320 }))).toEqual({
      params: 360,
      editor: 380,
    });
    expect(parseStoredWidths(JSON.stringify({ params: 9999, editor: 10 }))).toEqual({
      params: 640,
      editor: 380,
    });
  });

  it("合法值原样带出（含字符串数字：localStorage 里可能被别的版本写坏）", () => {
    expect(parseStoredWidths(JSON.stringify({ params: 420, editor: 600 }))).toEqual({
      params: 420,
      editor: 600,
    });
    expect(parseStoredWidths(JSON.stringify({ params: "380", editor: "512" }))).toEqual({
      params: 380,
      editor: 512,
    });
  });
});
