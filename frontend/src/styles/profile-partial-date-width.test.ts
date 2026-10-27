// SPDX-License-Identifier: Apache-2.0
/**
 * 「出生年月」重叠的不变式守卫（2026-10-27）。
 *
 * 实测过的缺陷：1440 视口下 `.profile-field-grid-item` 宽 259px，而
 * `.profile-partial-date-select__controls` 只有 187px，里面三个 `.ant-select` 各守
 * 自己的 min-width（年 80 / 月 64 / 日 64 = 208px），第三个（日）溢出到 1025px，
 * 而「至今」复选框从 1014px 开始 —— 两者重叠 11px。
 *
 * 根因不是某个数字写错，而是**同一条规则有两份实现**：profile.css 给
 * `width: 100%; min-width: 0`（后写，压过一切），profile-layout.css 给
 * `flex: 1 1 180px; max-width: 260px`。谁宽容谁生效，控件区就能被压到低于
 * 三个下拉的下限之和。
 *
 * 所以这里断言的不是类名，而是两条不变式：
 * 1. 控件区的 min-width ≥ 三个下拉 min-width 之和（算出来，不写死）；
 * 2. 这条规则在仓库里**只有一份**（profile.css 里不许再出现同选择器）。
 *
 * jsdom 不求值 antd 的 CSS-in-JS，也不做真实布局，所以直接读样式与组件源码断言。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function read(relativePath: string): string {
  return readFileSync([process.cwd(), ...relativePath.split("/")].join("/"), "utf8");
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 取出某个选择器的**所有**规则块（同名选择器可能出现在断点里）。 */
function ruleBlocks(css: string, selector: string): string[] {
  const pattern = new RegExp(escapeForRegExp(selector) + "\\s*\\{([^}]*)\\}", "g");
  return Array.from(css.matchAll(pattern)).map((match) => match[1]);
}

/** 某个选择器上声明的 `min-width`（px）；没声明返回 null。 */
function declaredMinWidth(css: string, selector: string): number | null {
  for (const block of ruleBlocks(css, selector)) {
    const match = block.match(/min-width:\s*(\d+)px/);
    if (match) return Number(match[1]);
  }
  return null;
}

const LAYOUT_CSS = read("src/styles/profile-layout.css");
const PROFILE_CSS = read("src/styles/profile.css");
const PARTIAL_DATE_TSX = read("src/components/profile/PartialDateSelect.tsx");

const CONTROLS = ".profile-partial-date-select__controls";
const SELECTS = ".profile-partial-date-select__controls > .ant-select";

describe("我的资料 · 出生年月不被压到溢出", () => {
  it("控件区的 min-width 不小于三个下拉的 min-width 之和", () => {
    // 年份下拉的宽度下限写在组件上（`style={{ minWidth: 80 }}`）：它是"四位数年份 +
    // 箭头"的最小可用宽度，样式表管不到它，必须一起算进和里。
    const yearInlineMin = PARTIAL_DATE_TSX.match(/minWidth:\s*(\d+)/);
    expect(yearInlineMin, "年份下拉应保留一个内联 minWidth").not.toBeNull();
    const yearMin = Number(yearInlineMin?.[1]);

    const selectMin = declaredMinWidth(LAYOUT_CSS, SELECTS);
    expect(selectMin, "月/日两个下拉应声明 min-width").not.toBeNull();

    const controlsMin = declaredMinWidth(LAYOUT_CSS, CONTROLS);
    expect(controlsMin, "控件区应声明 min-width").not.toBeNull();

    const sum = Math.max(yearMin, selectMin ?? 0) + (selectMin ?? 0) * 2;
    expect(controlsMin ?? 0).toBeGreaterThanOrEqual(sum);
    // 顺带钉住实测值：208 = 80 + 64 + 64。数字变化时必须重新实测一次重叠。
    expect(sum).toBe(208);
  });

  it("宽度不够时「至今」整体换行，而不是被压过来", () => {
    const wrapper = ruleBlocks(LAYOUT_CSS, ".profile-partial-date-select")[0] ?? "";
    expect(wrapper).toContain("flex-wrap: wrap");
    const ongoing = ruleBlocks(LAYOUT_CSS, ".profile-partial-date-select__ongoing")[0] ?? "";
    expect(ongoing).toContain("flex: 0 0 auto");
    expect(ongoing).toContain("white-space: nowrap");
  });

  it("控件区宽度只在 profile-layout.css 里有一份实现", () => {
    // 历史根因：profile.css 里另有一份 `width: 100%; min-width: 0`，后写且更宽容，
    // 直接把 layout 的 min-width 抹掉。同一条规则两处实现 = 谁宽容谁生效。
    expect(PROFILE_CSS).not.toContain(CONTROLS);
    expect(PROFILE_CSS).not.toContain(".profile-partial-date-select {");
  });
});
