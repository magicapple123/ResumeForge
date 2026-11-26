// SPDX-License-Identifier: Apache-2.0
/**
 * 版本行与组行的水平内边距是**同一份**（#2 剩下的 32px，2026-11-26）。
 *
 * ## 为什么这条守卫要读 CSS 文本
 *
 * jsdom 不加载组件旁的 CSS（`vitest.config.ts` 的 `test.css.include` 只放行 base /
 * accessibility / design-tokens 几张表），也没有排版能力——`getComputedStyle` 既拿不到
 * `padding-inline`，更量不出"操作列右缘差 32px"。所以这里守的是**契约**而不是像素：
 *
 * 1. `--rf-group-cell-pad-x` 全仓只声明一次，父表 `th`/`td` 与版本行每格都引用它；
 * 2. 除"展开行清零"外，任何水平内边距都不许写字面量（写一个 8px 就是两套数字，
 *    两边迟早分开——上一版正是"父表吃 td 的 padding、版本行自己写间距"）；
 * 3. 版本清单不留横向内边距、栅格不留 `column-gap`（父表列宽已含内边距）。
 *
 * 真机数字（940：最近更新列 608==608、操作列 906==906；1440：1008==1008 / 1398==1398）
 * 由实机验收负责，截图在 `deliverables/verify-2026-11-26/2-sort-layout/07~08`。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

/** 两份样式表都要读：变量定义在表格那份，消费者分散在两份里。 */
const RAW_CSS = [
  readFileSync(`${process.cwd()}/src/pages/resumes/resumeGroupTable.css`, "utf8"),
  readFileSync(`${process.cwd()}/src/pages/resumes/resumeVersions.css`, "utf8"),
]
  .join("\n")
  // 去注释再断言：注释里写着"这里不留内边距"不算实现（同 `components/common` 下的守卫）。
  .replace(/\/\*[\s\S]*?\*\//g, "");

interface CssRule {
  selector: string;
  body: string;
}

/** 摊平规则（两份文件都是扁平规则，没有 @media 嵌套）。 */
function cssRules(css: string): CssRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2].replace(/\s+/g, " ").trim(),
  }));
}

/** `padding` 简写 → [上, 右, 下, 左]（CSS 的 1/2/3/4 值缩写规则）。 */
function paddingSides(shorthand: string): string[] {
  const parts = shorthand.split(/\s+/);
  const top = parts[0] ?? "";
  const right = parts[1] ?? top;
  const bottom = parts[2] ?? top;
  const left = parts[3] ?? right;
  return [top, right, bottom, left];
}

const RULES = cssRules(RAW_CSS);

/** 按选择器片段取第一条规则里声明的正文。 */
function bodyOf(selector: string): string {
  const rule = RULES.find((item) => item.selector.includes(selector));
  if (!rule) throw new Error(`css rule not found: ${selector}`);
  return rule.body;
}

describe("版本行与组行共用同一份水平内边距", () => {
  it("--rf-group-cell-pad-x 只声明一次，父表 th/td 引用它", () => {
    const declarations = RAW_CSS.match(/--rf-group-cell-pad-x\s*:/g) ?? [];
    expect(declarations).toHaveLength(1);

    // 父表：文字位置原本由 antd 的 td padding 决定，现在必须由这份 token 决定，
    // 否则版本行跟着 token 走、父表跟着 antd 默认值走，两边又会慢慢分开。
    expect(bodyOf("ant-table-thead > tr > th.ant-table-cell")).toContain(
      "padding-inline: var(--rf-group-cell-pad-x)",
    );
    expect(bodyOf("ant-table-tbody > tr > td.ant-table-cell")).toContain(
      "padding-inline: var(--rf-group-cell-pad-x)",
    );
  });

  it("版本行四格都引用同一个 token，且没有第二条水平内边距", () => {
    for (const cell of ["leading", "time", "delivery", "actions"]) {
      expect(bodyOf(`resume-version-${cell}`)).toContain("var(--rf-group-cell-pad-x");
    }

    // 除"展开行清零"外，任何水平内边距都不许写字面量。
    const horizontal = [...RAW_CSS.matchAll(/padding-(?:inline|left|right)\s*:\s*([^;}]+)/g)].map(
      (match) => match[1].trim(),
    );
    const literals = horizontal.filter(
      (value) => value !== "0" && !value.includes("var(--rf-group-cell-pad-x"),
    );
    expect(literals).toEqual([]);
  });

  it("列表不留横向内边距、栅格不留列间距（两者都会把尾随列顶左）", () => {
    const list = bodyOf("resume-version-list");
    const shorthand = list.match(/padding:\s*([^;]+);/)?.[1]?.trim() ?? "";
    const [, right, , left] = paddingSides(shorthand);
    expect([right, left]).toEqual(["0", "0"]);
    expect(list).not.toMatch(/padding-(left|right|inline)/);

    // 8px 的 column-gap × 4 段 = 32px：父表列宽已经含内边距，再插间距就是对不齐本身。
    expect(bodyOf("resume-version-row")).toContain("column-gap: 0");
  });

  it("展开行把横向内边距清零，版本清单才横跨整行", () => {
    expect(bodyOf("ant-table-expanded-row")).toMatch(/padding-inline:\s*0/);
  });
});
