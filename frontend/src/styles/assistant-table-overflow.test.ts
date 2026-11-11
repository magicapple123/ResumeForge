// SPDX-License-Identifier: Apache-2.0
/**
 * 助手回复里的 Markdown 表格不许超出气泡（#9）。
 *
 * 现场（2026-11-11，1366×768）：长中文 2 列表 872 / 容器 658、8 列表 1200 / 375、
 * 长 URL 表 1200 / 658——表头最后一个字被切在气泡右缘。根因不是 `overflow-x: auto`
 * 没写，而是两条让表格"必须比容器宽"的规则：
 *
 * 1. `table { width: max-content }` 按最长单元格不换行铺开，永远不会为容器换行；
 * 2. `th, td { min-width: 100px }` 让 N 列最少 N×100px（8 列就是 800px 起步）。
 *
 * Windows 的滚动条是覆盖式的、不悬停不显示，所以用户看到的是"被切掉"而不是"能滚"。
 * jsdom 不求值布局，量不到像素，因此这里守**约定**（#9 的 v2 写法），像素由
 * `evidence/09-table-clip/` 的真机测量负责。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "assistant-content.css"].join("/"), "utf8");
}

function rule(source: string, selector: string, window = 600): string {
  const start = source.indexOf(selector);
  expect(start, `找不到规则：${selector}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, start + window);
}

describe("助手表格不裁切（#9）", () => {
  it("表格超过容器时压回容器宽，由浏览器换行", () => {
    const block = rule(css(), ".assistant-markdown-table-wrap table {");
    expect(block).toContain("width: max-content");
    expect(block).toContain("min-width: 100%");
    // 关键的一行：没有它，max-content 会把表顶出气泡。
    expect(block).toContain("max-width: 100%");
  });

  it("单元格不再有 100px 下限，长串可断行", () => {
    const block = rule(css(), ".assistant-markdown-table-wrap th,");
    expect(block).toContain("min-width: 0");
    expect(block).toContain("overflow-wrap: anywhere");
    // 反向断言：把 100px 加回来会让 8 列表重新顶穿（这条是防回退）。
    expect(block).not.toContain("min-width: 100px");
  });

  it("保留横向滚动作为极端不可断内容的兜底", () => {
    const block = rule(css(), ".assistant-markdown-table-wrap {");
    expect(block).toContain("overflow-x: auto");
  });
});
