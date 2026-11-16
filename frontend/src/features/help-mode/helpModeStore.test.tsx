// SPDX-License-Identifier: Apache-2.0
/**
 * 提示模式（I-18）的 store 契约：进出、切换、自动退出。
 *
 * 这个模式的全部价值在"随时能进、随时能出"——所以退出路径比进入路径更重要：
 * `Esc`、窗口失焦、换页三条都要各自有用例。少一条，用户就会卡在"页面突然变长、
 * 不知道怎么回去"的状态里（理由写在 `helpModeStore.ts` 的注释里）。
 *
 * 断言里不写中文常量（`cjkRatchet` 会把新增中文断言算成新增文案），一律 `t("key")` 比对。
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import HelpModeBadge from "./HelpModeBadge";
import {
  enterHelpMode,
  exitHelpMode,
  getHelpModeSnapshot,
  isHelpModeActive,
  subscribeHelpMode,
  toggleHelpMode,
} from "./helpModeStore";

afterEach(() => {
  // 模块级单例：每个用例都从"关闭且没有残留监听器"开始。
  exitHelpMode();
});

describe("helpModeStore", () => {
  it("默认关闭", () => {
    expect(isHelpModeActive()).toBe(false);
    expect(getHelpModeSnapshot().active).toBe(false);
  });

  it("进入 / 退出各自广播一次，重复进入不重复广播", () => {
    let notifications = 0;
    const unsubscribe = subscribeHelpMode(() => {
      notifications += 1;
    });

    enterHelpMode();
    expect(isHelpModeActive()).toBe(true);
    expect(notifications).toBe(1);

    // 已经在提示模式里：再进来一次不该惊动订阅方（也就不会让整棵树白重渲染一遍）。
    enterHelpMode();
    expect(notifications).toBe(1);

    exitHelpMode();
    expect(isHelpModeActive()).toBe(false);
    expect(notifications).toBe(2);

    unsubscribe();
    enterHelpMode();
    expect(notifications).toBe(2);
  });

  it("切换返回切换后的状态，调用方可据此决定要不要 preventDefault", () => {
    expect(toggleHelpMode()).toBe(true);
    expect(isHelpModeActive()).toBe(true);
    expect(toggleHelpMode()).toBe(false);
    expect(isHelpModeActive()).toBe(false);
  });

  it("Esc 退出；带修饰键的 Esc 不动（那是系统组合）", () => {
    enterHelpMode();
    fireEvent.keyDown(window, { key: "Escape", ctrlKey: true });
    expect(isHelpModeActive()).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(isHelpModeActive()).toBe(false);
  });

  it("窗口失焦退出：切走再回来时不该还停在提示模式里", () => {
    enterHelpMode();
    fireEvent.blur(window);
    expect(isHelpModeActive()).toBe(false);
  });

  it("退出后不再监听：之后的 Esc / 失焦不会把状态改回来", () => {
    enterHelpMode();
    exitHelpMode();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.blur(window);
    expect(isHelpModeActive()).toBe(false);
  });
});

/**
 * 换页退出必须由 AppShell 层的徽标负责：store 自己不认识路由。
 *
 * 导航按钮的名字**故意**复用徽标文案而不是「退出提示模式」——后者与徽标里的退出按钮
 * 撞名（`getByRole("button", { name })` 会一次找到两个）。
 */
function RouteHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/second")}>
        {t("helpMode.badge")}
      </button>
      <HelpModeBadge />
    </>
  );
}

describe("HelpModeBadge", () => {
  it("提示模式下渲染可被读屏播报的徽标，退出后消失", () => {
    render(
      <MemoryRouter initialEntries={["/first"]}>
        <RouteHarness />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("status")).toBeNull();
    // store 是模块级单例：改状态要进 `act`，否则 React 不会把订阅方的重渲染刷出来。
    act(() => enterHelpMode());

    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent(t("helpMode.badge"));
    expect(badge).toHaveAttribute("aria-live", "polite");

    act(() => exitHelpMode());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("换页即退出：提示模式只服务当前这一页，跨页保留没有意义", () => {
    render(
      <MemoryRouter initialEntries={["/first"]}>
        <RouteHarness />
      </MemoryRouter>,
    );
    act(() => enterHelpMode());
    expect(isHelpModeActive()).toBe(true);

    // 走真实路由跳转（不是直接改 store）：徽标订阅的是 `useLocation`。
    fireEvent.click(screen.getByRole("button", { name: t("helpMode.badge") }));
    expect(isHelpModeActive()).toBe(false);
  });
});
