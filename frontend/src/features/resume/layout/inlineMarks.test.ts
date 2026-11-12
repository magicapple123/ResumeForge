// SPDX-License-Identifier: Apache-2.0
/** 字符级标记编辑规则（协议 v2）：成对、不吞输入、链接只认 http(s)。 */
import { describe, expect, it } from "vitest";
import { insertLinkMark, isValidLinkUrl, linkMarkAround, toggleBoldMark } from "./inlineMarks";

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
