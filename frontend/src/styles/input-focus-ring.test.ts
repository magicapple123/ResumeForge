// SPDX-License-Identifier: Apache-2.0
/**
 * 文本输入框的聚焦环。
 *
 * 2026-10-20：antd 的聚焦光晕是 `box-shadow: 0 0 0 2px rgba(…, .43)`，半透明、贴着
 * 1px 描边，在圆角处会透出底色，肉眼看就是一圈"毛边"→ 改成实色 outline。
 * 2026-10-24：那圈实色 outline 叠在边框上等于一道约 4px 的纯蓝框，"太扎眼、不和谐"
 * （用户口径）→ 改成 1px 边框 + 14% 混色的 3px 柔光。
 *
 * jsdom 不求值布局，所以直接读样式原文断言：规则存在、只作用于文本类字段、
 * 并且用的是低透明度光晕而不是实色硬边。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "accessibility.css"].join("/"), "utf8");
}

describe("文本输入框的聚焦环", () => {
  it("用低透明度的柔和光晕，而不是一道 4px 的实色蓝框", () => {
    const source = css();
    // 2px 实色 outline + 1px 偏移叠在 1px 边框上，实际画出来是约 4px 的纯蓝框
    // （2026-10-24 用户口径："太扎眼"）。现在只留边框 + 一圈 14% 的混色光晕。
    expect(source).toContain(
      "box-shadow: 0 0 0 3px color-mix(in srgb, var(--rf-focus-visible) 14%, transparent)",
    );
    // 这条规则块里不能再出现实色 outline（否则又叠回一道硬边）。
    const block =
      /\.app-shell \.ant-input:focus,[\s\S]*?\{([^}]*)\}/.exec(source)?.[1] ??
      /* prettier 可能把选择器拆行，退回整段断言 */ "";
    expect(block).toContain("outline: none");
    expect(block).not.toContain("2px solid");
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
