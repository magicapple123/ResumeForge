// SPDX-License-Identifier: Apache-2.0
/**
 * 「拖动条目」与「拖动选中文本」必须互斥（用户反馈：拖 chip 时 Chrome 弹
 * 「松开鼠标以搜索文本」）。
 *
 * 这个手势是浏览器的原生语义：**按住的位置出现文本选区**，松手就落成"拖动这段文字"。
 * 所以判据只有一条——拖动源（结构树行、编辑器里除输入控件外的部分）不能是可选中文本，
 * 而真正要打字的控件必须仍然可选。断言直接读样式表：这是纯 CSS 的契约，jsdom 不算
 * 布局、也不套用样式表，`getComputedStyle` 在这里读不出真话。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readStyle(...segments: string[]): string {
  return readFileSync([process.cwd(), "src", ...segments].join("/"), "utf8");
}

/** 取某条规则块（单选择器）的声明体；规则不存在时返回空串。 */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[2] : "";
}

/** 多选择器规则（`a,\nb {`）只能按首个选择器定位，再截到块的右括号。 */
function ruleFrom(css: string, firstSelector: string): string {
  const start = css.indexOf(firstSelector);
  if (start < 0) return "";
  const end = css.indexOf("}", start);
  return end < 0 ? "" : css.slice(start, end);
}

const EDITOR = readStyle("components", "resume-editor", "document-item-editor.css");
const CHIP = readStyle("components", "resume-editor", "document-editor.css");
const STRUCTURE = readStyle("components", "resume", "structure", "structure.css");

describe("拖拽源不能被当成文本选区", () => {
  it("编辑器整栏默认不可选中：否则按住拖动先选中文字，条目就拖不动", () => {
    expect(rule(EDITOR, ".document-editor")).toMatch(/user-select:\s*none/);
  });

  it("只放行真正要打字的控件，正文/字段值仍可选中（不一刀切）", () => {
    const editable = ruleFrom(EDITOR, ".document-editor textarea");
    expect(editable).toMatch(/user-select:\s*text/);
    // 三类都要在放行清单里：纯文本正文、短字段、以及将来换成的富文本可编辑区。
    expect(editable).toContain(".document-editor input");
    expect(editable).toContain('[contenteditable="true"]');
  });

  it("结构树的行不可选中：只读行 / 分组行没有 draggable，选区是它们唯一的响应", () => {
    expect(rule(STRUCTURE, ".rf-structure-row")).toMatch(/user-select:\s*none/);
  });

  it("chip 本体早已不可选中（回归）：这条一旦被删，字段 chip 又能被拖出选区", () => {
    expect(rule(CHIP, ".document-chip")).toMatch(/user-select:\s*none/);
  });

  /**
   * 2026-11-04 用户截图：拖动「时间」chip 时顶部弹「松开鼠标以搜索文本」。
   *
   * 实测当时 `.document-chip-value` 的 `user-select` 已经是 `none`——说明**光靠它不够**：
   * Chrome 判断"拖的是文本还是元素"看的是另一个属性 `-webkit-user-drag`，它当时还是
   * `auto`，于是按下拖动被当成拖动文本。这条规则是唯一真正封住该手势的东西，
   * 删了就会原样复发。
   */
  it("编辑器里除可拖元素外的文本都不是拖拽源（-webkit-user-drag: none）", () => {
    const css = EDITOR;
    expect(css).toMatch(/\.document-editor :not\(\[draggable="true"\]\)\s*\{[^}]*webkit-user-drag:\s*none/);
    // 可拖元素必须被排除：给它们置 none 等于把"拖不动"那条 bug 修回来。
    expect(css).toContain(':not([draggable="true"])');
  });
});
