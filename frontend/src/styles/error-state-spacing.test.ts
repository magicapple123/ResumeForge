// SPDX-License-Identifier: Apache-2.0
/**
 * 错误态图标与正文的间距（T17）。
 *
 * 旧版 `.rf-state-error-icon` 是 40px，但 antd 给 `.ant-empty-image` 的高度是 120px 的
 * **插画位**，于是图标与描述文字之间固定空出 80px。视觉上像"内容没加载完"。
 *
 * 这是定位型视觉约定：jsdom 不求值布局，读样式原文断言——而且必须断言**只在错误态**
 * 收紧，否则另外 90 处依赖 120px 插画的 EmptyState 会被一起改掉。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "foundation.css"].join("/"), "utf8");
}

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "u");
  return pattern.exec(css())?.[1] ?? "";
}

describe("错误态间距（T17）", () => {
  it("错误态把插画位收到 40px，且下边距 12px", () => {
    const rule = block(".rf-state--error .ant-empty-image");
    expect(rule).toContain("height: var(--rf-state-icon-size)");
    expect(rule).toContain("margin-bottom: 12px");
  });

  it("图标尺寸与插画位同源，不是两个魔法数", () => {
    expect(block(".rf-state--error")).toContain("--rf-state-icon-size: 40px");
    // `.rf-state-error-icon` 有两条规则（颜色/尺寸），按"有一条含 var"断言。
    expect(css()).toMatch(/\.rf-state-error-icon\s*\{[^}]*font-size:\s*var\(--rf-state-icon-size/u);
  });

  it("收紧只发生在错误态前缀下（别动 90 处插画空态）", () => {
    const global = block(".rf-state .ant-empty-image");
    expect(global).not.toContain("height:");
  });
});
