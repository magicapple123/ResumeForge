// SPDX-License-Identifier: Apache-2.0
/**
 * 看板页的两条排版约定（T13）。
 *
 * jsdom 不求值布局（`getBoundingClientRect()` 恒为 0），所以与
 * `features/resume/editor/chip-style-popover-slider.test.ts` 同一套做法：**读 CSS 原文**
 * 断言规则形状。有人在浏览器里调数值时忘了改源，测试会先红。
 *
 * 1. `.analytics-nav` 的 sticky 偏移必须是负的 content-pad。滚动容器 `.app-content`
 *    带 `padding: var(--rf-content-pad)`，`top: 0` 只能贴到内容盒顶边，栏上沿与滚动区
 *    顶边之间会漏出一条 24/16/16px 的缝（三档实测 leak 恒等于该 padding）。也**不许**
 *    写死 `-24px`：D 档是 16px、A 档是 32px，写死只在一档对。
 * 2. `.analytics-section > .ant-card-head` 不能有横向渐变。卡宽 1164 时
 *    `#f6f8fb → #fff` 在中途就淡完，右端没有边界，像底色没铺匀；头部应沿用卡身的
 *    `--rf-surface`，只保留那条 `--rf-border-subtle` 分隔线。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "modules-analytics.css"].join("/"), "utf8");
}

/** 取出某个选择器（顶层，不含伪类/后代子块）的声明块正文。 */
function blockOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m");
  return pattern.exec(css())?.[1] ?? "";
}

describe("看板分段导航的 sticky 偏移", () => {
  it("吃掉滚动容器的 content-pad，栏沿与滚动区顶边齐平", () => {
    const block = blockOf(".analytics-nav");
    expect(block).not.toBe("");
    expect(block).toContain("position: sticky");
    // 必须是 token 形式的负值：换档（24/16/32）时自动跟着走。
    expect(block).toMatch(/top:\s*calc\(\s*-1\s*\*\s*var\(--rf-content-pad\)\s*\)/);
  });

  it("不写死像素值，也不回退成 top: 0", () => {
    const block = blockOf(".analytics-nav");
    expect(block).not.toMatch(/top:\s*-\d+px/);
    expect(block).not.toMatch(/(^|;)\s*top:\s*0(px)?\s*(;|$)/);
  });
});

describe("看板卡片的头部底色", () => {
  it("头部不铺横向渐变（左灰右白会显得底色没铺匀）", () => {
    const block = blockOf(".analytics-page .analytics-section .ant-card-head");
    expect(block).not.toBe("");
    expect(block).not.toContain("linear-gradient");
  });

  it("仍保留自己的分隔线，不回落 antd 默认色", () => {
    const block = blockOf(".analytics-page .analytics-section .ant-card-head");
    expect(block).toMatch(/border-bottom:\s*1px solid var\(--rf-border-subtle\)/);
  });
});
