// SPDX-License-Identifier: Apache-2.0
/**
 * 纸面「自定义颜色…」的拾色弹层（I-13 收尾）。
 *
 * 这一层要钉住的三件事都没有可见报错：
 *
 * 1. **落点漂了**：弹层不用菜单那套 `placeMenu`，就会出现"菜单在手指这儿、
 *    面板跳到屏幕另一头"；jsdom 量不了像素，所以断言的是**结构**（`placeMenu` 的结果 +
 *    `data-rf-anchor-*`），不是截图；
 * 2. **初值错了**：选区内已经是某个颜色时，面板还从恒定的红色起步，用户一按「应用」
 *    就把颜色改掉了——初值必须是 runs 里的那一档；
 * 3. **取消也写了**：取消路径只要漏一次 `return`，就会变成"点了取消反而改了内容"。
 *
 * 断言文案一律走 `t()`：`cjkRatchet` 的 tests 口径逐文件卡中文 `*ByText`，新文件基线为 0。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { placeMenu } from "../../context-menu/positioning";
import RichColorPickerPopover, { RICH_COLOR_PICKER_SIZE } from "./RichColorPickerPopover";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderPicker(overrides: Partial<Parameters<typeof RichColorPickerPopover>[0]> = {}) {
  const props = {
    x: 24,
    y: 32,
    initial: "#c0392b",
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<RichColorPickerPopover {...props} />);
  return props;
}

function popoverRoot(): HTMLElement {
  const node = document.querySelector(".rf-rich-color-popover");
  if (!(node instanceof HTMLElement)) throw new Error("弹层未渲染");
  return node;
}

/** 面板里的 HEX 输入框（antd 把 className 挂在 affix 外壳或 input 本身上，两种都收）。 */
function hexInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    ".ant-color-picker-hex-input input, input.ant-color-picker-hex-input",
  );
}

describe("纸面拾色弹层", () => {
  it("落点与右键菜单同一坐标（同一套 placeMenu 夹取），并把锚点留成可断言结构", () => {
    renderPicker();
    const root = popoverRoot();
    const expected = placeMenu({ x: 24, y: 32 }, RICH_COLOR_PICKER_SIZE);

    expect(parseFloat(root.style.left)).toBe(expected.left);
    expect(parseFloat(root.style.top)).toBe(expected.top);
    // 结构上的"同一坐标"：面板拿到的就是菜单拿到的那个点。
    expect(root).toHaveAttribute("data-rf-anchor-x", "24");
    expect(root).toHaveAttribute("data-rf-anchor-y", "32");
  });

  it("初值取选区当前颜色（不是恒定默认色）", () => {
    renderPicker({ initial: "#1f6feb" });
    expect(popoverRoot()).toHaveAttribute("data-rf-color", "#1f6feb");

    cleanup();
    // 未设色 / 跨两种颜色时退回正文黑（与中栏工具条同一取舍）。
    renderPicker({ initial: null });
    expect(popoverRoot()).toHaveAttribute("data-rf-color", "#111111");
  });

  it("在面板里选一个色 → 「应用」交出去的正是这个色", async () => {
    const props = renderPicker({ initial: "#c0392b" });
    await waitFor(() => expect(hexInput()).not.toBeNull());

    fireEvent.change(hexInput()!, { target: { value: "#123456" } });
    expect(popoverRoot()).toHaveAttribute("data-rf-color", "#123456");

    fireEvent.click(screen.getByRole("button", { name: t("rich.menu.colorApply") }));
    expect(props.onApply).toHaveBeenCalledTimes(1);
    expect(props.onApply).toHaveBeenCalledWith("#123456");
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("「取消」= 一个字节都不改（不调 onApply）", () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: t("rich.menu.colorCancel") }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it("Esc 与点外部都走取消；点面板内部不算点外部", () => {
    const props = renderPicker();
    // 面板内部（按钮行）按下去不该被当成"点空白"。
    fireEvent.mouseDown(screen.getByRole("button", { name: t("rich.menu.colorApply") }));
    expect(props.onCancel).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });
});
