// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台的**布局契约**（两处 2026-11-06 用户截图）。
 *
 * 一、左栏「层次与间距」四行参数行的列宽：四行的标签列 / 滑杆 / 读数各不对齐。
 * 二、中栏内容面板底部多出一条横向滚动条、首行（姓名）贴着栏目条。
 *
 * 为什么都是"读 CSS 原文"而不是"渲染后量像素"：jsdom 没有布局，`getBoundingClientRect`
 * 全是 0，渲染型断言只能证明"元素在"，证明不了"四条竖线对齐"或"没有横条"。
 * 这里钉的是**算式与声明本身**：三个列宽变量的取值、三处行结构用同一组变量、
 * 加起来不超过参数栏内容宽；滚动容器显式隐藏横向溢出、内容面板补的那 6px 内边距。
 *
 * 中文只出现在注释与 `it` 名称里（没有任何 `*ByText` 参数）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorkbenchCss } from "../../../test/workbenchStyles";
import { WORKBENCH_PARAMS_WIDTH } from "./useWorkbenchColumns";
import { NARROW_PANEL_WIDTH, controlsWidthFor } from "../layout/usePanelNarrow";

declare const process: { cwd(): string };

function readStyle(name: string): string {
  return readFileSync([process.cwd(), "src", "styles", name].join("/"), "utf8");
}

const CONTROLS = readStyle("resume-workbench-controls.css");
// 2026-11-18：滑杆宽度/连续伸缩段从 controls 拆到独立分片（500 行预算），
// 排位紧跟在 controls 之后（见 `resume.css` 的 @import 顺序）。
const SLIDERS = readStyle("resume-workbench-controls-sliders.css");
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
 * 参数栏的**可用内容宽**（分组卡片里的那一层，行真正能用的宽度）。
 *
 * 参数栏 `width: 380` + `padding: 20` → 内容 380（border-box 紧口径 340）；
 * 行不在列内容盒里，而在**分组卡片**里：卡片还有 1px 边框 + 12px 内边距（每侧），
 * 上下组之间 14px 的 gap 不占横向。所以行的容器（`.resume-wb-group-body`）是
 * `WORKBENCH_PARAMS_WIDTH − 40 − 2 − 24 = 314`。
 *
 * 2026-11-18（DF-7）起宽度不再由这份算式"预算"，而是运行时由 `useControlsWidthVar`
 * 量 `.resume-wb-group-body` 的真实 `clientWidth` 得到（系统滚动条吃掉多少就少多少）。
 * 这里保留 314 只用来钉住**默认 380 栏宽下三列刚好放得下**这条下限。
 */
const CARD_INSET = 20 * 2 + 2 + 12 * 2;
const CONTENT_WIDTH = WORKBENCH_PARAMS_WIDTH - CARD_INSET;

describe("左栏参数行 · 列宽契约", () => {
  it("标签列固定、控件列连续、滑杆填满控件列（四行才可能落在同一批竖线上）", () => {
    // 标签列取最长的一条「小节标题大小」：6 字 × 12px。
    expect(cssNumber(CONTROLS, "--resume-wb-label-w")).toBe(72);
    // 控件列宽是**连续值**：JS 逐帧写到列根；152 只是 JS 未挂上时的兜底。
    expect(cssNumber(CONTROLS, "--resume-wb-controls-w")).toBe(152);
    // 控件列的**下限**：± 30 + 2 + 滑杆 64 + 2 + 30 = 128（必须与 JS 的
    // `CONTROLS_MIN_WIDTH` 同值，否则 `minmax(132px, 128px)` 会按 min 落位）。
    expect(cssNumber(CONTROLS, "--resume-wb-controls-min-w")).toBe(128);
    // 滑杆清掉 antd 自带的 6px 左右外边距：不清零时它比控件列多占 12px，尾部被顶出去。
    expect(SLIDERS).toMatch(
      /\.resume-wb-col-params \.ant-slider \{[^}]*margin-inline: 0 !important/,
    );
    // 滑杆必须跟着控件列**连续**伸缩：没有上限（max-width: none）、下限 64。
    expect(SLIDERS).toMatch(
      /\.resume-wb-col-params \.ant-slider \{[^}]*min-width: 64px !important/,
    );
    expect(SLIDERS).toMatch(
      /\.resume-wb-col-params \.ant-slider \{[^}]*max-width: none !important/,
    );
    expect(SLIDERS).toMatch(/\.resume-wb-col-params \.ant-slider \{[^}]*width: 100%/);
    // 滑杆那一格按剩余空间定宽（`flex-basis: 0`）；用 `auto` 会与滑杆的 `width: 100%`
    // 互相依赖，最后落到 min-width（2026-11 实测 152 的控件列里滑杆只有 56）。
    expect(SLIDERS).toMatch(/\.ant-space-item:has\(> \.ant-slider\) \{[^}]*flex: 1 1 0;/);
  });

  it("连续宽度：分组内容盒 − 标签 − 尾部下限 − 两道 6px，并夹到 128 下限", () => {
    // 默认 380 栏宽：分组内容盒 314 → 314 − 72 − 102 − 12 = 128（正好落在下限上）。
    expect(CONTENT_WIDTH).toBe(314);
    expect(controlsWidthFor(CONTENT_WIDTH)).toBe(128);
    // 420 栏宽（用户上一次拖到的宽度）：354 → 168。
    expect(controlsWidthFor(354)).toBe(168);
    // 最窄 380 + 15px 滚动条：299 → 113，夹到 128（尾部由 overflow 泄压）。
    expect(controlsWidthFor(299)).toBe(128);
    // 越界输入只是兜底，不产生 NaN / 负宽度。
    expect(controlsWidthFor(0)).toBe(128);
    expect(controlsWidthFor(Number.NaN)).toBe(128);
    // 窄档阈值同步降到 340（原来 420 会把默认宽度下的分段控件过早竖起来）。
    expect(NARROW_PANEL_WIDTH).toBe(340);
  });

  it("三处行结构共用同一组列宽变量（层次与间距 / 行距页边距照片 / 字号）", () => {
    // 三列：标签定宽、控件列由变量给值、尾部按内容且不被压没。
    const template =
      /grid-template-columns:\s+var\(--resume-wb-label-w\)\s+minmax\(var\(--resume-wb-controls-min-w\),\s*var\(--resume-wb-controls-w\)\)\s+minmax\(min-content,\s*1fr\);/g;
    // 三条 grid：`.resume-wb-row`（四行滑杆）、`.is-stacked > .ant-space:has(tail)`、
    // `> .resume-measure-cell:has(tail)`。少一条，那一组的第二列就会回到内容宽。
    expect(CONTROLS.match(template) ?? []).toHaveLength(3);
    // 尾部铺满第三列（不是 `justify-self: end` 收缩靠右）：收缩靠右会把读数整体右推，
    // 「字号」那行没有来源胶囊，读数就比别的行多偏 60px。
    expect(CONTROLS).not.toMatch(/\.ant-space-item:last-child \{\s*justify-self: end/);
    expect(CONTROLS).not.toMatch(/\.resume-measure-tail \{\s*justify-self: end/);
  });

  it("默认 380 栏宽内不溢出：72 + 6 + 128 + 6 +（读数 44 + 6 + 胶囊 52）", () => {
    // 读数与胶囊的宽度分别声明在这两个文件里，一起读出来才是一份真算式。
    expect(CONTROLS).toMatch(/\.resume-wb-col-params \.resume-measure-value \{[^}]*flex: 0 0 44px/);
    expect(LAYOUT).toMatch(/\.resume-measure-source \{[^}]*min-width: 52px/);

    const used = 72 + 6 + cssNumber(CONTROLS, "--resume-wb-controls-min-w") + 6 + (44 + 6 + 52);
    expect(used).toBe(314);
    expect(used).toBeLessThanOrEqual(CONTENT_WIDTH);
    // 滚动条吃掉十几像素时（控件列已到下限），尾部必须能收，否则整栏长出横向滚动条。
    expect(CONTROLS).toMatch(
      /\.resume-wb-col-params \.resume-measure-tail \{[^}]*overflow: hidden/,
    );
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
