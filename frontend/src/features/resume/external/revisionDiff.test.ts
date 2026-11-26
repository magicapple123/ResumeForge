// SPDX-License-Identifier: Apache-2.0
/**
 * 行级对比的纯函数（T12）：对齐、增删计数、超长降级。
 *
 * 只测纯函数：像素与版式由截图守（`shots/T12/`），这里守的是"哪一行算改了"。
 */
import { describe, expect, it } from "vitest";
import {
  diffSummary,
  isDiffable,
  lineDiff,
  MAX_DIFF_LINES,
  splitLines,
} from "./revisionDiff";

describe("splitLines", () => {
  it("归一化 CRLF，并丢掉文末的空行", () => {
    expect(splitLines("a\r\nb\r\n\r\n\r\n")).toEqual(["a", "b"]);
  });

  it("中间的空行保留（段落之间那一个空行是内容的一部分）", () => {
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
  });

  it("去尾空白但保留行首空白：缩进在正文里意味着层级", () => {
    expect(splitLines("  缩进  ")).toEqual(["  缩进"]);
  });
});

describe("lineDiff", () => {
  it("完全一致时全是 same，且两侧行号一一对应", () => {
    const rows = lineDiff("a\nb", "a\nb");
    expect(rows.map((row) => row.kind)).toEqual(["same", "same"]);
    expect(rows.map((row) => [row.leftLine, row.rightLine])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it("改了一行 = 一条 removed + 一条 added，且删除排在新增之前", () => {
    const rows = lineDiff("a\nold\nc", "a\nnew\nc");
    expect(rows.map((row) => row.kind)).toEqual(["same", "removed", "added", "same"]);
    expect(rows[1].left).toBe("old");
    expect(rows[1].right).toBeNull();
    expect(rows[2].left).toBeNull();
    expect(rows[2].right).toBe("new");
  });

  it("旧版多出来的行记为 removed、新版多出来的行记为 added", () => {
    const summary = diffSummary(lineDiff("a\nb\nc", "a"));
    expect(summary).toEqual({ added: 0, removed: 2, same: 1 });
    const grown = diffSummary(lineDiff("a", "a\nb\nc"));
    expect(grown).toEqual({ added: 2, removed: 0, same: 1 });
  });

  it("交错增删也能对齐（LCS 不追求最少编辑距离，但要保住公共行）", () => {
    const rows = lineDiff("a\nb\nc\nd", "a\nc\nx\nd");
    expect(diffSummary(rows)).toEqual({ added: 1, removed: 1, same: 3 });
    // 公共行必须仍然对齐：`c` 的左右行号都是 2/2，`d` 是 4/4。
    const same = rows.filter((row) => row.kind === "same");
    expect(same.map((row) => [row.leftLine, row.rightLine])).toEqual([
      [1, 1],
      [3, 2],
      [4, 4],
    ]);
  });

  it("空正文与有正文：全部记为 added（不抛错、不返回半张表）", () => {
    expect(diffSummary(lineDiff("", "a\nb"))).toEqual({ added: 2, removed: 0, same: 0 });
    expect(diffSummary(lineDiff("", ""))).toEqual({ added: 0, removed: 0, same: 0 });
  });
});

describe("isDiffable", () => {
  it("两侧都在上限内才算（上限是行数，不是字数）", () => {
    const long = new Array(MAX_DIFF_LINES).fill("x").join("\n");
    expect(isDiffable(long, long)).toBe(true);
    const tooLong = new Array(MAX_DIFF_LINES + 1).fill("x").join("\n");
    expect(isDiffable(tooLong, "x")).toBe(false);
    expect(isDiffable("x", tooLong)).toBe(false);
  });
});
