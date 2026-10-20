// SPDX-License-Identifier: Apache-2.0
/**
 * 阶段色一致性（2026-10-20）。
 *
 * 起因：统计页的「求职漏斗」按序号取 `series` 调色板，于是同一个"面试"在
 * 求职进度是紫色、在统计页是黄色——同一个概念两种颜色，用户没法把它们对上。
 *
 * 两件事必须钉住：
 * 1. `chartPalette.stage` 与 CSS 的 `--rf-stage-*` **逐值一致**（SVG 的 fill 不认
 *    `var()`，只能把这套色在 TS 里复制一份；复制就必须有守卫，否则下次改 token
 *    只会改一处）；
 * 2. 漏斗渲染出来的柱子确实用了阶段色（而不是又退回 `series`）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FunnelChart from "../components/analytics/FunnelChart";
import { CHART_PALETTES } from "./chartPalette";

declare const process: { cwd(): string };

const STAGES = ["applied", "screening", "assessment", "interview", "offer", "rejected"] as const;

function readTokens(file: string): Record<string, string> {
  const raw = readFileSync([process.cwd(), "src", "theme", file].join("/"), "utf8");
  const found: Record<string, string> = {};
  for (const match of raw.matchAll(/--rf-stage-bar-([a-z]+):\s*(#[0-9a-fA-F]{6})/g)) {
    found[match[1]] = match[2].toLowerCase();
  }
  return found;
}

describe("颜色条用色与 token 一致", () => {
  it.each([
    ["light", "design-tokens.css"],
    ["dark", "dark-tokens.css"],
  ] as const)("%s 主题", (theme, file) => {
    const tokens = readTokens(file);
    // 六个阶段都得在 CSS 里定义（少一个就说明 token 被删了）。
    for (const stage of STAGES) expect(tokens[stage]).toBeTruthy();
    expect(CHART_PALETTES[theme].stage).toEqual(tokens);
  });
});

describe("分类色随主题", () => {
  it("深色是浅色的同色相降饱和版（索引一一对应）", () => {
    // 投递趋势 / 周内分布 / 公司排行按序号取 `series`：两套主题的**色相顺序必须一致**。
    // 上一版深色直接套了阶段色，于是"周一的蓝"在深色下变成灰、"周四的黄"变成紫——
    // 用户看到的是"换主题后颜色完全变了"。这里把两套值都钉住。
    expect(CHART_PALETTES.light.series).toEqual([
      "#5b8ff9",
      "#61ddaa",
      "#65789b",
      "#f6bd16",
      "#7262fd",
      "#78d3f8",
    ]);
    expect(CHART_PALETTES.dark.series).toEqual([
      "#7f9fd8",
      "#79c2a4",
      "#8fa3bd",
      "#d1b46a",
      "#a79ad6",
      "#8fc4d8",
    ]);
  });
});

describe("求职漏斗按阶段取色", () => {
  it("每根柱子用对应阶段的颜色，而不是序列调色板", () => {
    const { container } = render(
      <FunnelChart
        stages={[
          { status: "applied", label: "已投递", count: 10 },
          { status: "screening", label: "筛选中", count: 8 },
          { status: "interview", label: "面试", count: 4 },
          { status: "offer", label: "Offer", count: 2 },
        ]}
      />,
    );
    const fills = Array.from(container.querySelectorAll("rect"))
      .map((node) => (node.getAttribute("fill") ?? "").toLowerCase())
      .filter(Boolean);
    // 轨道 rect 也是 rect：只断言"阶段色确实出现在图里"，不数个数。
    expect(fills).toContain(CHART_PALETTES.light.stage.applied);
    expect(fills).toContain(CHART_PALETTES.light.stage.screening);
    expect(fills).toContain(CHART_PALETTES.light.stage.interview);
    expect(fills).toContain(CHART_PALETTES.light.stage.offer);
  });
});
