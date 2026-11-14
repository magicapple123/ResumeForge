// SPDX-License-Identifier: Apache-2.0
/** 字符级标记编辑规则（协议 v2）：成对、不吞输入、链接只认 http(s)。
 *  F22 起补：任意字号/颜色、同属性替换（不嵌套）、清除格式、颜色规范化。 */
import { describe, expect, it } from "vitest";
import {
  applyStyleMark,
  clearInlineMarks,
  clampInlineSize,
  inlineColorValue,
  insertLinkMark,
  isValidLinkUrl,
  linkMarkAround,
  MAX_INLINE_SIZE,
  MIN_INLINE_SIZE,
  normalizeInlineColor,
  toggleBoldMark,
  toggleEmphasisMark,
  toggleSmallMark,
} from "./inlineMarks";

// #5d：斜体写入入口（toggleItalicMark）已移除；单星号的"去标记"行为
// 由后端 resume_rich_text 的解析侧测试钉住（剥标记、不倾斜）。

describe("inlineMarks · 加粗", () => {
  it("包住与取消成对", () => {
    const edit = toggleBoldMark("abc", { start: 0, end: 3 });
    expect(edit.text).toBe("**abc**");
    expect(toggleBoldMark(edit.text, edit).text).toBe("abc");
  });
});

describe("inlineMarks · 链接", () => {
  it("只接受 http(s)、无空白、长度受限", () => {
    expect(isValidLinkUrl("https://example.com/a")).toBe(true);
    expect(isValidLinkUrl("http://example.com")).toBe(true);
    expect(isValidLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isValidLinkUrl("ftp://example.com")).toBe(false);
    expect(isValidLinkUrl("https://exa mple.com")).toBe(false);
    expect(isValidLinkUrl("https://example.com/" + "a".repeat(600))).toBe(false);
  });

  it("把选区变成链接；不合法 URL 不写内容", () => {
    const edit = insertLinkMark("看这里", { start: 0, end: 3 }, "https://example.com");
    expect(edit).toEqual({
      text: "[看这里](https://example.com)",
      start: 0,
      end: "[看这里](https://example.com)".length,
    });
    expect(insertLinkMark("abc", { start: 0, end: 1 }, "javascript:alert(1)")).toBeNull();
  });

  it("空选区用 URL 作 label", () => {
    const edit = insertLinkMark("ab", { start: 1, end: 1 }, "https://x.dev");
    expect(edit?.text).toBe("a[https://x.dev](https://x.dev)b");
  });

  it("点进已有链接时能取回 label 与 url", () => {
    const text = "前[官网](https://x.dev)后";
    const around = linkMarkAround(text, { start: 4, end: 4 });
    expect(around).not.toBeNull();
    expect(around?.url).toBe("https://x.dev");
    expect(around?.label).toBe("官网");
    expect(text.slice(around!.range.start, around!.range.end)).toBe("[官网](https://x.dev)");
  });

  it("没有链接 / 非法链接返回 null", () => {
    expect(linkMarkAround("plain text", { start: 2, end: 3 })).toBeNull();
    expect(linkMarkAround("[a](javascript:1)", { start: 1, end: 1 })).toBeNull();
  });
});

describe("inlineMarks · 字号与颜色", () => {
  it("写入 / 再点一次去掉（常用档走同一份规则）", () => {
    const small = toggleSmallMark("带 8 人团队", { start: 2, end: 5 });
    expect(small.text).toBe("带 {@size=0.9}8 人{@}团队");
    expect(small.text.slice(small.start, small.end)).toBe("8 人");
    const removed = toggleSmallMark(small.text, { start: small.start, end: small.end });
    expect(removed.text).toBe("带 8 人团队");
    expect(removed.text.slice(removed.start, removed.end)).toBe("8 人");

    const accent = toggleEmphasisMark("重点", { start: 0, end: 2 });
    expect(accent.text).toBe("{@color=#c0392b}重点{@}");
  });

  it("F22：任意字号与任意颜色都按数值写进标记", () => {
    expect(applyStyleMark("abc", { start: 0, end: 3 }, { size: 1.25 }).text).toBe(
      "{@size=1.25}abc{@}",
    );
    expect(applyStyleMark("abc", { start: 0, end: 3 }, { color: "#2f6fd0" }).text).toBe(
      "{@color=#2f6fd0}abc{@}",
    );
    expect(applyStyleMark("abc", { start: 0, end: 3 }, { size: 1.1, color: "#2f6fd0" }).text).toBe(
      "{@size=1.1,color=#2f6fd0}abc{@}",
    );
  });

  it("同属性不嵌套：在已有区间里换字号 = 改开标记，颜色保留", () => {
    const inner = "带 8 人团队";
    const small = toggleSmallMark(inner, { start: 2, end: 5 });
    const bigger = applyStyleMark(
      small.text,
      { start: small.start, end: small.end },
      { size: 1.25 },
    );
    expect(bigger.text).toBe("带 {@size=1.25}8 人{@}团队");
    const colored = applyStyleMark(
      bigger.text,
      { start: bigger.start, end: bigger.end },
      {
        color: "#2f6fd0",
      },
    );
    expect(colored.text).toBe("带 {@size=1.25,color=#2f6fd0}8 人{@}团队");
    // 同一个值再点一次 = 去掉这一项，另一个属性留下
    const clearedSize = applyStyleMark(
      colored.text,
      { start: colored.start, end: colored.end },
      {
        size: 1.25,
      },
    );
    expect(clearedSize.text).toBe("带 {@color=#2f6fd0}8 人{@}团队");
    const clearedColor = applyStyleMark(
      clearedSize.text,
      { start: clearedSize.start, end: clearedSize.end },
      { color: null },
    );
    expect(clearedColor.text).toBe("带 8 人团队");
  });

  it("选区正好是一个完整区间：整体拆掉（连标记一起选中也能取消）", () => {
    const text = "带 {@size=0.9}8 人{@}团队";
    const unwrapped = applyStyleMark(text, { start: 2, end: text.length - 2 }, { size: 0.9 });
    expect(unwrapped.text).toBe("带 8 人团队");
    expect(unwrapped.text.slice(unwrapped.start, unwrapped.end)).toBe("8 人");
  });

  it("越界字号夹在 0.5–1.6（后端按字面保留，前端必须先夹）", () => {
    expect(clampInlineSize(3)).toBe(MAX_INLINE_SIZE);
    expect(clampInlineSize(0.1)).toBe(MIN_INLINE_SIZE);
    expect(clampInlineSize(Number.NaN)).toBe(1);
    expect(applyStyleMark("abc", { start: 0, end: 3 }, { size: 3 }).text).toBe("{@size=1.6}abc{@}");
  });

  it("空选区 / 两个属性都清空时不产生标记", () => {
    expect(applyStyleMark("abc", { start: 1, end: 1 }, { size: 1.2 }).text).toBe("abc");
    expect(applyStyleMark("abc", { start: 0, end: 3 }, { size: null, color: null }).text).toBe(
      "abc",
    );
  });

  it("颜色只认 hex：rgba / 三字母 / 大小写都要规范化后写回", () => {
    expect(normalizeInlineColor("#C0392B")).toBe("#c0392b");
    expect(normalizeInlineColor("#c00")).toBe("#cc0000");
    expect(normalizeInlineColor("rgba(192, 57, 43, 0.5)")).toBeNull();
    // ColorPicker 的取值一律先 toHexString()，再走同一个规范化
    expect(inlineColorValue({ toHexString: () => "#2F6FD0" })).toBe("#2f6fd0");
    expect(inlineColorValue({ toHexString: () => "rgba(1,2,3,0.4)" })).toBeNull();
  });
});

describe("inlineMarks · 清除行内格式", () => {
  it("成对样式标记与成对加粗都清掉，链接与可见文字保留", () => {
    const text = "{@size=0.9}**重点**{@} [官网](https://x.dev)";
    const cleared = clearInlineMarks(text, { start: 0, end: text.length });
    expect(cleared.text).toBe("重点 [官网](https://x.dev)");
    expect(cleared.text.slice(cleared.start, cleared.end)).toBe("重点 [官网](https://x.dev)");
  });

  it("落单的 { 与 ** 原样保留（那是用户真想印出来的字符）", () => {
    expect(clearInlineMarks("a{@size=0.9}b", { start: 0, end: 12 }).text).toBe("a{@size=0.9}b");
    expect(clearInlineMarks("a**b", { start: 0, end: 4 }).text).toBe("a**b");
  });
});
