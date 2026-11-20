// SPDX-License-Identifier: Apache-2.0
/**
 * 结构页签横向滚动条的源守卫（T10）。
 *
 * 现象：结构页签底部多出一条"内容没溢出却能拖"的横向滚动条。
 * 两层根因，缺一条就会复发：
 * 1. 开关行用 `padding-inline: 6px` + `margin-inline: -6px` 外扩 hover 底色 → 6px 计入
 *    `scrollWidth`（改成 `::before` 绘制后不占布局）；
 * 2. `.resume-wb-v2-panel` 只写了 `overflow-y: auto` → 按规范另一轴变成 `auto`，
 *    任何绘制外溢都会长出横向滚动条（必须显式 `overflow-x: clip`）。
 *
 * jsdom 没有布局，量不出 `scrollWidth`，所以这里读 CSS 原文——与
 * `chip-style-popover-slider.test.ts` 同一取舍。真机数值由交付报告里的三档量测覆盖。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { join } from "node:path";

declare const process: { cwd(): string };

function readCss(...parts: string[]): string {
  return readFileSync(join(process.cwd(), "src", ...parts), "utf8");
}

/** 剥注释后按 `}` 拆规则（注释里的示例不能被当成声明）。 */
function rulesOf(source: string): { selector: string; body: string }[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return stripped
    .split("}")
    .map((chunk) => chunk.split("{"))
    .filter((parts) => parts.length >= 2)
    .map(([selector, body]) => ({
      selector: selector.trim().replace(/\s+/g, " "),
      body: body.trim(),
    }));
}

describe("T10 · 结构页签不许出横向滚动条", () => {
  it("开关行不再用负 margin 外扩（那 6px 会计入 scrollWidth）", () => {
    const css = readCss("features", "resume", "layout", "entry-layout-panel.css");
    const rows = rulesOf(css).filter((rule) => rule.selector.includes(".is-switch"));
    expect(rows.length).toBeGreaterThan(0);
    for (const rule of rows) {
      expect(rule.body, `这条规则把外扩写回了布局：${rule.selector}`).not.toMatch(
        /margin-inline:\s*-/,
      );
      expect(rule.body).not.toMatch(/padding-inline:\s*6px/);
    }
    // 底色必须还在，只是改成绘制属性。
    expect(
      rulesOf(css).some(
        (rule) =>
          rule.selector.includes(".is-switch::before") && rule.body.includes("inset: 0 -6px"),
      ),
      "hover 底色的绘制层不见了",
    ).toBe(true);
  });

  it("面板显式声明 overflow-x: clip（不能靠 overflow-y: auto 的隐式推导）", () => {
    const css = readCss("features", "resume", "editor", "workbench-v2.css");
    const panel = rulesOf(css).find(
      (rule) => rule.selector === ".resume-wb-v2-panel" && rule.body.includes("flex"),
    );
    expect(panel).toBeTruthy();
    expect(panel?.body).toContain("overflow-x: clip");
  });
});
