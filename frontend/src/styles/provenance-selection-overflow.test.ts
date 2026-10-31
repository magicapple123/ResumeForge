// SPDX-License-Identifier: Apache-2.0
/**
 * Q25：来源核对「核对哪一条内容」下拉不再把卡片撑宽。
 *
 * jsdom 不求值布局，所以读样式原文断言三条规则都在：antd Space 的 item 允许收缩、
 * 第一项（下拉）吃掉剩余宽度、下拉自身可缩到容器内。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "provenance.css"].join("/"), "utf8");
}

/** 某选择器后面第一段 `{ ... }` 的内容（选择器原文按字面量查找，避开正则转义）。 */
function block(selector: string): string {
  const source = css();
  const start = source.indexOf(selector);
  if (start < 0) return "";
  const open = source.indexOf("{", start + selector.length);
  const close = source.indexOf("}", open);
  if (open < 0 || close < 0) return "";
  return source.slice(open + 1, close);
}

describe("来源核对的「核对哪一条内容」选择卡", () => {
  it("antd Space 的 item 允许收缩（默认 min-width:auto 会把卡片撑宽）", () => {
    const item = block(".provenance-selection__controls .ant-space-item");
    expect(item).not.toBe("");
    expect(item).toContain("min-width: 0");
  });

  it("第一项（下拉）吃掉剩余宽度并对长选中值让步", () => {
    const first = block(".provenance-selection__controls .ant-space-item:first-child");
    expect(first).not.toBe("");
    expect(first).toContain("flex: 1 1 220px");
  });

  it("下拉自身占满宽度且不撑破父级", () => {
    const source = css();
    const selectRule = /\.provenance-selection__select\s*\{([^}]*)\}/u.exec(source)?.[1] ?? "";
    expect(selectRule).toContain("width: 100%");
    expect(selectRule).toContain("min-width: 0");
  });
});
