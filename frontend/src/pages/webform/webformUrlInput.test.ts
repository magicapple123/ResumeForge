// SPDX-License-Identifier: Apache-2.0
/**
 * 地址栏对齐的源守卫（T03）。
 *
 * 上一轮的假绿：高度打在 `.ant-input` 上，量**内层 input** 得到 30 = 30 就判"已对齐"，
 * 而**画边框的是 `.ant-input-affix-wrapper`**——外框仍是 48，按钮 30，顶齐底空 18px。
 * 所以这条守卫盯的不是"有没有 height"，而是"height 有没有打在画边框的那一层"。
 *
 * jsdom 不解析外部 CSS、也没有布局，这里读原文（同 `structureTabOverflow.test.ts`）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { join } from "node:path";

declare const process: { cwd(): string };

function rulesOf(source: string): { selector: string; body: string }[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return stripped
    .split("}")
    .map((chunk) => chunk.split("{"))
    .filter((parts) => parts.length >= 2)
    .map(([selector, body]) => ({
      selector: selector.trim().replace(/\s+/g, " "),
      body: body.trim(),
    }));
}

describe("T03 · 网申地址栏", () => {
  const css = readFileSync(join(process.cwd(), "src", "styles", "modules-webform.css"), "utf8");
  const rules = rulesOf(css);

  it("高度打在画边框的 affix wrapper 上（打在内层 input 上是假绿）", () => {
    const wrapper = rules.find(
      (rule) =>
        rule.selector.includes(".webform-url-input") &&
        rule.selector.includes(".ant-input-affix-wrapper") &&
        !rule.selector.includes(".ant-input-suffix"),
    );
    expect(wrapper, "没有找到 .webform-url-input .ant-input-affix-wrapper 规则").toBeTruthy();
    expect(wrapper?.body).toContain("height: var(--wf-url-control-h)");
    expect(wrapper?.body).toContain("padding-block: 0");
  });

  it("按钮与输入框共用同一个高度变量，左缘只由 compact 消一次双线", () => {
    const button = rules.find(
      (rule) => rule.selector === ".webform-url-input .ant-btn" && rule.body.includes("height"),
    );
    expect(button).toBeTruthy();
    expect(button?.body).toContain("height: var(--wf-url-control-h)");
    // -1px 由 antd `Space.Compact` 提供；按钮自身必须归零，否则叠成 -2px。
    expect(button?.body).toContain("margin-inline-start: 0");
  });

  it("suffix 里的时钟按钮显式写回 margin / radius（否则被上一条拉走）", () => {
    const clock = rules.find((rule) => rule.selector.includes(".ant-input-suffix .ant-btn"));
    expect(clock).toBeTruthy();
    expect(clock?.body).toContain("margin-inline-start: 0");
    expect(clock?.body).toContain("border-radius");
  });

  /**
   * WF-03：这条变量此前是 36，注释写"与右侧按钮一致"而右侧实际吃全局 `controlHeight: 40`
   * ——地址条比同一行的按钮矮 4px。数值写死在这里是刻意的：`appTheme.ts` 的
   * `controlHeight: 40` 是唯一来源，改它就要同步改这行，用例会拦住"只改一头"。
   */
  it("地址条高度等于全局 controlHeight（40），时钟只比外框矮 6px", () => {
    const varRule = rules.find(
      (rule) => rule.selector === ".webform-url-input" && rule.body.includes("--wf-url-control-h"),
    );
    expect(varRule?.body).toContain("--wf-url-control-h: 40px");

    const clock = rules.find((rule) => rule.selector.includes(".ant-input-suffix .ant-btn"));
    expect(clock?.body).toContain("calc(var(--wf-url-control-h) - 6px)");
  });
});
