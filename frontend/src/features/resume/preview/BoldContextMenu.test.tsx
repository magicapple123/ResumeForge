// SPDX-License-Identifier: Apache-2.0
/**
 * 纸面右键菜单（`BoldContextMenu`）：文案随选区状态切换、点击落到哪个回调、怎么关掉。
 *
 * I-13 起菜单与中栏工具条对齐（字号 5 档 + 清除、颜色 6 预设 + 清除、清除行内格式），
 * 所以这里的断言重点从"两个按钮"变成三件事：
 *
 * 1. **文案反了**：选区已经整段加粗时还显示「加粗」，用户点下去期待变粗、实际变细；
 * 2. **档位漂了**：字号/颜色不是 `INLINE_SIZE_STEPS` / `COLOR_PRESETS` 里那一批——
 *    纸面与编辑器两个入口给出不同的档位，用户会以为"有的字号只有编辑器里才有"；
 * 3. **关不掉**：Esc / 点空白都不关，菜单会一直挂在纸面上（它是 `position: fixed`，
 *    跟着页面滚，什么都不挡住但一直在）。
 *
 * 断言文案一律走 `t()`：`cjkRatchet` 的 tests 口径逐文件卡中文 `*ByText`，新文件基线为 0。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { ContextMenuHost } from "../../context-menu/ContextMenuHost";
import { resetContextMenuForTests } from "../../context-menu/contextMenuStore";
import { MENU_GAP } from "../../context-menu/positioning";
import { COLOR_PRESETS, INLINE_SIZE_STEPS } from "../layout/inlineMarks";
import BoldContextMenu from "./BoldContextMenu";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  // 菜单状态住在模块级 store 里：不清空会把上一用例的浮层带到下一用例。
  resetContextMenuForTests();
});

function renderMenu(overrides: Partial<Parameters<typeof BoldContextMenu>[0]> = {}) {
  const props = {
    x: 24,
    y: 32,
    isBold: false,
    onToggleBold: vi.fn(),
    onSize: vi.fn(),
    onColor: vi.fn(),
    onCustomColor: vi.fn(),
    onClear: vi.fn(),
    onPick: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  // 浮层由全局唯一宿主渲染（组件本身只调用 store），所以这里必须一起挂上。
  render(
    <>
      <BoldContextMenu {...props} />
      <ContextMenuHost />
    </>,
  );
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

  it("I-13：字号/颜色档位与编辑器工具条同一批，点下去落到 onSize / onColor", () => {
    const props = renderMenu();
    // 工具条那批档位原样出现在纸面菜单里（少一档就是"能力不对等"）。
    for (const step of INLINE_SIZE_STEPS) {
      expect(
        screen.getByRole("menuitem", { name: `${Math.round(step * 100)}%` }),
      ).toBeInTheDocument();
    }
    for (const hex of COLOR_PRESETS) {
      expect(screen.getByRole("menuitem", { name: hex })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("menuitem", { name: "110%" }));
    expect(props.onSize).toHaveBeenCalledWith(1.1);

    cleanup();
    const second = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: COLOR_PRESETS[2] }));
    expect(second.onColor).toHaveBeenCalledWith(COLOR_PRESETS[2]);
  });

  it("清除类入口：字号/颜色/行内格式各落到自己的回调", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("typography.inline.sizeClear") }));
    expect(props.onSize).toHaveBeenCalledWith(null);

    cleanup();
    const second = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("typography.inline.colorClear") }));
    expect(second.onColor).toHaveBeenCalledWith(null);

    cleanup();
    const third = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("typography.inline.clearMarks") }));
    expect(third.onClear).toHaveBeenCalledTimes(1);
  });

  it("I-13：「自定义颜色…」落到 onCustomColor，且不误触预设/清除", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("rich.menu.colorCustom") }));
    expect(props.onCustomColor).toHaveBeenCalledTimes(1);
    expect(props.onColor).not.toHaveBeenCalled();
    // 菜单照样当场收起：拾色弹层由第二个宿主在**同一个坐标**接着开。
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("全部项 + 两条分隔线，落位贴着指针（不再锚元素左上角）", () => {
    renderMenu();
    const menu = screen.getByRole("menu");
    // 问题 25 起统一贴鼠标：指针位置 + `MENU_GAP`。取整到一个可断言的契约，
    // 而不是钉死具体像素——夹取口径由 `features/context-menu/positioning` 负责。
    expect(parseFloat(menu.style.left)).toBe(24 + MENU_GAP);
    expect(parseFloat(menu.style.top)).toBe(32 + MENU_GAP);
    // 1 加粗 + 5 字号 + 1 清除字号 + 6 颜色 + 1 自定义颜色 + 1 清除颜色
    // + 1 清除行内格式 + 1 编辑
    expect(screen.getAllByRole("menuitem")).toHaveLength(17);
    // 全局只有一份浮层：组件本身不渲染，卡片由 `ContextMenuHost` 唯一产出。
    expect(document.querySelectorAll(".rf-ctx-menu")).toHaveLength(1);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    expect(screen.getByRole("menuitem", { name: t("rich.menu.edit") })).toBeInTheDocument();
  });

  it("点「加粗」调 onToggleBold，且点完菜单收起", () => {
    const props = renderMenu({ isBold: true });
    fireEvent.click(screen.getByRole("menuitem", { name: t("rich.menu.unbold") }));
    expect(props.onToggleBold).toHaveBeenCalledTimes(1);
    expect(props.onPick).not.toHaveBeenCalled();
    // 点任意一项都由 store 关闭浮层（不是"等调用方再收一次"）。
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("点「编辑这一栏」调 onPick，不误触加粗", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: t("rich.menu.edit") }));
    expect(props.onPick).toHaveBeenCalledTimes(1);
    expect(props.onToggleBold).not.toHaveBeenCalled();
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

  it("点菜单外关闭，点菜单内不关闭", () => {
    const props = renderMenu();
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    // 关闭由 store 广播给宿主：浮层当场卸载，onClose 只回调一次。
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("Esc 关闭菜单", () => {
    const props = renderMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
