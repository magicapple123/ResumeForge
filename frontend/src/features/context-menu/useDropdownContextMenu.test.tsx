// SPDX-License-Identifier: Apache-2.0
/**
 * 行级右键菜单的受控状态（问题 25）。
 *
 * 为什么单独测这个 hook：`RowContextMenu` 用的是 antd Dropdown，关掉之后浮层要等
 * 退场动画结束才从 DOM 里消失，而 jsdom 不会触发 transition 事件——"关没关"只能用
 * 状态本身来断言。这里把"键盘打开切到元素锚点、滚动/resize/失焦会关"固定在状态层。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDropdownContextMenu } from "./useDropdownContextMenu";

function Probe() {
  const menu = useDropdownContextMenu();
  return (
    <div>
      <button onKeyDown={menu.handleKeyDown} onClick={() => menu.dropdownProps.onOpenChange(true)}>
        trigger
      </button>
      <span data-testid="open">{menu.open ? "open" : "closed"}</span>
      <span data-testid="source">{menu.source}</span>
      <span data-testid="trigger">{menu.dropdownProps.trigger.join(",") || "none"}</span>
      <span data-testid="autofocus">{menu.dropdownProps.autoFocus ? "yes" : "no"}</span>
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useDropdownContextMenu", () => {
  it("键盘打开：source=keyboard，trigger 切成空（回落到元素锚点）并自动聚焦", () => {
    render(<Probe />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "F10", shiftKey: true });

    expect(screen.getByTestId("open").textContent).toBe("open");
    expect(screen.getByTestId("source").textContent).toBe("keyboard");
    expect(screen.getByTestId("trigger").textContent).toBe("none");
    expect(screen.getByTestId("autofocus").textContent).toBe("yes");
  });

  it("指针打开：仍然交给 antd 的 contextMenu trigger（贴鼠标），且不自动聚焦首项", () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("source").textContent).toBe("pointer");
    expect(screen.getByTestId("trigger").textContent).toBe("contextMenu");
    expect(screen.getByTestId("autofocus").textContent).toBe("no");
  });

  it("滚动容器内滚动、窗口失焦都会关闭菜单", () => {
    render(<Probe />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "F10", shiftKey: true });
    expect(screen.getByTestId("open").textContent).toBe("open");

    fireEvent.scroll(document);
    expect(screen.getByTestId("open").textContent).toBe("closed");

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("open").textContent).toBe("open");
    fireEvent.blur(window);
    expect(screen.getByTestId("open").textContent).toBe("closed");
  });

  it("点菜单外部关闭（`.ant-dropdown` 内部不算外部）", () => {
    render(<Probe />);
    fireEvent.click(screen.getByRole("button"));

    const inside = document.createElement("div");
    inside.className = "ant-dropdown";
    const item = document.createElement("button");
    inside.append(item);
    document.body.append(inside);
    fireEvent.pointerDown(item);
    expect(screen.getByTestId("open").textContent).toBe("open");

    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId("open").textContent).toBe("closed");
  });
});

/**
 * 选中文字时让位（2026-11-04 用户实测：两张卡片叠在一起）。
 *
 * 选区菜单由全局单例浮层负责，行/字段菜单不能再开一份。判据是 `hasActiveTextSelection`，
 * 这里只验"hook 在打开前问了它、并因此保持关闭"。
 */
describe("useDropdownContextMenu · 有选区时让位", () => {
  it("输入框里选中了文字：指针打开被拦下，open 仍为 false", () => {
    render(<Probe />);
    const field = document.createElement("textarea");
    field.value = "\u6b63\u6587\u5185\u5bb9";
    document.body.append(field);
    field.focus();
    field.setSelectionRange(0, 2);

    // antd 走的就是这个入口（contextMenu trigger 时 onOpenChange(true)）。
    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("open").textContent).toBe("closed");
    field.remove();
  });

  it("没有选区时照常打开（防止守卫把整条右键链路关死）", () => {
    render(<Probe />);
    window.getSelection()?.removeAllRanges();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("open").textContent).toBe("open");
    expect(screen.getByTestId("source").textContent).toBe("pointer");
  });

  it("键盘打开不受选区影响——键盘没有「处理这段文字」的语义", () => {
    render(<Probe />);
    const field = document.createElement("textarea");
    field.value = "\u6b63\u6587\u5185\u5bb9";
    document.body.append(field);
    field.focus();
    field.setSelectionRange(0, 2);

    fireEvent.keyDown(screen.getByRole("button"), { key: "F10", shiftKey: true });

    expect(screen.getByTestId("open").textContent).toBe("open");
    field.remove();
  });
});
