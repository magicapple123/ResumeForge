// SPDX-License-Identifier: Apache-2.0
/**
 * 纸面右键菜单（`BoldContextMenu`）：文案随选区状态切换、点击落到哪个回调、怎么关掉。
 *
 * 这个菜单只有两个按钮，但每一处都可能"看起来对、实际错"：
 *
 * 1. **文案反了**：选区已经整段加粗时还显示「加粗」，用户点下去期待变粗、实际变细；
 * 2. **点错回调**：两颗按钮接反（「加粗」打开编辑器、「编辑这一栏」改内容），功能都还在，
 *    只是完全不是用户要的；
 * 3. **关不掉**：Esc / 点空白都不关，菜单会一直挂在纸面上（它是 `position: fixed`，
 *    跟着页面滚，什么都不挡住但一直在）。
 *
 * 断言文案一律走 `t()`：`cjkRatchet` 的 tests 口径逐文件卡中文 `*ByText`，新文件基线为 0。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import BoldContextMenu from "./BoldContextMenu";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderMenu(overrides: Partial<Parameters<typeof BoldContextMenu>[0]> = {}) {
  const props = {
    x: 24,
    y: 32,
    isBold: false,
    onToggle: vi.fn(),
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<BoldContextMenu {...props} />);
  return props;
}

describe("纸面右键菜单", () => {
  it("未加粗时显示「加粗」，已加粗时显示「取消加粗」", () => {
    renderMenu({ isBold: false });
    expect(screen.getByRole("menuitem", { name: t("rich.menu.bold") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("rich.menu.unbold") })).toBeNull();
    cleanup();

    renderMenu({ isBold: true });
    expect(screen.getByRole("menuitem", { name: t("rich.menu.unbold") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("rich.menu.bold") })).toBeNull();
  });

  it("两项菜单 + 一条分隔线，位置来自父页面坐标", () => {
    renderMenu();
    const menu = screen.getByRole("menu");
    expect(menu).toHaveStyle({ left: "24px", top: "32px" });
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: t("rich.menu.edit") })).toBeInTheDocument();
  });

  it("点「加粗」调 onToggle，「编辑这一栏」调 onPick", () => {
    const props = renderMenu({ isBold: true });
    fireEvent.click(screen.getByRole("menuitem", { name: t("rich.menu.unbold") }));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(props.onPick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: t("rich.menu.edit") }));
    expect(props.onPick).toHaveBeenCalledTimes(1);
  });

  it("按下按钮不夺走选区（mousedown 被拦掉默认行为）", () => {
    renderMenu();
    const item = screen.getByRole("menuitem", { name: t("rich.menu.bold") });
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    item.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("打开即聚焦（Esc 才有落点）", () => {
    renderMenu();
    expect(document.activeElement).toBe(screen.getByRole("menu"));
  });

  it("Esc 关闭，点菜单外关闭，点菜单内不关闭", () => {
    const props = renderMenu();
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });
});
