// SPDX-License-Identifier: Apache-2.0
/**
 * 中英一致性检查（W16）：四类规则各一条反例 + 一条"干净"用例。
 *
 * 注意：这里的 CJK 用 \u 转义写（源码里不出现中文字符），否则会撞 cjkRatchet 基线。
 */
import { describe, expect, it } from "vitest";
import { checkPair, collectHints, hintCount } from "./checks";
import type { BilingualPair } from "./types";

function pair(primary: string, secondary: string, path = "summary"): BilingualPair {
  return {
    id: path,
    sectionKey: "summary",
    groupLabel: "summary",
    path,
    label: "summary",
    primary,
    secondary,
    status: primary === secondary ? "same" : "changed",
    adoptable: true,
    locked: false,
  };
}

describe("checkPair", () => {
  it("干净的一对没有建议", () => {
    expect(checkPair(pair("Led the rewrite.", "Led the rewrite."))).toEqual([]);
  });

  it("中文里用半角标点 → punctuation", () => {
    const hints = checkPair(pair("\u5e26\u9886\u56e2\u961f, \u63d0\u5347\u6027\u80fd", "x"));
    expect(hints.map((hint) => hint.kind)).toContain("punctuation");
  });

  it("英文里用全角标点 → punctuation", () => {
    const hints = checkPair(pair("x", "Led team\uff0cimproved latency"));
    expect(hints.map((hint) => hint.kind)).toContain("punctuation");
  });

  it("中英文紧贴缺空格 → spacing", () => {
    const hints = checkPair(pair("Python\u5f00\u53d1", "Python development"));
    expect(hints.map((hint) => hint.kind)).toContain("spacing");
  });

  it("日期分隔符不一致 → date_format", () => {
    const hints = checkPair(pair("2019.03 - 2026.09", "2019-03 - 2026-09"));
    expect(hints.map((hint) => hint.kind)).toContain("date_format");
  });

  it("分隔符一致时不报 date_format", () => {
    const hints = checkPair(pair("2019.03 - 2026.09", "2019.03 - 2026.09"));
    expect(hints.map((hint) => hint.kind)).not.toContain("date_format");
  });

  it("长 URL → long_url；URL 里的半角冒号不误报标点", () => {
    const url = "https://example.com/a/very/long/path/that/keeps/going/for/a/while";
    const hints = checkPair(pair(url, url));
    expect(hints.map((hint) => hint.kind)).toEqual(["long_url"]);
  });

  it("两侧都空不报任何建议", () => {
    expect(checkPair(pair("", ""))).toEqual([]);
  });
});

describe("collectHints / hintCount", () => {
  it("多行同 kind 去重后按行顺序返回", () => {
    const pairs = [
      pair("2019.03", "2019-03", "experience.0.start_date"),
      pair("2020.01", "2020-01", "experience.1.start_date"),
      pair("Led.", "Led."),
    ];
    const hints = collectHints(pairs);
    expect(hints.map((hint) => hint.id)).toEqual([
      "date_format:experience.0.start_date",
      "date_format:experience.1.start_date",
    ]);
    expect(hintCount(hints)).toBe(2);
  });
});
