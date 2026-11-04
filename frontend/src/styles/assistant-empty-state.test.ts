// SPDX-License-Identifier: Apache-2.0
/**
 * 助手空态的中轴对齐。
 *
 * 2026-11-04（用户口径）：英文界面下「图片和文字明显不是居中摆放」。
 * 实测 1092×614、en-US：宣传图与四个快捷入口的中心都在 x=573，而
 * `.assistant-empty-state-copy`（`max-width: 440px` 的块级网格）贴在父容器左边，
 * 中心落在 x=562——三段不在同一条中轴上，差 11px。
 *
 * 根因是「块级元素不会因为父级 `text-align: center` 而居中」：只有行内内容会被居中。
 * jsdom 不求值布局，所以这里读 CSS 原文，钉住「块本身也居中」这条规则。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "assistant-layout.css"].join("/"), "utf8");
}

describe("助手空态的中轴对齐", () => {
  it("文案块自己居中，而不是贴在父容器左边", () => {
    const source = css();
    const block = source.slice(
      source.indexOf(".assistant-empty-state-copy {"),
      source.indexOf(".assistant-empty-state-copy {") + 400,
    );
    expect(block).toContain("max-width: 440px");
    expect(block).toContain("margin-inline: auto");
    expect(block).toContain("text-align: center");
  });

  it("网格子项也居中，避免多行文案左对齐成锯齿", () => {
    const source = css();
    const block = source.slice(
      source.indexOf(".assistant-empty-state-copy {"),
      source.indexOf(".assistant-empty-state-copy {") + 400,
    );
    expect(block).toContain("justify-items: center");
  });
});
