// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台左栏**宽档**排版契约（T20，2026-11）。
 *
 * 症状：左栏拖宽之后滑杆仍是 88px、读数被推到行的最右缘，中间空出几百像素，滑杆与读数
 * 在视觉上断成两截。根因是三条列模板把弹性给了**尾部列**（`minmax(min-content, 1fr)`）。
 *
 * 为什么读 CSS 原文而不是渲染后量像素：jsdom 没有布局，`getBoundingClientRect` 全是 0，
 * 容器查询更不会求值。这里钉的是**声明本身**：容器声明的落点、三条模板的宽档形态、
 * 阈值 520（435 的窄栏不命中）、分边滑杆的解锁声明。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readStyle(name: string): string {
  return readFileSync([process.cwd(), "src", "styles", name].join("/"), "utf8");
}

const WIDE = readStyle("resume-workbench-controls-wide.css");
const CONTROLS = readStyle("resume-workbench-controls.css");

/** 取一条规则块（选择器原样转义，命中第一个 `}`）。 */
function block(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(source)?.[1] ?? "";
}

/** 宽档那一条 `@container` 起往后的全部内容（多行选择器，逐行取不到整条）。 */
const QUERY = WIDE.slice(WIDE.indexOf("@container rf-wb-params (min-width: 520px)"));

describe("左栏宽档 · 列模板与容器声明", () => {
  it("宽档规则以新文件承载，并在聚合清单里按 @import 引入（规则之前）", () => {
    expect(WIDE.length).toBeGreaterThan(0);
    const importAt = CONTROLS.indexOf('@import "./resume-workbench-controls-wide.css"');
    expect(importAt).toBeGreaterThan(-1);
    // @import 必须排在所有规则之前，否则浏览器与构建器都会忽略它（整档失效且无报错）。
    const firstRuleAt = CONTROLS.indexOf("{");
    expect(importAt).toBeLessThan(firstRuleAt);
    // 排在同目录的 rows 分片之后：@import 的规则先于本文件规则，宽档靠更高特异性取胜。
    expect(CONTROLS.indexOf('@import "./resume-workbench-controls-rows.css"')).toBeLessThan(
      importAt,
    );
  });

  it("容器声明落在分组内容盒上，而不是整列（否则会把 fixed 浮层困在左栏）", () => {
    const body = block(WIDE, ".resume-wb-col-params .resume-wb-group-body");
    expect(body).toContain("container-type: inline-size");
    expect(body).toContain("container-name: rf-wb-params");
    // 反证：整列上有 `container-type` 时，`.document-chip-style-popover`（position: fixed，
    // 右键坐标来自视口）会以该列为包含块，浮层贴着栏目左上角出现。
    expect(block(WIDE, ".resume-wb-col-params")).not.toContain("container-type");
  });

  it("阈值只有一档 520：栏宽 435 的窄档不命中，逐像素保持改动前", () => {
    const thresholds = [...WIDE.matchAll(/@container rf-wb-params \(min-width: (\d+)px\)/g)].map(
      (match) => Number(match[1]),
    );
    expect(thresholds).toEqual([520]);
    // 435 的栏宽 < 520：这一档只有窄档算式（尾部吃弹性）在生效。
    expect(thresholds.every((min) => min >= 520)).toBe(true);
  });

  it("三条同款模板的宽档形态：弹性给控件列，尾部退回 min-content", () => {
    // 三条网格各少一条，那一组的第二列就会回到内容宽（滑杆又停在 88）。
    expect(QUERY).toContain(".resume-wb-rows > .resume-wb-row.ant-space");
    expect(QUERY).toContain("> .ant-space:has(.resume-measure-tail)");
    expect(QUERY).toContain("> .resume-measure-cell:has(.resume-measure-tail)");

    const template =
      /grid-template-columns:\s+var\(--resume-wb-label-w\)\s+minmax\(var\(--resume-wb-controls-w\),\s*1fr\)\s+min-content;/g;
    // 反证：第三列改回 `1fr`（或第二列回到 `minmax(132px, 152px)`）这条就红。
    expect(QUERY.match(template) ?? []).toHaveLength(1);
    // 窄档的"弹性给尾部"算式不得出现在宽档文件里（只在注释里提也不行——那条断言不认注释）。
    expect(QUERY.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/minmax\(min-content,\s*1fr\)/);
  });

  it("分边页边距的滑杆在宽档解锁（含 88px 上限的复位）", () => {
    // 选择器跨行书写，按"规则块内的声明"断言，不依赖选择器是否一行写完。
    expect(QUERY).toContain(".resume-margin-side-slider.ant-slider");
    expect(QUERY).toMatch(/width:\s*auto\s*!important/);
    expect(QUERY).toMatch(/flex:\s*1 1 auto\s*!important/);
    // 只改 width / flex 不够：`max-width: var(--resume-wb-slider-w)` 仍把滑杆钉在 88。
    expect(QUERY).toMatch(/max-width:\s*none\s*!important/);
    // 滑杆外面那一格也有 88 上限，必须一起放开。
    expect(QUERY).toMatch(
      /\.ant-space-item:has\(> \.resume-margin-side-slider\)[\s\S]{0,120}max-width:\s*none\s*!important/,
    );
  });
});
