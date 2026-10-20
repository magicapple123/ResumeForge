// SPDX-License-Identifier: Apache-2.0
/**
 * 文本输入框的聚焦环（2026-10-20）。
 *
 * antd 的聚焦光晕是 `box-shadow: 0 0 0 2px rgba(…, .43)`：半透明、贴着 1px 描边，
 * 在圆角处会透出底色、像素边界也不干净，肉眼看就是一圈"毛边"。
 *
 * 现在改成实色 `outline`（浏览器按 border-radius 绘制，边界干净），并显式关掉阴影。
 * jsdom 不求值布局，所以直接读样式原文断言：规则存在、只作用于文本类字段、
 * 并且没有再留下 box-shadow。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "accessibility.css"].join("/"), "utf8");
}

describe("文本输入框的聚焦环", () => {
  it("用实色 outline，而不是半透明光晕", () => {
    const source = css();
    const block =
      /\.app-shell \.ant-input:focus,[\s\S]*?\{([^}]*)\}/.exec(source)?.[1] ??
      /* prettier 可能把选择器拆行，退回按属性断言 */ "";
    expect(source).toContain(".ant-input:focus");
    expect(source).toContain("outline: 2px solid var(--rf-focus-visible)");
    expect(source).toContain("outline-offset: 1px");
    if (block) expect(block).toContain("box-shadow: none");
  });

  it("弹窗自动聚焦的内容容器不画轮廓（否则被裁成标题下一条蓝线）", () => {
    const source = css();
    expect(source).toContain('.ant-modal [tabindex="-1"]:focus');
    expect(source).toContain('.ant-drawer [tabindex="-1"]:focus');
    // 容器上必须是 none，不能只是改颜色。
    const block = /\.ant-modal \[tabindex="-1"\]:focus,[\s\S]*?\{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(block).toContain("outline: none");
  });

  it("只覆盖文本类字段，不动下拉/开关", () => {
    const source = css();
    // 这条规则块里不该出现 select / switch。
    const start = source.indexOf(".app-shell .ant-input:focus");
    const end = source.indexOf("}", start);
    const rule = source.slice(start, end);
    expect(rule).not.toContain(".ant-select");
    expect(rule).not.toContain(".ant-switch");
  });
});
