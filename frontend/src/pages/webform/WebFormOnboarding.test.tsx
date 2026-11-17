// SPDX-License-Identifier: Apache-2.0
/**
 * 初始态版面（T08）：三步横排动作卡 + 两栏「怎么填 / 最近填写」。
 *
 * 守四件事：
 * 1. 三步逐条渲染，**只有一个当前步**，非当前步的按钮 disabled；
 * 2. 卡片按钮不抢主按钮（没有 `ant-btn-primary`）——同屏那颗在工具条上；
 * 3. 两栏是左右两个槽位（页面注入「怎么填」与「最近填写」），不在组件里复制一套；
 * 4. 塌单列的规则是 `@container (max-width: 720px)`，**不是视口断点**（jsdom 量不到
 *    实际布局，所以直接读 CSS 原文钉住写法与数值）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import webFormPageZh from "../../i18n/messages/zh-CN.webFormPage";
import { WebFormOnboarding } from "./WebFormOnboarding";

declare const process: { cwd(): string };

const zh = webFormPageZh;

function renderOnboarding(overrides: Partial<Parameters<typeof WebFormOnboarding>[0]> = {}) {
  const props = {
    running: false,
    hasSnapshot: false,
    targetUrl: "",
    busy: null,
    onStart: vi.fn(),
    onOpenUrl: vi.fn(),
    onRead: vi.fn(),
    fillPanel: <section data-testid="slot-fill">怎么填</section>,
    recentPanel: <section data-testid="slot-recent">最近填写</section>,
    ...overrides,
  };
  return render(<WebFormOnboarding {...props} />);
}

function stepAt(index: number): HTMLElement {
  return screen.getAllByRole("listitem")[index];
}

afterEach(cleanup);

describe("WebFormOnboarding", () => {
  it("三步都是动作卡：只在当前步放可用按钮，其余 disabled", () => {
    renderOnboarding({ running: false });

    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(stepAt(0).textContent).toContain(zh["webFormPage.onboarding.state.now"]);
    expect(stepAt(1).textContent).toContain(zh["webFormPage.onboarding.state.todo"]);
    expect(stepAt(2).textContent).toContain(zh["webFormPage.onboarding.state.todo"]);

    expect(
      within(stepAt(0)).getByRole("button", { name: zh["webFormPage.browserCard.start"] }),
    ).toBeEnabled();
    expect(
      within(stepAt(1)).getByRole("button", { name: zh["webFormPage.urlBar.open"] }),
    ).toBeDisabled();
    expect(
      within(stepAt(2)).getByRole("button", { name: zh["webFormPage.readSnapshot.read"] }),
    ).toBeDisabled();
  });

  it("浏览器启动后当前步变成第 3 步，读取按钮可用", () => {
    renderOnboarding({ running: true });

    expect(stepAt(0).textContent).toContain(zh["webFormPage.onboarding.state.done"]);
    expect(stepAt(1).textContent).toContain(zh["webFormPage.onboarding.state.done"]);
    expect(stepAt(2).textContent).toContain(zh["webFormPage.onboarding.state.now"]);
    expect(
      within(stepAt(2)).getByRole("button", { name: zh["webFormPage.readSnapshot.read"] }),
    ).toBeEnabled();
    // 已完成的启动按钮不能再点。
    expect(
      within(stepAt(0)).getByRole("button", { name: zh["webFormPage.browserCard.start"] }),
    ).toBeDisabled();
  });

  it("第 2 步没有目标网址时打开按钮不可用", () => {
    renderOnboarding({ running: true, targetUrl: "  " });
    expect(
      within(stepAt(1)).getByRole("button", { name: zh["webFormPage.urlBar.open"] }),
    ).toBeDisabled();
  });

  it("卡片按钮不抢主按钮：同屏唯一的主按钮留在工具条上", () => {
    const { container } = renderOnboarding({ running: false });
    expect(container.querySelectorAll("button.ant-btn-primary")).toHaveLength(0);
  });

  it("两栏是页面注入的两个槽位", () => {
    renderOnboarding();
    expect(screen.getByTestId("slot-fill")).toBeInTheDocument();
    expect(screen.getByTestId("slot-recent")).toBeInTheDocument();
    expect(screen.getByTestId("webform-onboarding")).toContainElement(
      screen.getByTestId("slot-recent"),
    );
  });
});

describe("初始态样式的塌单列规则", () => {
  const css = readFileSync(join(process.cwd(), "src/styles/webform-onboarding.css"), "utf8");
  // 注释里会提到 `@media`（解释为什么不用它），判定前先去掉注释，只看真规则。
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("用容器查询在 720 以下塌成单列", () => {
    expect(rules).toContain("@container (max-width: 720px)");
    // 三步卡与两栏都要塌，不能只塌一半。
    expect(rules).toMatch(/@container \(max-width: 720px\) \{[\s\S]*webform-onboarding-steps/);
    expect(rules).toMatch(/@container \(max-width: 720px\) \{[\s\S]*webform-onboarding-columns/);
  });

  it("不掺视口断点：这一片只用 @container", () => {
    expect(rules).not.toContain("@media");
  });

  it("两栏等高：stretch + 右卡 height:100% + 空态 flex:1 居中", () => {
    expect(rules).toMatch(/\.webform-onboarding-columns \{[\s\S]*align-items: stretch/);
    expect(rules).toMatch(/\.webform-recent \{[\s\S]*height: 100%/);
    expect(rules).toMatch(/\.webform-recent-empty \{[\s\S]*flex: 1[\s\S]*justify-content: center/);
    // 3 条固定行高。
    expect(rules).toMatch(/\.webform-recent-row \{[\s\S]*height: 44px/);
  });

  it("安全条降级成一行中性小字：没有底色与警示边框", () => {
    const block = rules.match(/\.webform-safety-strip \{[^}]*\}/)?.[0] ?? "";
    expect(block).toContain("font-size: 12px");
    expect(block).not.toContain("background");
    expect(block).not.toContain("warning");
  });
});
