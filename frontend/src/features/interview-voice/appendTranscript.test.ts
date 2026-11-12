// SPDX-License-Identifier: Apache-2.0
/** 追加语义（T13）：转写结果接在已有文字后面，不覆盖、不黏连。 */

import { describe, expect, it } from "vitest";
import { appendTranscript } from "./appendTranscript";

describe("appendTranscript", () => {
  it("已有文字 + 转写：原文保留，转写追加在后（补换行）", () => {
    const existing = "我先说一段自己的项目经历";
    expect(appendTranscript(existing, "然后补充一下技术栈")).toBe(
      existing + "\n然后补充一下技术栈",
    );
  });

  it("单行输入用空格分隔（input 会吃掉换行，不能用换行分隔）", () => {
    expect(appendTranscript("我之前写的问题", "再补充一句", { separator: "space" })).toBe(
      "我之前写的问题 再补充一句",
    );
  });

  it("已有文字以标点结尾时直接接上，不再多插换行", () => {
    expect(appendTranscript("我做过一个推荐系统。", "主要用协同过滤")).toBe(
      "我做过一个推荐系统。主要用协同过滤",
    );
  });

  it("已有文字以空白结尾时原样拼接", () => {
    expect(appendTranscript("先说到这里\n", "接着补充")).toBe("先说到这里\n接着补充");
    expect(appendTranscript("前半句 ", "后半句")).toBe("前半句 后半句");
  });

  it("空转写不改动原文；空原文直接用转写；首尾空白被裁掉", () => {
    expect(appendTranscript("原文", "   ")).toBe("原文");
    expect(appendTranscript("", "  新的一段话  ")).toBe("新的一段话");
    expect(appendTranscript("原文", "  新的一段话  ")).toBe("原文\n新的一段话");
  });
});
