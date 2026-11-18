// SPDX-License-Identifier: Apache-2.0
/**
 * 参数栏两个下拉弹层的**宽度守卫**。
 *
 * 为什么要有这条测试：`104px` 与 `216px` 这两个数字是"与触发框等宽（此前框 88 / 层 130，
 * 现统一为 104px；I-06 起触发框会伸缩，104 退化成弹层的**最小**宽度）"与"字体下拉竖排两层
 * 需要的最小宽度"的直接体现，但它们藏在一条 CSS 声明里——把
 * `.resume-params-dropdown.resume-format-dropdown` 整条删掉，
 * 组件用例仍然全绿（jsdom 不求值布局，`classList` 里有那个类就够了），界面上却会
 * 退回 216px 的宽弹层。用户当初提的就是"版式下拉太宽"这条，所以它值得一条专门的守卫。
 *
 * jsdom 不求值布局，因此照 `input-focus-ring.test.ts` 的做法直接读样式原文断言。
 *
 * **改这两条宽度里的任何一条，都要同步改这条断言**——包括"把组合选择器拆成单类"、
 * "让版式下拉也吃 216px"、"给字体下拉换成别的宽度"这三种回头路。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync(
    [process.cwd(), "src", "styles", "resume-workbench-controls.css"].join("/"),
    "utf8",
  );
}

/** 取某个选择器的声明块正文；没有这条规则时返回 null（而不是空串，便于区分）。 */
function blockOf(source: string, selector: string): string | null {
  const index = source.indexOf(selector);
  if (index < 0) return null;
  const start = source.indexOf("{", index);
  const end = source.indexOf("}", start);
  if (start < 0 || end < 0) return null;
  return source.slice(start + 1, end);
}

describe("参数栏下拉弹层的宽度", () => {
  it("字体下拉与版式下拉共用的 216px 还在（且带视口兜底）", () => {
    const source = css();
    // 注意用"后面紧跟 `{`"的写法定位**单独**的 `.resume-params-dropdown` 块：
    // 组合选择器 `.resume-params-dropdown.resume-format-dropdown` 是另一条规则。
    const shared = blockOf(source, ".resume-params-dropdown {");
    expect(shared, "共用规则 `.resume-params-dropdown` 不见了").not.toBeNull();
    expect(shared).toContain("width: 216px");
    // 视口更窄时靠它兜底（永远留 32px 呼吸），改宽度不该顺手把它删掉。
    expect(shared).toContain("max-width: calc(100vw - 32px)");
  });

  it("版式下拉的最小宽度是 104px（四个字 + 箭头），宽度跟随触发框而不是写死", () => {
    const source = css();
    const formatOnly = blockOf(source, ".resume-params-dropdown.resume-format-dropdown {");
    expect(formatOnly, "版式下拉的专属收窄规则不见了").not.toBeNull();
    // I-06（2026-11-18）：触发框改为跟随左栏控件列伸缩（104 → 封顶 320），弹层不能再写死
    // 104——宽栏下会变成"框 320、层 104"。现在 `width: auto` + `min-width: 104px`：
    // 实际宽度由 rc-select 按触发框宽度下发内联 `min-width`（见下一条用例）。
    expect(formatOnly).toContain("width: auto");
    expect(formatOnly).toContain("min-width: 104px");

    // 必须是组合选择器：单类 `.resume-format-dropdown` 会把**任何**带这个类的弹层
    // 收到 104px（字体下拉也带共用类，样式一旦被别处复用就会连带收窄）。
    expect(/^\s*\.resume-format-dropdown\s*\{/m.test(source)).toBe(false);
  });

  it("版式下拉不能关掉 `popupMatchSelectWidth`：关掉后弹层按内容算，就不再与触发框等宽", () => {
    // jsdom 不求值布局，这条契约只能读源码原文（与上面几条同一个做法）。
    const component = readFileSync(
      [process.cwd(), "src", "features", "resume", "layout", "ResumeTemplateControls.tsx"].join(
        "/",
      ),
      "utf8",
    );
    expect(component).not.toContain("popupMatchSelectWidth={false}");
  });

  it("两条规则的范围不互相越界：共用块不写 104px，专属块不改共用宽度以外的东西", () => {
    const source = css();
    const shared = blockOf(source, ".resume-params-dropdown {") ?? "";
    const formatOnly = blockOf(source, ".resume-params-dropdown.resume-format-dropdown {") ?? "";
    // 共用块里不该出现 104（否则字体下拉也被收窄，"竖排两层"会被截断）。
    expect(shared).not.toContain("104px");
    // 专属块只覆盖宽度：max-width 继续吃共用那条，避免两处各写一份兜底。
    expect(formatOnly).not.toContain("max-width");
  });
});
