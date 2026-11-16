// SPDX-License-Identifier: Apache-2.0
/**
 * 右栏首屏空态（I-27）：三步引导。
 *
 * 守三件事：
 * 1. 未读表单时右栏不再是白板——三步逐条渲染，且**只有一个当前步**；
 * 2. 步骤完成度由 `running` / `hasSnapshot` 派生，不另存状态；
 * 3. 引导里**不放主按钮**：同屏两个同名主入口会让人犹豫点哪个（工具条已有一颗）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import webFormPageZh from "../../i18n/messages/zh-CN.webFormPage";
import { WebFormOnboarding } from "./WebFormOnboarding";

const zh = webFormPageZh;

function renderOnboarding(props: { running: boolean; hasSnapshot: boolean }) {
  return render(<WebFormOnboarding {...props} />);
}

afterEach(cleanup);

describe("WebFormOnboarding", () => {
  it("未启动时：三步全在，当前步是第 1 步，下一步指向工具条", () => {
    renderOnboarding({ running: false, hasSnapshot: false });

    expect(screen.getByText(zh["webFormPage.onboarding.title"])).toBeTruthy();
    expect(screen.getByText(zh["webFormPage.onboarding.badge"])).toBeTruthy();
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(3);
    expect(steps[0].textContent).toContain(zh["webFormPage.onboarding.state.now"]);
    expect(steps[1].textContent).toContain(zh["webFormPage.onboarding.state.todo"]);
    expect(steps[2].textContent).toContain(zh["webFormPage.onboarding.state.todo"]);
    expect(screen.getByText(zh["webFormPage.onboarding.next.start"])).toBeTruthy();
  });

  it("已启动未读取：第 1 步完成，第 2 步成为当前步，下一步指向左栏读取", () => {
    renderOnboarding({ running: true, hasSnapshot: false });

    const steps = screen.getAllByRole("listitem");
    expect(steps[0].textContent).toContain(zh["webFormPage.onboarding.state.done"]);
    expect(steps[1].textContent).toContain(zh["webFormPage.onboarding.state.now"]);
    expect(screen.getByText(zh["webFormPage.onboarding.next.read"])).toBeTruthy();
    // 已启动就不再提示"还没开始"。
    expect(screen.queryByText(zh["webFormPage.onboarding.badge"])).toBeNull();
  });

  it("三步都没有主按钮（动作留在工具条与流程条）", () => {
    const { container } = renderOnboarding({ running: false, hasSnapshot: false });
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
