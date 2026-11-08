// SPDX-License-Identifier: Apache-2.0
/**
 * 对话技能 chip / 菜单预算的样式契约（T14）。
 *
 * jsdom 不求值布局，所以直接读 CSS 原文断言：chip 行必须允许换行（窄栏 380px 不出现
 * 横向滚动），截断态用琥珀色 token，预算 >80% / >100% 要有黄 / 红两档。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "assistant-skills.css"].join("/"), "utf8");
}

describe("对话技能 chip 行", () => {
  it("chip 行可以折行、不横向滚动", () => {
    const block = /\.assistant-skill-chips \{([\s\S]*?)\}/.exec(css())?.[1] ?? "";
    expect(block).toContain("flex-wrap: wrap");
    expect(css()).not.toContain("overflow-x");
  });

  it("窄栏（<480px 容器）收紧 chip 名称宽度，仍然折行", () => {
    const rule = /@container \(max-width: 479px\) \{([\s\S]*?)\n\}/.exec(css())?.[1] ?? "";
    expect(rule).toContain(".assistant-skill-chip-text");
    expect(rule).toContain("max-width");
  });

  it("被截断的 chip 用琥珀描边（warning token）", () => {
    const block = /\.assistant-skill-chip\.is-truncated \{([\s\S]*?)\}/.exec(css())?.[1] ?? "";
    expect(block).toContain("--rf-warning-border");
    expect(block).toContain("--rf-warning-bg");
  });

  it("预算 >80% 黄、>100% 红", () => {
    expect(css()).toContain(".assistant-skill-budget.is-near");
    expect(css()).toContain("--rf-warning-text");
    expect(css()).toContain(".assistant-skill-budget.is-over");
    expect(css()).toContain("--rf-danger");
  });
});
