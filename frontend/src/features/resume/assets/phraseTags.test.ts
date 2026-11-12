// SPDX-License-Identifier: Apache-2.0
/** W17 岗位标签纯规则：拆分、去重、限长限量。 */
import { describe, expect, it } from "vitest";
import {
  MAX_PHRASE_TAG_LENGTH,
  MAX_PHRASE_TAGS,
  normalizePhraseTag,
  normalizePhraseTags,
  parsePhraseTagsInput,
  phraseTagsText,
} from "./phraseTags";

describe("normalizePhraseTag", () => {
  it("去首尾空白并压缩连续空白", () => {
    expect(normalizePhraseTag("  back   end  ")).toBe("back end");
    expect(normalizePhraseTag("")).toBe("");
  });
});

describe("normalizePhraseTags", () => {
  it("去空、去重（大小写不敏感）、保持输入顺序", () => {
    const result = normalizePhraseTags([" 后端 ", "数据", "backend", "", "Backend"]);
    expect(result.tags).toEqual(["后端", "数据", "backend"]);
    expect(result.truncated).toBe(false);
    expect(result.ignored).toBe(0);
  });

  it("超长标签被忽略并计数（不静默截断成另一个词）", () => {
    const tooLong = "x".repeat(MAX_PHRASE_TAG_LENGTH + 1);
    const result = normalizePhraseTags([tooLong, "ok"]);
    expect(result.tags).toEqual(["ok"]);
    expect(result.ignored).toBe(1);
  });

  it("超过上限的标签被截断并标记 truncated", () => {
    const raw = Array.from({ length: MAX_PHRASE_TAGS + 2 }, (_item, index) => "tag" + index);
    const result = normalizePhraseTags(raw);
    expect(result.tags).toHaveLength(MAX_PHRASE_TAGS);
    expect(result.truncated).toBe(true);
  });
});

describe("parsePhraseTagsInput / phraseTagsText", () => {
  it("逗号/顿号/换行都算分隔符", () => {
    expect(parsePhraseTagsInput("后端, 数据、SRE\n平台").tags).toEqual([
      "后端",
      "数据",
      "SRE",
      "平台",
    ]);
  });

  it("数组回显成可继续编辑的文本", () => {
    expect(phraseTagsText(["后端", "数据"])).toBe("后端, 数据");
  });
});
