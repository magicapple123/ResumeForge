// SPDX-License-Identifier: Apache-2.0
/** 字符级标记编辑规则（协议 v2）：成对、不吞输入、链接只认 http(s)。 */
import { describe, expect, it } from "vitest";
import {
  insertLinkMark,
  isValidLinkUrl,
  linkMarkAround,
  toggleBoldMark,
  toggleItalicMark,
} from "./inlineMarks";

describe("inlineMarks · 斜体", () => {
  it("包住选区后再点一次取消", () => {
    const first = toggleItalicMark("abcdef", { start: 2, end: 4 });
    expect(first).toEqual({ text: "ab*cd*ef", start: 3, end: 5 });
    const second = toggleItalicMark(first.text, first);
    expect(second.text).toBe("abcdef");
  });

  it("空选区插入一对并把光标放中间", () => {
    expect(toggleItalicMark("ab", { start: 1, end: 1 })).toEqual({
      text: "a**b",
      start: 2,
      end: 2,
    });
  });

  it("选中加粗内容时斜体不拆加粗", () => {
    expect(toggleItalicMark("**ab**", { start: 2, end: 4 }).text).toBe("**ab**");
  });

  it("不拆既有加粗（先切 ** 再切 *）", () => {
    const text = "a**bc**d";
    const edit = toggleItalicMark(text, { start: 4, end: 4 });
    // 光标在加粗内容里：本次不做任何修改（不静默把加粗拆坏）
    expect(edit.text).toBe(text);
  });
});

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
