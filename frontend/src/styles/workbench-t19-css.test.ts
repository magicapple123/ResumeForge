// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台三处界面缺陷的 CSS 契约（T19，2026-11）。
 *
 * 三处都**量不出像素**：jsdom 没有布局，`getBoundingClientRect` 恒为 0，而这三处的症状恰好
 * 是"差 6px 的溢出""两个按钮贴在一起""页签长得像另一套控件"。所以这里钉声明本身：
 * - 诊断条必须 border-box（本仓没有全局重置，`.is-compact` 又显式整宽）；
 * - 填充菜单那一行必须自己带 flex 排布与 8px 间距（原先零规则，两段紧贴）；
 * - 双语页签必须是下划线形态，主按钮旁的说明必须独占一行。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readStyle(...parts: string[]): string {
  return readFileSync([process.cwd(), "src", ...parts].join("/"), "utf8");
}

const PANELS = readStyle("styles", "resume-panels.css");
const WORKBENCH_V2 = readStyle("features", "resume", "editor", "workbench-v2.css");
const BILINGUAL = readStyle("styles", "bilingual.css");

function block(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(source)?.[1] ?? "";
}

describe("诊断条：盒模型不再让右缘越过卡片边框", () => {
  it("`.resume-diagnostics-bar` 显式声明 border-box", () => {
    expect(block(PANELS, ".resume-diagnostics-bar")).toContain("box-sizing: border-box");
  });

  it("`.is-compact` 不再写 `width: 100%`（块级 flex 本来铺满，整宽在 content-box 下会溢出）", () => {
    const compact = block(PANELS, ".resume-diagnostics-bar.is-compact");
    expect(compact.length).toBeGreaterThan(0);
    // 只认声明行：注释里会提到这条被删掉的属性（解释为什么不能写），不能算违规。
    expect(compact).not.toMatch(/^\s*width:\s*100%/m);
    // 右缘仍然贴齐：靠的是块级宽度 + `min-width: 0`（不是靠整宽声明）。
    expect(compact).toMatch(/^\s*min-width:\s*0;/m);
  });
});

describe("填充菜单：两段之间是 8px，不是 0", () => {
  it("`.resume-wb-v2-fill-menu` 自带 flex 排布 / 换行 / 间距 / 可收缩", () => {
    const menu = block(WORKBENCH_V2, ".resume-wb-v2-fill-menu");
    expect(menu).toContain("display: flex");
    expect(menu).toContain("flex-wrap: wrap");
    expect(menu).toContain("align-items: center");
    expect(menu).toContain("gap: 8px");
    expect(menu).toContain("min-width: 0");
  });
});

describe("双语面板：下划线页签 + 说明独占一行", () => {
  it("页签条是下划线形态：容器底边 + 选中项 2px 色条压在上面", () => {
    const tabs = block(BILINGUAL, ".bilingual-tabs");
    expect(tabs).toContain("border-bottom: 1px solid var(--rf-border-subtle)");
    // 留内边距色条就落不到容器底边上，会变成"底边 + 色条"两条线。
    expect(tabs).toContain("padding-bottom: 0");
    expect(BILINGUAL).toContain(".bilingual-tab.ant-btn");
    const active = block(BILINGUAL, ".bilingual-tab.ant-btn.is-active::after");
    expect(active).toContain('content: ""');
    expect(active).toContain("height: 2px");
    expect(active).toContain("background: var(--rf-brand)");
  });

  it("主按钮旁的说明 `flex-basis: 100%`（宽栏也不会和按钮挤在同一行）", () => {
    expect(block(BILINGUAL, ".bilingual-toolbar__note")).toContain("flex: 1 0 100%");
  });
});
