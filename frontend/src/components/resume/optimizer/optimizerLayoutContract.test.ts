// SPDX-License-Identifier: Apache-2.0
/**
 * 「按条件优化版面」约束卡的**宽卡布局契约**（2026-10-25 用户反馈："右边太空了"）。
 *
 * 为什么读 CSS 原文：jsdom 没有布局，`getBoundingClientRect` 全是 0，渲染型断言只能证明
 * 元素在，证明不了"按钮贴右缘"或"两行铺满整张卡"。这里钉的是宽容器那一段的算式、
 * 显式动作列，以及 TSX 里的区域修饰类——删掉任何一处，右侧空白就会回来。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上。
import { join } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readSource(relative: string): string {
  return readFileSync(join(process.cwd(), "src", relative), "utf8");
}

const CSS = readSource("components/resume/optimizer/optimizer.css");
const TSX = readSource("components/resume/optimizer/LayoutOptimizerPanel.tsx");

/** 取 `@container (min-width: 640px)` 那一整段（大括号配平）。 */
function wideBlock(): string {
  const start = CSS.indexOf("@container (min-width: 640px)");
  expect(start, "缺少宽容器断点").toBeGreaterThanOrEqual(0);
  const open = CSS.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < CSS.length; index += 1) {
    if (CSS[index] === "{") depth += 1;
    else if (CSS[index] === "}") {
      depth -= 1;
      if (depth === 0) return CSS.slice(start, index + 1);
    }
  }
  throw new Error("宽容器块没有闭合");
}

describe("优化器约束卡 · 宽容器布局", () => {
  it(">=640px 有独立断点，且两行网格 + 右侧动作列", () => {
    const block = wideBlock();
    // 5 列：84 标签 / 1.6fr 控件 / 84 标签 / 1fr 控件 / auto 动作。
    expect(block).toContain("84px minmax(0, 1.6fr) 84px minmax(130px, 1fr) auto");
    // 复选框占第一行前四列，按钮独占最右列并跨两行。
    expect(block).toContain('"checks checks checks checks actions"');
    expect(block).toContain('"margin-label margin-control target-label target-control actions"');
    // 按钮贴右缘 + 垂直居中（只放进动作列还不够，靠这两个声明才"填满右侧"）。
    const actionsStart = block.indexOf(".resume-optimizer-actions {");
    expect(actionsStart).toBeGreaterThanOrEqual(0);
    const actionsRule = block.slice(actionsStart, block.indexOf("}", actionsStart) + 1);
    expect(actionsRule).toContain("grid-area: actions;");
    expect(actionsRule).toContain("justify-self: end;");
    expect(actionsRule).toContain("align-self: center;");
  });

  it("两段约束用区域修饰类接入网格（否则会退化成自动放置）", () => {
    expect(TSX).toContain("resume-optimizer-field is-margin");
    expect(TSX).toContain("resume-optimizer-field is-target");
    const block = wideBlock();
    expect(block).toContain("grid-area: margin-label");
    expect(block).toContain("grid-area: margin-control");
    expect(block).toContain("grid-area: target-label");
    expect(block).toContain("grid-area: target-control");
  });
});
