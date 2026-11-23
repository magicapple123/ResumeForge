// SPDX-License-Identifier: Apache-2.0
/**
 * 简历名不被硬截断的守卫（台账第 2 条）。
 *
 * 症状是**静默**的：CSS 里一句 `max-width: 260px` 就能把
 * 「示例科技-后端开发-2026 秋招定制版（第三轮面试专用）」砍成半截——测试全绿、
 * 界面也不报错，只有在列表里逐行看才发现名字认不出来。所以这里直接读 CSS 源码，
 * 钉住两件事：
 *
 * 1. 简历名作为元信息行**最后一项**时不再按 260px 硬切（`:last-child { max-width: none }`）；
 * 2. 允许被压缩靠 flex（`flex: 0 1 auto` + `min-width: 0`），而不是在 JS 里 `slice`
 *    ——字符串一旦被截，`title` 里也找不回来了。
 */
// @ts-expect-error Node builtin: @types/node is not installed, but vitest runs in Node.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readSrc(...segments: string[]): string {
  return readFileSync([process.cwd(), "src", ...segments].join("/"), "utf8");
}

/** Comments mention the removed behaviour; assertions must only look at real declarations. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract one selector's declaration block; throws when the rule is missing. */
function ruleBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`CSS rule not found: ${selector}`);
  return match[1];
}

const board = stripCssComments(readSrc("styles", "tracker-board.css"));
const card = readSrc("features", "tracker", "TrackCard.tsx");

describe("简历名的展示契约", () => {
  it("能压缩、也有让位上限，但不是固定宽度", () => {
    const resume = ruleBlock(board, ".track-card-resume");
    // 默认 `min-width: auto` 会把长标题顶成整行溢出；这两个属性缺一个都压不下去。
    expect(resume).toContain("flex: 0 1 auto");
    expect(resume).toContain("min-width: 0");
    expect(resume).toContain("max-width: 260px");
    // 固定宽度等于硬截断，与 max-width 的"可让位"语义完全不同。
    expect(resume).not.toMatch(/^\s*width:/m);
  });

  it("最后一项不再按 260px 硬切", () => {
    // 没有「依据」在后面抢宽度时，长简历名应该完整显示。
    expect(ruleBlock(board, ".track-card-resume:last-child")).toContain("max-width: none");
  });

  it("不在 JS 里截简历名字符串", () => {
    // 这里放的是"用 CSS 让位"而不是"用 slice 砍字"的选择：砍掉的字符用户找不回来。
    expect(card).not.toMatch(/resume_title[\s\S]{0,120}?\.(slice|substring|substr)\(/);
    expect(card).not.toMatch(/resumeLabel[\s\S]{0,80}?\.(slice|substring|substr)\(/);
  });

  it("关联链接图标有 24px 命中区，不是贴在字边的 12px 小点", () => {
    const link = ruleBlock(board, ".track-card-link");
    expect(link).toContain("width: 24px");
    expect(link).toContain("height: 24px");
  });
});
