// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」分区的内边距与编辑态标记。
 *
 * 2026-10-28 用户反馈：每个分区的标题栏下面直接就是字段，看起来"完全和顶部挨在一起"。
 * 根因是 `.profile-section-content` 的 padding 上边为 0——只给了左右与底部。
 *
 * jsdom 不求值布局，所以这里直接读样式原文：上边距不能是 0，且编辑态标记必须存在
 * （它是"改过的字段与没改过的有区别"的唯一实现，删掉样式等于功能消失）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "profile-card.css"].join("/"), "utf8");
}

/** 取某条规则的声明块（`{ … }`），拿不到返回空串。 */
function blockOf(source: string, selector: string): string {
  const index = source.indexOf(selector);
  if (index < 0) return "";
  const open = source.indexOf("{", index);
  const close = source.indexOf("}", open);
  if (open < 0 || close < 0) return "";
  return source.slice(open + 1, close);
}

describe("资料分区的内边距", () => {
  it("内容区四周都留出间距（上边距不能是 0，否则标题下面直接贴着字段）", () => {
    const block = blockOf(css(), ".profile-section-content {");
    expect(block, "`.profile-section-content` 规则必须在 profile-card.css 里").not.toBe("");

    const padding = /padding:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? "";
    expect(padding, "内容区必须声明 padding").not.toBe("");

    // 允许 `16px`、`16px 16px 16px 16px`、`16px 16px`（上下 / 左右）三种写法，
    // 但上边距绝不能是 0——这正是当初被截图的形态。
    const parts = padding.split(/\s+/);
    const top = Number.parseFloat(parts[0]);
    expect(Number.isFinite(top), `padding 的上边距必须是具体数值，现在是 "${padding}"`).toBe(true);
    expect(top, `上边距不能为 0（当前 padding: ${padding}）`).toBeGreaterThanOrEqual(8);
  });

  it("编辑态的 is-dirty 同时改标签与输入框（不能只有一处有反应）", () => {
    const source = css();
    expect(source).toContain(".profile-field-grid-item.is-dirty");
    // 标签强调色 + 输入框换底色：两条都要在，否则"改过的字段"辨识度不够。
    expect(source).toMatch(/\.profile-field-grid-item\.is-dirty[^{]*\.ant-form-item-label/);
    expect(source).toMatch(/\.profile-field-grid-item\.is-dirty[^{]*\.ant-input/);
  });
});
