// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台的**布局契约**（两处 2026-11-06 用户截图）。
 *
 * 一、左栏「层次与间距」四行参数行的列宽：四行的标签列 / 滑杆 / 读数各不对齐。
 * 二、中栏内容面板底部多出一条横向滚动条、首行（姓名）贴着栏目条。
 *
 * 为什么都是"读 CSS 原文"而不是"渲染后量像素"：jsdom 没有布局，`getBoundingClientRect`
 * 全是 0，渲染型断言只能证明"元素在"，证明不了"四条竖线对齐"或"没有横条"。
 * 这里钉的是**算式与声明本身**：三个固定列宽、三处行结构用同一组变量、
 * 加起来不超过参数栏内容宽；滚动容器显式隐藏横向溢出、内容面板补的那 6px 内边距。
 *
 * 中文只出现在注释与 `it` 名称里（没有任何 `*ByText` 参数）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorkbenchCss } from "../../test/workbenchStyles";
import { WORKBENCH_PARAMS_WIDTH } from "./useWorkbenchColumns";

declare const process: { cwd(): string };

function readStyle(name: string): string {
  return readFileSync([process.cwd(), "src", "styles", name].join("/"), "utf8");
}

const CONTROLS = readStyle("resume-workbench-controls.css");
const LAYOUT = readStyle("modules-layout.css");
const WORKBENCH = readWorkbenchCss();
const TABS = readStyle("resume-workbench-tabs.css");

/** 取某条自定义属性声明的像素值（只用于本文件里唯一的那几个变量）。 */
function cssNumber(source: string, name: string): number {
  const match = new RegExp(`${name}:\\s*(\\d+)px`).exec(source);
  expect(match, `${name} 没有以 px 声明`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}

/**
 * 参数栏的**内容宽**下限。
 *
 * 现在全站没有 `box-sizing` 重置（antd 的 `genCommonStyle` 只覆盖 `[class^="ant-"]`），
 * 所以 `.resume-wb-col-params`（`width: 380` + `padding: 20`）是 **content-box**：
 * 真正的内容宽是 380。这里仍按"border-box 口径"的 340 算上限——它是**更严的那一侧**：
 * 设计要在两种解释下都成立（哪天补回全局 `border-box` 重置也不会溢出）。
 * 两种情况下三列都靠固定列宽对齐，多出来的宽度由尾部那一列（`minmax(0, 1fr)`）吸收，
 * 来源胶囊靠 `margin-left: auto` 始终贴行右缘。
 */
const CONTENT_WIDTH = WORKBENCH_PARAMS_WIDTH - 20 * 2;

describe("左栏参数行 · 列宽契约", () => {
  it("标签列 / 控件列 / 滑杆是三个固定值（四行才可能落在同一批竖线上）", () => {
    // 标签列取最长的一条「小节标题大小」：6 字 × 12px。
    expect(cssNumber(CONTROLS, "--resume-wb-label-w")).toBe(72);
    // ± 各 30（controlHeightSM）+ 两道 2px 间距 + 滑杆 88。
    expect(cssNumber(CONTROLS, "--resume-wb-controls-w")).toBe(152);
    expect(cssNumber(CONTROLS, "--resume-wb-slider-w")).toBe(88);
    // 88 的滑杆必须清掉 antd 自带的 6px 左右外边距：不清零时它实际占 100px，
    // 控件列就不是 152 而是 164，四行的 `+` 各自偏一点（用户截图里那种错位）。
    expect(CONTROLS).toMatch(
      /\.resume-wb-col-params \.ant-slider \{[^}]*margin-inline: 0 !important/,
    );
  });

  it("三处行结构共用同一组列宽变量（层次与间距 / 行距页边距照片 / 字号）", () => {
    const template =
      /grid-template-columns: var\(--resume-wb-label-w\) var\(--resume-wb-controls-w\) minmax\(0, 1fr\);/g;
    // 三条 grid：`.resume-wb-row`（四行滑杆）、`.is-stacked > .ant-space:has(tail)`、
    // `> .resume-measure-cell:has(tail)`。少一条，那一组的第二列就会回到内容宽。
    expect(CONTROLS.match(template) ?? []).toHaveLength(3);
    // 尾部铺满第三列（不是 `justify-self: end` 收缩靠右）：收缩靠右会把读数整体右推，
    // 「字号」那行没有来源胶囊，读数就比别的行多偏 60px。
    expect(CONTROLS).not.toMatch(/\.ant-space-item:last-child \{\s*justify-self: end/);
    expect(CONTROLS).not.toMatch(/\.resume-measure-tail \{\s*justify-self: end/);
  });

  it("内容宽 340 内不溢出：72 + 6 + 152 + 6 +（读数 44 + 6 + 胶囊 52）", () => {
    expect(CONTENT_WIDTH).toBe(340);
    // 读数与胶囊的宽度分别声明在这两个文件里，一起读出来才是一份真算式。
    expect(CONTROLS).toMatch(/\.resume-wb-col-params \.resume-measure-value \{[^}]*flex: 0 0 44px/);
    expect(LAYOUT).toMatch(/\.resume-measure-source \{[^}]*min-width: 52px/);

    const used = 72 + 6 + 152 + 6 + (44 + 6 + 52);
    expect(used).toBeLessThanOrEqual(CONTENT_WIDTH);
  });
});

describe("中栏内容面板 · 横向余量与首行留白", () => {
  it("滚动容器显式隐藏横向溢出，且不把纵向滚动一起关掉", () => {
    const block = /\.resume-wb-editor-body \{[\s\S]*?\n\}/.exec(WORKBENCH)?.[0] ?? "";
    expect(block).toContain("overflow-y: auto");
    // 只写 `overflow-y: auto` 时 `overflow-x` 会按规范计算成 `auto`，1px 余量就是底部那条横条。
    expect(block).toContain("overflow-x: hidden");
    // 只认声明行：这段的注释里恰好也写着 `overflow: hidden`（解释为什么不能用它）。
    expect(block).not.toMatch(/^\s*overflow: hidden;/m);
  });

  it("内容面板补 6px 横向内边距 + 12px 上留白（抵消 gutter，给姓名字段一口气）", () => {
    // antd 6 的类名是 `.ant-tabs-body-holder`（v5 的 `-content-holder` 已改名）。
    const block =
      /\.resume-wb-editor \.resume-wb-tabs-body \.ant-tabs-body-holder \{[\s\S]*?\n\}/.exec(
        TABS,
      )?.[0] ?? "";
    expect(block).toContain("padding-inline: 6px");
    expect(block).toContain("padding-top: 12px");
  });
});
