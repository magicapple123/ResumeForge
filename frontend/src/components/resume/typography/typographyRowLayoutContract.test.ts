// SPDX-License-Identifier: Apache-2.0
/**
 * 「局部排版」行布局契约（2026-10-25 用户截图 2）。
 *
 * 症状（Lead 实测）：数字行高 67.9 —— `<Space wrap>` 把尾部折到第二行、左缘回到标签列；
 * 读数被参数栏全局规则钉成 44px 后溢出，压在来源胶囊下面（截图里的「2× · 约 1 已调整」）；
 * 标签列是内容宽，「字号比例」48 /「颜色」34 让第二列起点在 73 / 87 / 115 之间漂移。
 *
 * 为什么读 CSS / 组件原文而不是量像素：jsdom 没有布局，`getBoundingClientRect` 全是 0。
 * 这里钉的是**声明本身**：72px 标签列、数字行两行网格、44px 覆盖只在本面板内、
 * 行高算式（30 + 4 + 20 = 54，设计目标 52–56）与 Collapse 的收紧值。
 *
 * 2026-10-25 晚：行布局整段从 `resume-workbench-controls.css` 拆到
 * `resume-workbench-typography.css`（controls 守 500 行预算），所以本文件读两个分片：
 * 标签列 / 全局 44px 读数规则仍在 controls，行/面板规则在新分片。
 *
 * 中文只出现在注释与 `it` 名称里（没有任何 `*ByText` 参数）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readStyle(name: string): string {
  return readFileSync([process.cwd(), "src", "styles", name].join("/"), "utf8");
}

/** 参数栏参数行（列宽变量、全局 44px 读数规则仍在这份）。 */
const CONTROLS = readStyle("resume-workbench-controls.css");
/** 2026-10-25 拆出的「局部排版面板：行布局」分片。 */
const TYPOGRAPHY = readStyle("resume-workbench-typography.css");
const ROW = readFileSync(
  [process.cwd(), "src", "components", "resume", "typography", "StyleValueRow.tsx"].join("/"),
  "utf8",
);
const PANEL = readFileSync(
  [process.cwd(), "src", "components", "resume", "typography", "RoleStylePanel.tsx"].join("/"),
  "utf8",
);

/** 取一条规则块的声明文本：选择器原样转义后匹配到第一个 `}`。 */
function block(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 行首锚定：否则 `.resume-typography-tail` 会先命中
  // `.resume-typography-row.is-inline > .resume-typography-tail { … }` 那条。
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(source)?.[1] ?? "";
}

/** 取某条声明里的 px 值（只用于本文件里那几个已知的定值）。 */
function cssPx(source: string, declaration: string): number {
  const match = new RegExp(`${declaration}:\\s*(\\d+)px`).exec(source);
  expect(match, `${declaration} 没有以 px 声明`).not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}

describe("局部排版行 · 列宽与两行结构", () => {
  it("标签列与参数栏其它行共用 72px（六组角色不再各自漂移）", () => {
    expect(cssPx(CONTROLS, "--resume-wb-label-w")).toBe(72);
    const row = block(TYPOGRAPHY, ".resume-typography-row");
    expect(row).toContain("grid-template-columns: var(--resume-wb-label-w, 72px) minmax(0, 1fr)");
    // 数字行：控件行在第一行，尾部在控件列的第二行（此前是被 wrap 折回标签列）。
    expect(block(TYPOGRAPHY, ".resume-typography-controls")).toContain("grid-row: 1");
    const numericTail = block(
      TYPOGRAPHY,
      ".resume-typography-row.is-numeric > .resume-typography-tail",
    );
    expect(numericTail).toContain("grid-column: 2");
    expect(numericTail).toContain("grid-row: 2");
  });

  it("非数字类属性是单行三列，尾部在行尾靠右", () => {
    const inline = block(TYPOGRAPHY, ".resume-typography-row.is-inline");
    expect(inline).toContain(
      "grid-template-columns: var(--resume-wb-label-w, 72px) auto minmax(0, 1fr)",
    );
    // 其它行统一 30：开关 / 取色器本体只有 20，没有下限时行高参差。
    expect(inline).toContain("min-height: 30px");
    const inlineTail = block(
      TYPOGRAPHY,
      ".resume-typography-row.is-inline > .resume-typography-tail",
    );
    expect(inlineTail).toContain("justify-content: flex-end");
  });

  it("根节点不再是 antd Space（wrap 会把尾部折回标签列）", () => {
    expect(ROW).toMatch(/<div\s+className=\{`resume-wb-row resume-typography-row/);
    expect(ROW).not.toMatch(/<Space[^>]*resume-typography-row/);
  });
});

describe("局部排版行 · 读数宽度与控件宽度", () => {
  it("只在本面板把 44px 读数改回内容宽（全局那条不动）", () => {
    // 全局规则仍在 controls：其它参数行的读数继续按 44px 对齐。
    expect(CONTROLS).toMatch(/\.resume-wb-col-params \.resume-measure-value \{[^}]*flex: 0 0 44px/);
    const value = block(TYPOGRAPHY, ".resume-typography-panel .resume-measure-value");
    expect(value).toContain("flex: 0 0 auto");
    expect(value).toContain("width: auto");
    expect(value).toContain("white-space: nowrap");
  });

  it("滑杆 88–140 弹性、输入框 76（参数栏内容宽 380 内一行放下）", () => {
    const slider = block(TYPOGRAPHY, ".resume-wb-col-params .resume-typography-row .ant-slider");
    expect(slider).toContain("min-width: 88px !important");
    expect(slider).toContain("max-width: 140px !important");
    // antd 滑杆自带 14px 上下外边距：不清零时控件行是 40，数字行会超过 56。
    expect(slider).toContain("margin-block: 0 !important");
    expect(
      cssPx(block(TYPOGRAPHY, ".resume-typography-row .resume-typography-number"), "width"),
    ).toBe(76);
  });
});

describe("局部排版面板 · 行高与 Collapse 密度", () => {
  it("数字行两行 + 行间距的预算落在 52–56", () => {
    const gap = cssPx(block(TYPOGRAPHY, ".resume-typography-row.is-numeric"), "row-gap");
    const tailHeight = cssPx(block(TYPOGRAPHY, ".resume-typography-tail"), "min-height");
    // 控件行 = antd 小号控件高 30（controlHeight 40 × 0.75）；滑杆的 block margin 已清零。
    const rowHeight = 30 + gap + tailHeight;
    expect(rowHeight).toBeGreaterThanOrEqual(52);
    expect(rowHeight).toBeLessThanOrEqual(56);
  });

  it("Collapse 收紧到 6/10，角色名 13px/600", () => {
    expect(block(TYPOGRAPHY, ".resume-typography-panel .ant-collapse-header")).toContain(
      "padding: 6px 10px",
    );
    expect(block(TYPOGRAPHY, ".resume-typography-panel .ant-collapse-body")).toContain(
      "padding: 6px 10px 10px",
    );
    const name = block(TYPOGRAPHY, ".resume-typography-role-name");
    expect(name).toContain("font-size: 13px");
    expect(name).toContain("font-weight: 600");
  });

  it("覆盖计数是小胶囊而不是裸数字", () => {
    const pill = block(TYPOGRAPHY, ".resume-typography-own-count");
    expect(pill).toContain("border-radius: 999px");
    expect(pill).toContain("background: var(--rf-surface-alt)");
    expect(PANEL).toContain("resume-typography-own-count");
    expect(PANEL).toContain('t("typography.role.ownCount", { count: ownCount })');
  });
});

describe("CSS 拆分 · 500 行预算", () => {
  it("行布局已搬出 controls（controls ≤ 500 行，新分片承载整段）", () => {
    const lines = (source: string) => source.split("\n").filter((line) => line.length > 0).length;
    expect(lines(CONTROLS)).toBeLessThanOrEqual(500);
    expect(TYPOGRAPHY).toContain("resume-typography-row");
    expect(CONTROLS).not.toContain(".resume-typography-row {");
  });
});
