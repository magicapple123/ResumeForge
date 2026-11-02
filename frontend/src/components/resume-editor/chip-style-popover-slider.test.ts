// SPDX-License-Identifier: Apache-2.0
/**
 * 字段右键「调整排版」浮层里的滑杆宽度（问题 15）。
 *
 * 症状：行距 / 缩进 / 字距三根滑杆只剩「— ○ +」，中间的轨道整条不见。
 * 根因：Slider 的内容宽度是 0，而全项目唯一给它定宽的规则绑在**左栏参数栏**的祖先类
 * （`.resume-wb-col-params .ant-slider`）上；浮层是 `position: fixed` 挂在
 * `.document-editor` 里，祖先链上没有那个类，于是只剩下 `.resume-wb-slider
 * { min-width: 0 }` 这条豁免，把滑杆压成了 0 宽。
 *
 * jsdom 不求值布局（`offsetWidth` 恒为 0），所以与 `styles/input-focus-ring.test.ts`
 * 同一套做法：**读 CSS 原文**断言规则存在且带下限。有人删掉这条规则时测试会变红，
 * 等于把「改本体」的防复发效果拿到，又不担全局风险。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync(
    [process.cwd(), "src", "components", "resume-editor", "chip-menu.css"].join("/"),
    "utf8",
  );
}

describe("样式浮层里的滑杆", () => {
  it("给浮层内的滑杆一条自己的宽度约束（轨道不再被压成 0 宽）", () => {
    const source = css();
    const block =
      /\.document-chip-style-popover \.ant-slider\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
    expect(block).not.toBe("");
    // 必须能伸缩（浮层有 max-width: calc(100vw - 24px)，不能抄左栏的 88px 定宽）。
    expect(block).toContain("flex:");
    const minWidth = /min-width:\s*(\d+)px/.exec(block);
    expect(minWidth).not.toBeNull();
    const value = Number(minWidth?.[1] ?? "0");
    // 太大会在 320px 视口里把两侧的「−/+」挤出浮层。
    expect(value).toBeGreaterThanOrEqual(80);
    expect(value).toBeLessThanOrEqual(96);
  });

  it("不动左栏参数栏的 88px 定宽、也不改成全局规则", () => {
    const source = css();
    // 这里只能出现浮层作用域的规则；全局形态会命中中栏编辑区，破坏既有豁免。
    expect(source).not.toMatch(/^\.resume-wb-slider\s*\{/m);
    expect(source).not.toContain("width: 88px");
  });
});
