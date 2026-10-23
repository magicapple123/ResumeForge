// SPDX-License-Identifier: Apache-2.0
/**
 * 字符级加粗标记（`**`）的解析：**与后端 `test_resume_rich_text.py` 同一份用例**。
 *
 * 这一层的错误不是"报错"，而是**静默的产物损坏**：多出一对星号、一段本不该加粗的文字被
 * 加粗、或者加粗之后可见文本少了两个字符。所以这里除了跑共享用例（`richText.cases.json`，
 * 后端 QA 可以逐条对照），还单独钉住三处最容易写错的换算法：
 *
 * 1. `renderIndexToSource` 的**长度必须等于可见字符数**——长一位就会把标记算进选区；
 * 2. 未闭合的 `**` 是**字面**（占 2 个可见字符），不能被吞掉；
 * 3. `****`（成对但中间为空）的可见文本是空串，且不产出空 run。
 *
 * 断言里不出现中文：`cjkRatchet` 的 tests 口径按文件卡中文 `*ByText`，新文件基线为 0。
 */
import { describe, expect, it } from "vitest";
import rawCases from "./richText.cases.json";
import {
  isBoldVisible,
  parseRuns,
  parseSpans,
  paintRichField,
  renderIndexToSource,
  renderRichFragment,
  stripMarkers,
  toggleBold,
  visibleLength,
} from "./richText";

interface SharedCase {
  raw: string;
  start: number;
  end: number;
  next: string;
}

const cases = rawCases as SharedCase[];

describe("加粗标记 · 与后端共享的 toggle 用例", () => {
  it.each(cases.map((item) => [item.raw, item.start, item.end, item.next]))(
    "toggle(%s, %i, %i) → %s",
    (raw, start, end, next) => {
      expect(toggleBold(raw, start, end).next).toBe(next);
    },
  );

  it("共享用例本身覆盖了空串 / 空选区 / 越界（防止用例集被悄悄改空）", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(cases.some((item) => item.raw === "")).toBe(true);
    expect(cases.some((item) => item.start === item.end)).toBe(true);
    expect(cases.some((item) => item.start < 0 || item.end > item.raw.length)).toBe(true);
  });

  it("可见文本不变（成功加粗的唯一判据）", () => {
    for (const item of cases) {
      const { next } = toggleBold(item.raw, item.start, item.end);
      expect(stripMarkers(next)).toBe(stripMarkers(item.raw));
    }
  });

  it("再点一次回到原文（同一段选区）", () => {
    const once = toggleBold("abcdef", 1, 3);
    expect(once.next).toBe("a**bc**def");
    const twice = toggleBold(once.next, once.range[0], once.range[1]);
    expect(twice.next).toBe("abcdef");
  });
});

describe("加粗标记 · renderIndexToSource 的边界", () => {
  it("长度恒等于可见字符数", () => {
    for (const item of cases) {
      expect(renderIndexToSource(item.raw)).toHaveLength(visibleLength(item.raw));
    }
  });

  it("跳过成对标记，落单标记占两个可见字符", () => {
    expect(renderIndexToSource("**ab**")).toEqual([2, 3]);
    expect(renderIndexToSource("a**b")).toEqual([0, 1, 2, 3]);
    expect(renderIndexToSource("**只有开头")).toEqual([0, 1, 2, 3, 4, 5]);
    expect(renderIndexToSource("****")).toEqual([]);
    expect(renderIndexToSource("")).toEqual([]);
  });

  it("首尾标记与多段标记都只映射可见字符", () => {
    expect(renderIndexToSource("**a**b**c**")).toEqual([2, 5, 8]);
    expect(visibleLength("**a**b**c**")).toBe(3);
  });
});

describe("加粗标记 · 切分与剥离", () => {
  it("parseRuns 与后端逐项一致", () => {
    expect(parseRuns("")).toEqual([]);
    expect(parseRuns("**加粗**")).toEqual([{ text: "加粗", bold: true }]);
    expect(parseRuns("前**中**后")).toEqual([
      { text: "前", bold: false },
      { text: "中", bold: true },
      { text: "后", bold: false },
    ]);
    // 相邻空对不会把两段加粗粘在一起（区间仍是两段）。
    expect(parseSpans("**a****b**")).toEqual([
      { start: 2, end: 3, bold: true },
      { start: 7, end: 8, bold: true },
    ]);
  });

  it("stripMarkers 幂等，且落单星号原样保留", () => {
    for (const text of ["", "无标记", "**加粗**", "a**b**c**", "****", "a**b"]) {
      const once = stripMarkers(text);
      expect(stripMarkers(once)).toBe(once);
    }
    expect(stripMarkers("a**b")).toBe("a**b");
    expect(stripMarkers("**一**二**三**")).toBe("一二三");
  });

  it("isBoldVisible 按可见区间判断（跨粗体与普通文字时不是全粗）", () => {
    expect(isBoldVisible("**abc**def", 0, 3)).toBe(true);
    expect(isBoldVisible("**abc**def", 0, 4)).toBe(false);
    expect(isBoldVisible("abcdef", 2, 2)).toBe(false);
  });
});

describe("加粗标记 · 渲染成 DOM", () => {
  it("只输出文本与 strong，绝不输出标记字面量", () => {
    const fragment = renderRichFragment(document, "前**中**后");
    expect(fragment.textContent).toBe("前中后");
    expect(fragment.querySelectorAll("strong")).toHaveLength(1);
    expect(fragment.textContent).not.toContain("**");
  });

  it("落单的星号作为普通文字出现在文本节点里", () => {
    const fragment = renderRichFragment(document, "a**b");
    expect(fragment.textContent).toBe("a**b");
    expect(fragment.querySelectorAll("strong")).toHaveLength(0);
  });

  it("paintRichField 就地替换元素内容，脱离文档的元素安全跳过", () => {
    const host = document.createElement("p");
    host.textContent = "前中后";
    document.body.appendChild(host);
    paintRichField(host, "前**中**后");
    expect(host.innerHTML).toBe("前<strong>中</strong>后");

    const detached = document.createElement("p");
    expect(() => paintRichField(detached, "**x**")).not.toThrow();
    expect(detached.innerHTML).toBe("");
    expect(() => paintRichField(null, "**x**")).not.toThrow();
  });
});
