// SPDX-License-Identifier: Apache-2.0
/**
 * `richRuns` 的纯函数守卫（I-12 · P2 / I-13）。
 *
 * 这些用例守的是"结构化模型"本身的四条性质，任何一条破了都会在界面上表现成
 * "点了没反应"或"改一处、别处也变了"，而不会报错：
 *
 * 1. 区间合法（`0 <= start < end <= text.length`、有序、不重叠）；
 * 2. 改样式**只影响被选中的那一段**，区间外逐字节不变；
 * 3. 切换是幂等的（再点一次回到原值）；
 * 4. **输出里没有标记字符**——`text` 里不出现 `**` / `{@` / `](`（除了用户正文本来就有）。
 *
 * 断言里不写中文：`cjkRatchet` 的 tests 口径按文件卡中文 `*ByText`，新文件基线为 0。
 */
import { describe, expect, it } from "vitest";
import {
  applyRunPatch,
  clearRunStyles,
  normalizeRuns,
  renderRichValue,
  replaceRichText,
  richSegments,
  setLinkRuns,
  toggleBoldRuns,
  toggleColorRuns,
  toggleSizeRuns,
  type RichValue,
} from "./richRuns";

const plain = (text: string): RichValue => ({ text, runs: [] });

/** 一次样式改动**不得**让文本里长出任何标记字符。 */
function expectNoMarkers(text: string) {
  expect(text).not.toContain("**");
  expect(text).not.toContain("{@");
  expect(text).not.toContain("](");
}

describe("normalizeRuns", () => {
  it("merges adjacent runs with the same style and drops empty/unstyled ones", () => {
    expect(
      normalizeRuns(
        [
          { start: 0, end: 2, bold: true },
          { start: 2, end: 4, bold: true },
          { start: 4, end: 6 },
          { start: 6, end: 6, color: "#c00" },
        ],
        6,
      ),
    ).toEqual([{ start: 0, end: 4, bold: true }]);
  });

  it("clamps out-of-range data instead of throwing", () => {
    expect(normalizeRuns([{ start: -3, end: 99, size: 1.2 }], 5)).toEqual([
      { start: 0, end: 5, size: 1.2 },
    ]);
  });

  it("sorts by start and drops a piece that overlaps the previous one", () => {
    expect(
      normalizeRuns(
        [
          { start: 3, end: 6, color: "#C0392B" },
          { start: 0, end: 4, bold: true },
        ],
        6,
      ),
    ).toEqual([{ start: 0, end: 4, bold: true }]);
  });
});

describe("toggle / clear", () => {
  it("bolds only the selected range, twice returns to the original value", () => {
    const value = plain("Alex Chen");
    const bolded = toggleBoldRuns(value, { start: 0, end: 4 });
    expect(bolded.text).toBe("Alex Chen");
    expect(bolded.runs).toEqual([{ start: 0, end: 4, bold: true }]);
    expectNoMarkers(bolded.text);
    expect(toggleBoldRuns(bolded, { start: 0, end: 4 }).runs).toEqual([]);
  });

  it("keeps runs outside the selection byte-for-byte", () => {
    const value: RichValue = {
      text: "Alex Chen",
      runs: [{ start: 5, end: 9, color: "#2f6fd0" }],
    };
    expect(toggleBoldRuns(value, { start: 0, end: 4 }).runs).toEqual([
      { start: 0, end: 4, bold: true },
      { start: 5, end: 9, color: "#2f6fd0" },
    ]);
  });

  it("same size twice clears it; a different size replaces it", () => {
    const value = plain("Alex");
    const small = toggleSizeRuns(value, { start: 0, end: 4 }, 0.9);
    expect(small.runs).toEqual([{ start: 0, end: 4, size: 0.9 }]);
    expect(toggleSizeRuns(small, { start: 0, end: 4 }, 1.1).runs).toEqual([
      { start: 0, end: 4, size: 1.1 },
    ]);
    expect(toggleSizeRuns(small, { start: 0, end: 4 }, 0.9).runs).toEqual([]);
  });

  it("color is lowercased and toggles like size", () => {
    const value = plain("Alex");
    const red = toggleColorRuns(value, { start: 0, end: 4 }, "#C0392B");
    expect(red.runs).toEqual([{ start: 0, end: 4, color: "#c0392b" }]);
    expect(toggleColorRuns(red, { start: 0, end: 4 }, "#c0392b").runs).toEqual([]);
  });

  it("clearRunStyles drops bold/size/color but keeps the link", () => {
    const value: RichValue = {
      text: "Alex",
      runs: [{ start: 0, end: 4, bold: true, size: 1.1, link: "https://example.com" }],
    };
    expect(clearRunStyles(value, { start: 0, end: 4 }).runs).toEqual([
      { start: 0, end: 4, link: "https://example.com" },
    ]);
  });

  it("an empty selection never invents a style", () => {
    const value = plain("Alex");
    expect(applyRunPatch(value, { start: 2, end: 2 }, { bold: true })).toBe(value);
  });

  it("splits a covered run into three pieces", () => {
    const value: RichValue = { text: "abcdef", runs: [{ start: 0, end: 6, size: 1.2 }] };
    expect(applyRunPatch(value, { start: 2, end: 4 }, { size: null }).runs).toEqual([
      { start: 0, end: 2, size: 1.2 },
      { start: 4, end: 6, size: 1.2 },
    ]);
  });
});

describe("setLinkRuns", () => {
  it("links the selected text without touching its characters", () => {
    const value = setLinkRuns(plain("Alex Chen"), { start: 0, end: 4 }, "https://a.example");
    expect(value.text).toBe("Alex Chen");
    expect(value.runs).toEqual([{ start: 0, end: 4, link: "https://a.example" }]);
  });

  it("inserts the url itself when the selection is collapsed", () => {
    const value = setLinkRuns(plain("Alex "), { start: 5, end: 5 }, "https://a.example");
    expect(value.text).toBe("Alex https://a.example");
    expect(value.runs).toEqual([{ start: 5, end: 22, link: "https://a.example" }]);
  });
});

describe("replaceRichText (typing)", () => {
  it("shifts a run when text is inserted before it", () => {
    const value: RichValue = { text: "Alex", runs: [{ start: 0, end: 4, bold: true }] };
    expect(replaceRichText(value, "Hi Alex")).toEqual({
      text: "Hi Alex",
      runs: [{ start: 3, end: 7, bold: true }],
    });
  });

  it("keeps a run when text is appended after it", () => {
    const value: RichValue = { text: "Alex", runs: [{ start: 0, end: 4, bold: true }] };
    expect(replaceRichText(value, "Alex Chen").runs).toEqual([{ start: 0, end: 4, bold: true }]);
  });

  it("drops a run whose characters were deleted", () => {
    const value: RichValue = { text: "Alex", runs: [{ start: 0, end: 4, bold: true }] };
    expect(replaceRichText(value, "").runs).toEqual([]);
  });

  it("shrinks a run when part of it is deleted", () => {
    const value: RichValue = { text: "Alex", runs: [{ start: 0, end: 4, bold: true }] };
    expect(replaceRichText(value, "Al").runs).toEqual([{ start: 0, end: 2, bold: true }]);
  });

  it("returns the same object when nothing changed", () => {
    const value = plain("Alex");
    expect(replaceRichText(value, "Alex")).toBe(value);
  });
});

describe("rendering", () => {
  it("segments always cover the whole text", () => {
    const value: RichValue = {
      text: "Alex Chen",
      runs: [
        { start: 0, end: 4, bold: true },
        { start: 5, end: 9, size: 1.1, color: "#c0392b" },
      ],
    };
    expect(
      richSegments(value)
        .map((segment) => segment.text)
        .join(""),
    ).toBe("Alex Chen");
  });

  it("renders strong/span nodes without any marker characters", () => {
    const value: RichValue = {
      text: "Alex",
      runs: [{ start: 0, end: 2, bold: true }],
    };
    const fragment = renderRichValue(document, value);
    const host = document.createElement("div");
    host.appendChild(fragment);
    expect(host.textContent).toBe("Alex");
    expect(host.querySelector("strong")?.textContent).toBe("Al");
    expectNoMarkers(host.innerHTML);
  });
});
