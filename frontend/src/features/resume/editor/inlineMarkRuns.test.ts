// SPDX-License-Identifier: Apache-2.0
/**
 * 行内标记的渲染态解析：**与后端同一份 fixture 双向校验**。
 *
 * `backend/tests/fixtures/inline_marks_cases.json` 的期望值由后端解析器
 * （`resume_rich_text_parse.parse_rich_runs`）生成，后端 `test_inline_marks_fixture.py`
 * 与这里读同一个文件。任何一侧改了配对规则，另一侧立刻红——这是"前端复刻解析器"
 * 这条风险的唯一约束手段。
 *
 * 除共享用例外还单独钉住四条性质（共享用例覆盖不到、但错了两侧都不会报错）：
 *
 * 1. **可见文本 = 各 run 的 text 拼接**：遮罩层的排版长度完全依赖它；
 * 2. **分段覆盖整串**（`segments` 拼回去必须等于源串）：少一个字符，两层就从那里开始错位；
 * 3. 幂等（解析两次结果相同）与空串边界；
 * 4. 属性解析与 URL 白名单的合法/非法矩阵（越界字号、非法 scheme 必须**不**生效）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sharedCases from "./inlineMarks.cases.json";
import type { InlineMarkRun } from "./inlineMarkRuns";
import {
  hasInlineMarks,
  isValidInlineLinkUrl,
  parseInlineMarkRuns,
  parseInlineMarkSegments,
  parseInlineStyleAttributes,
  stripInlineMarks,
  visibleInlineMarkLength,
} from "./inlineMarkRuns";

declare const process: { cwd(): string };

interface FixtureRun {
  text: string;
  bold?: boolean;
  size?: number;
  color?: string;
  href?: string;
}

interface FixtureCase {
  raw: string;
  visible: string;
  runs: FixtureRun[];
}

interface Fixture {
  note: string;
  cases: FixtureCase[];
}

const FIXTURE_PATH = [
  process.cwd(),
  "..",
  "backend",
  "tests",
  "fixtures",
  "inline_marks_cases.json",
].join("/");

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const cases = fixture.cases;

/** 两侧的 run 都归一成"字段全在"的形状，避免 `undefined` 与缺字段互相比较时误判。 */
function normalize(run: FixtureRun): Required<FixtureRun> {
  return {
    text: run.text,
    bold: Boolean(run.bold),
    size: run.size ?? 0,
    color: run.color ?? "",
    href: run.href ?? "",
  };
}

describe("行内标记 · 与后端共享的 fixture", () => {
  it("fixture 本身有内容且覆盖了各类标记（防止用例集被悄悄改空）", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.some((item) => item.raw === "")).toBe(true);
    expect(cases.some((item) => item.runs.some((run) => run.bold))).toBe(true);
    expect(cases.some((item) => item.runs.some((run) => run.size))).toBe(true);
    expect(cases.some((item) => item.runs.some((run) => run.color))).toBe(true);
    expect(cases.some((item) => item.runs.some((run) => run.href))).toBe(true);
    // 退化路径必须在用例里：未闭合 / 非法属性 / 非法 scheme 一律按字面保留。
    expect(cases.some((item) => item.runs.some((run) => run.text.includes("{@size=1.1}")))).toBe(
      true,
    );
    expect(cases.some((item) => item.runs.some((run) => run.text.includes("javascript:")))).toBe(
      true,
    );
  });

  it.each(cases.map((item) => [item.raw, item] as const))(
    "解析 %s 与后端逐项一致",
    (_raw, item) => {
      const actual = parseInlineMarkRuns(item.raw).map(normalize);
      expect(actual).toEqual(item.runs.map(normalize));
    },
  );

  it.each(cases.map((item) => [item.raw, item] as const))(
    "可见文本（%s）与后端一致",
    (_raw, item) => {
      const runs = parseInlineMarkRuns(item.raw);
      expect(runs.map((run) => run.text).join("")).toBe(item.visible);
      expect(stripInlineMarks(item.raw)).toBe(item.visible);
      expect(visibleInlineMarkLength(item.raw)).toBe(item.visible.length);
    },
  );

  it.each(cases.map((item) => [item.raw] as const))("分段覆盖整串（%s）", (raw) => {
    const segments = parseInlineMarkSegments(raw);
    expect(segments.map((segment) => segment.text).join("")).toBe(raw);
    expect(
      segments
        .filter((segment) => !segment.hidden)
        .map((segment) => segment.text)
        .join(""),
    ).toBe(stripInlineMarks(raw));
  });

  it.each(cases.map((item) => [item.raw] as const))("解析幂等（%s）", (raw) => {
    expect(parseInlineMarkRuns(raw)).toEqual(parseInlineMarkRuns(raw));
    expect(parseInlineMarkSegments(raw)).toEqual(parseInlineMarkSegments(raw));
  });
});

describe("行内标记 · 局部性质", () => {
  it("空串与纯文本不产生任何 run", () => {
    expect(parseInlineMarkRuns("")).toEqual([]);
    expect(parseInlineMarkSegments("")).toEqual([]);
    expect(parseInlineMarkRuns("plain text")).toEqual([{ text: "plain text", bold: false }]);
  });

  it("hasInlineMarks 是遮罩层的开关：普通值不渲染第二层", () => {
    expect(hasInlineMarks("plain text")).toBe(false);
    expect(hasInlineMarks("a**b**c")).toBe(true);
    expect(hasInlineMarks("{@size=0.9}a{@}")).toBe(true);
    expect(hasInlineMarks("[a](https://example.com)")).toBe(true);
  });

  it("字号在合法区间内生效，越界/非数字整份作废", () => {
    expect(parseInlineStyleAttributes("size=0.5")).toEqual({ size: 0.5 });
    expect(parseInlineStyleAttributes("size=1.6")).toEqual({ size: 1.6 });
    expect(parseInlineStyleAttributes(" SIZE = 1.1 ")).toEqual({ size: 1.1 });
    expect(parseInlineStyleAttributes("size=0.4")).toBeNull();
    expect(parseInlineStyleAttributes("size=1.7")).toBeNull();
    expect(parseInlineStyleAttributes("size=big")).toBeNull();
    expect(parseInlineStyleAttributes("weight=bold")).toBeNull();
    expect(parseInlineStyleAttributes("")).toBeNull();
    // 一项非法即整份作废：不能"颜色生效、字号忽略"。
    expect(parseInlineStyleAttributes("size=1.1,oops=1")).toBeNull();
  });

  it("颜色只认 #rgb / #rrggbb，并统一成小写", () => {
    expect(parseInlineStyleAttributes("color=#ABC")).toEqual({ size: undefined, color: "#abc" });
    expect(parseInlineStyleAttributes("color=#2f6fd0")).toEqual({
      size: undefined,
      color: "#2f6fd0",
    });
    expect(parseInlineStyleAttributes("color=#12345")).toBeNull();
    expect(parseInlineStyleAttributes("color=red")).toBeNull();
  });

  it("URL 白名单只有 http/https/mailto，其余一律不认", () => {
    expect(isValidInlineLinkUrl("https://example.com")).toBe(true);
    expect(isValidInlineLinkUrl("http://example.com/a?b=1")).toBe(true);
    expect(isValidInlineLinkUrl("mailto:someone@example.com")).toBe(true);
    expect(isValidInlineLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isValidInlineLinkUrl("data:text/html,x")).toBe(false);
    expect(isValidInlineLinkUrl("/relative")).toBe(false);
    expect(isValidInlineLinkUrl("https://example.com/a b")).toBe(false);
    expect(isValidInlineLinkUrl(`https://example.com/${"a".repeat(600)}`)).toBe(false);
  });

  it("未闭合的样式标记一个字都不藏", () => {
    const raw = "{@size=0.9}abc";
    expect(parseInlineMarkRuns(raw)).toEqual([{ text: raw, bold: false }]);
    expect(parseInlineMarkSegments(raw).some((segment) => segment.hidden)).toBe(false);
  });

  it("样式区间的栈是区间局部的：包在加粗外层不生效（与后端一致）", () => {
    // 后端 `split_masked` 从 run 起点重新压栈，所以外层的 size 到不了加粗内层的文字上。
    const raw = "{@size=1.5}**{@color=#2f6fd0}x{@}**{@}";
    expect(parseInlineMarkRuns(raw)).toEqual([{ text: "x", bold: true, color: "#2f6fd0" }]);
  });

  it("隐藏段保留标记原文，供遮罩层按同宽字形占位", () => {
    const segments = parseInlineMarkSegments("a**b**c");
    expect(segments.filter((segment) => segment.hidden).map((segment) => segment.text)).toEqual([
      "**",
      "**",
    ]);
    expect(
      segments.filter((segment) => segment.hidden).every((segment) => segment.bold === undefined),
    ).toBe(true);
  });

  it("可见段与隐藏段交替出现，顺序与源串一致", () => {
    const segments = parseInlineMarkSegments("ab{@color=#c0392b}cd{@}");
    // 可见段只有两条：`ab`（无样式）与 `cd`（红）。标记段各自夹在中间并隐藏。
    expect(segments.map((segment) => [segment.text, Boolean(segment.hidden)])).toEqual([
      ["ab", false],
      ["{@color=#c0392b}", true],
      ["cd", false],
      ["{@}", true],
    ]);
    const runs: InlineMarkRun[] = parseInlineMarkRuns("ab{@color=#c0392b}cd{@}");
    expect(runs.map((run) => run.text).join("")).toBe("abcd");
  });
});

interface StripCase {
  raw: string;
  visible: string;
  style_visible: string;
}

const stripCases = (sharedCases as { cases: StripCase[] }).cases;

describe("DF-6 · 剥离与后端共享用例（inlineMarks.cases.json）", () => {
  it("用例集覆盖退化路径：未闭合 / 越界 / 落单收口 / 嵌套", () => {
    expect(stripCases.length).toBeGreaterThanOrEqual(12);
    expect(stripCases.some((item) => item.raw === "")).toBe(true);
    expect(stripCases.some((item) => item.raw === "{@size=0.9}未闭合")).toBe(true);
    expect(stripCases.some((item) => item.raw.startsWith("{@size=9}"))).toBe(true);
    expect(stripCases.some((item) => item.raw === "x{@}y")).toBe(true);
    expect(stripCases.some((item) => item.raw.includes("**"))).toBe(true);
  });

  it.each(stripCases.map((item) => [item.raw, item] as const))(
    "剥离 %s 只剪掉认出来的标记",
    (_raw, item) => {
      expect(stripInlineMarks(item.raw)).toBe(item.visible);
    },
  );

  it("`style_visible` 由后端 strip_style_markers 断言（这里只钉住它存在且更长或相等）", () => {
    // 后端口径保留 `**` 与链接语法，所以只会比"展示口径"长或相等；具体值在
    // `backend/tests/test_resume_inline_style.py` 里逐条比对同一个文件。
    for (const item of stripCases) {
      expect(item.style_visible.length).toBeGreaterThanOrEqual(item.visible.length);
    }
  });
});
