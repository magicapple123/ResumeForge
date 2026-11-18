// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器侧的 runs 桥（`inlineMarkWrite`）守卫：**兼容读** + **结构化写**（I-13 的验收点）。
 *
 * 三类断言：
 *
 * 1. 旧标记串能被换算成「纯文本 + runs」（存量简历不能静默丢格式）；
 * 2. 有 `rich` 时以它为准，`value` 里的字面星号就是用户正文（不被二次解析）；
 * 3. 工具条/右键菜单的一次样式改动，写回的是 `rich.runs`，**`value` 里不长出标记字符**。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  legacyRichValue,
  readRichValue,
  richClearStyles,
  richItemPatch,
  richOnTextChange,
  richSetLink,
  richToggleBold,
  richToggleSize,
} from "./inlineMarkWrite";
import {
  markFocusedField,
  registerRichField,
  resetInlineMarkFieldsForTests,
} from "./lastFocusedTextarea";
import type { RichValue } from "../inline/richRuns";

function expectNoMarkers(text: string) {
  expect(text).not.toContain("**");
  expect(text).not.toContain("{@");
  expect(text).not.toContain("](");
}

describe("legacyRichValue (compat read)", () => {
  it("turns bold markers into a run without keeping the markers", () => {
    expect(legacyRichValue("**team** lead")).toEqual({
      text: "team lead",
      runs: [{ start: 0, end: 4, bold: true }],
    });
  });

  it("turns style markers into size/color runs", () => {
    expect(legacyRichValue("{@size=0.9,color=#c0392b}ABC{@}DE")).toEqual({
      text: "ABCDE",
      runs: [{ start: 0, end: 3, size: 0.9, color: "#c0392b" }],
    });
  });

  it("keeps unpaired markers as literal text", () => {
    expect(legacyRichValue("2 ** 3")).toEqual({ text: "2 ** 3", runs: [] });
  });
});

describe("readRichValue", () => {
  it("prefers rich.runs and treats value as plain text", () => {
    expect(
      readRichValue({
        value: "2 ** 3",
        rich: { runs: [{ start: 2, end: 4, bold: true }] },
      }),
    ).toEqual({ text: "2 ** 3", runs: [{ start: 2, end: 4, bold: true }] });
  });

  it("falls back to the marker parser when rich is absent", () => {
    expect(readRichValue({ value: "**team** lead" }).runs).toEqual([
      { start: 0, end: 4, bold: true },
    ]);
  });

  it("treats runs that fall outside the text as plain text", () => {
    expect(
      readRichValue({ value: "abc", rich: { runs: [{ start: 9, end: 12, bold: true }] } }),
    ).toEqual({ text: "abc", runs: [] });
  });
});

describe("richItemPatch", () => {
  it("writes value as plain text and drops rich when no runs remain", () => {
    const patch = richItemPatch({ text: "team lead", runs: [] });
    expect(patch.value).toBe("team lead");
    expect(patch.rich).toBeUndefined();
  });

  it("writes rich.runs when styles exist", () => {
    const value: RichValue = { text: "team", runs: [{ start: 0, end: 4, bold: true }] };
    expect(richItemPatch(value)).toEqual({
      value: "team",
      rich: { runs: [{ start: 0, end: 4, bold: true }] },
    });
  });
});

describe("writing through a focused rich field", () => {
  let element: HTMLTextAreaElement;
  let current: RichValue;
  let commit: Mock;

  beforeEach(() => {
    element = document.createElement("textarea");
    document.body.appendChild(element);
    current = { text: "team lead", runs: [] };
    commit = vi.fn((next: RichValue) => {
      current = next;
    });
    markFocusedField(element);
    registerRichField(element, { read: () => current, commit });
  });

  afterEach(() => {
    resetInlineMarkFieldsForTests();
    document.body.innerHTML = "";
  });

  it("richToggleBold commits runs, never markers", () => {
    expect(richToggleBold({ start: 0, end: 4 })).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(current).toEqual({ text: "team lead", runs: [{ start: 0, end: 4, bold: true }] });
    expectNoMarkers(current.text);
  });

  it("size/clear/link all stay inside the runs model", () => {
    richToggleSize({ start: 5, end: 9 }, 1.1);
    expect(current.runs).toEqual([{ start: 5, end: 9, size: 1.1 }]);
    richSetLink({ start: 0, end: 4 }, "https://example.com");
    expect(current.runs).toEqual([
      { start: 0, end: 4, link: "https://example.com" },
      { start: 5, end: 9, size: 1.1 },
    ]);
    richClearStyles({ start: 0, end: 9 });
    expect(current.runs).toEqual([{ start: 0, end: 4, link: "https://example.com" }]);
    expectNoMarkers(current.text);
  });

  it("typing remaps runs instead of re-encoding them", () => {
    richToggleBold({ start: 0, end: 4 });
    const next = richOnTextChange(current, "the team lead");
    expect(next).toEqual({ text: "the team lead", runs: [{ start: 4, end: 8, bold: true }] });
    expectNoMarkers(next.text);
  });
});

describe("no rich target", () => {
  it("returns false so callers keep the legacy path", () => {
    resetInlineMarkFieldsForTests();
    expect(richToggleBold({ start: 0, end: 4 })).toBe(false);
  });
});
