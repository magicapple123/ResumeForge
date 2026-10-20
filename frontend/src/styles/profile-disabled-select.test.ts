// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」非编辑态的下拉框文字色（2026-10-20）。
 *
 * antd 的 disabled 会把内容统一压到 `rgba(0,0,0,.25)`，和同一行里仍然正常的输入框
 * 并排时，看起来像"这一格没填"。这里只把**文字**换回正文色，交互仍然是禁用的
 * （点不开、Tab 也进不去）。
 *
 * jsdom 不求值 antd 的 CSS-in-JS，所以直接读样式文件原文断言这条覆盖存在、且被
 * 限定在「非编辑态」——不带 `:not(.is-editing)` 的话编辑态也会被染色，反而看不出可编辑。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function profileCss(): string {
  return readFileSync([process.cwd(), "src", "styles", "profile.css"].join("/"), "utf8");
}

describe("我的资料 · 非编辑态下拉框", () => {
  it("文字用正文色，且只在非编辑态生效", () => {
    const css = profileCss();
    expect(css).toContain(".profile-page:not(.is-editing) .ant-select-disabled");
    expect(css).toContain("--rf-text-body");
    // 不能误伤编辑态：可编辑时下拉应该是正常的可点击样式。
    expect(css).not.toContain(".profile-page .ant-select-disabled .ant-select-content-has-value");
  });
});
