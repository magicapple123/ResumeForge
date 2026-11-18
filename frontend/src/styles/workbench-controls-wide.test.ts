// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台左栏**宽档**排版契约（T20 → DF-7，2026-11-18）。
 *
 * 症状（DF-7 改前）：左栏拖宽时滑杆几乎不动，只有过了 520px 才一下弹长——参数行的控件列
 * 写死 `minmax(132px, 152px)`，宽档靠一条 `@container (min-width: 520px)` 整体换列模板。
 *
 * 现在：宽度由 JS 量测写 `--resume-wb-controls-w`（连续），这里钉的是**断点已经撤掉**、
 * **容器声明仍在分组内容盒上**（它同时是量测点）、**分边滑杆在基础文件里就解除了上限**。
 *
 * 为什么读 CSS 原文而不是渲染后量像素：jsdom 没有布局，`getBoundingClientRect` 全是 0，
 * 容器查询更不会求值。连续量测的行为由 `workbenchLayoutContract.test.ts` 里的
 * `controlsWidthFor()` 用例钉住，这里只管声明本身。
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
// 滑杆段在 2026-11-18 从 controls 拆到独立分片（500 行预算），
// 排位紧跟在 controls 之后（`resume.css` 的 @import 顺序）。
const SLIDERS = readStyle("resume-workbench-controls-sliders.css");

/** 取一条规则块（选择器原样转义，命中第一个 `}`）。 */
function block(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(source)?.[1] ?? "";
}

describe("左栏宽档 · 连续宽度与容器声明", () => {
  it("宽档规则以新文件承载，并在聚合清单里按 @import 引入（规则之前）", () => {
    expect(WIDE.length).toBeGreaterThan(0);
    const importAt = CONTROLS.indexOf('@import "./resume-workbench-controls-wide.css"');
    expect(importAt).toBeGreaterThan(-1);
    // @import 必须排在所有规则之前，否则浏览器与构建器都会忽略它（整档失效且无报错）。
    const firstRuleAt = CONTROLS.indexOf("{");
    expect(importAt).toBeLessThan(firstRuleAt);
    // 排在同目录的 rows 分片之后：@import 的规则先于本文件规则，窄档靠更高特异性取胜。
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

  it("520px 断点已经撤掉：宽度不再按档位整段切换", () => {
    // 注释里还留着"曾经有一条 520px 断点"的说明，只认声明本身。
    const rules = WIDE.replace(/\/\*[\s\S]*?\*\//g, "");
    // 反证：任何 `@container rf-wb-params (min-width: ...)` 重新出现，滑杆就又变成
    // "拖到某个宽度才弹一下"，正是 DF-7 要修的症状。
    expect(rules).not.toMatch(/@container\s+rf-wb-params\s*\(min-width/);
    // 旧宽档的三条列模板也一并退场：现在只有基础文件里的那一套（变量连续给值）。
    expect(rules).not.toContain("minmax(var(--resume-wb-controls-w), 1fr)");
  });

  it("分边页边距的四条滑杆在基础文件里就解除上限（不依赖断点）", () => {
    // 选择器跨行书写，按"规则块内的声明"断言，不依赖选择器是否一行写完。
    const side = block(SLIDERS, ".resume-wb-col-params .resume-margin-side-slider.ant-slider");
    expect(side).toMatch(/max-width:\s*none\s*!important/);
    expect(side).toMatch(/width:\s*auto\s*!important/);
    // 滑杆外面那一格同样不能再有 88px 上限（旧变量已整个退场）。
    expect(CONTROLS + SLIDERS).not.toContain("--resume-wb-slider-w");
  });
});
