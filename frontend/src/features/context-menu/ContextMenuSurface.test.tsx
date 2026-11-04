// SPDX-License-Identifier: Apache-2.0
/**
 * 统一右键浮层的契约（问题 25 必带测试）：
 * ① 键盘打开时焦点落在第一个可用项（指针打开落在容器，避免出现首项底色）；
 * ② 关闭后焦点回到触发元素；
 * ③ 滚动容器内滚动会关闭；④ 点菜单内部**不**关闭；⑤ 方向键循环、Esc 关闭。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenuSurface } from "./ContextMenuSurface";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const ITEMS = [
  { key: "disabled", label: "不可用", disabled: true },
  { key: "rename", label: "重命名", onClick: vi.fn() },
  { key: "divider", type: "divider" as const },
  { key: "remove", label: "删除", danger: true, onClick: vi.fn() },
];

function renderSurface(overrides: Partial<Parameters<typeof ContextMenuSurface>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <ContextMenuSurface
      x={40}
      y={60}
      items={ITEMS}
      ariaLabel="行操作"
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onClose };
}

describe("ContextMenuSurface", () => {
  it("键盘打开：焦点落在第一个可用项（跳过禁用项）", () => {
    renderSurface({ source: "keyboard" });
    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus();
  });

  it("指针打开：焦点在容器上（首项不出现聚焦底色）", () => {
    renderSurface({ source: "pointer" });
    expect(screen.getByRole("menu", { name: "行操作" })).toHaveFocus();
  });

  it("关闭后焦点回到打开前的元素", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unmount } = render(
      <ContextMenuSurface x={10} y={10} items={ITEMS} ariaLabel="行操作" onClose={vi.fn()} />,
    );
    unmount();
    expect(trigger).toHaveFocus();
  });

  it("菜单内部按下不关闭；滚动与点外部关闭", () => {
    const { onClose } = renderSurface();
    fireEvent.pointerDown(screen.getByRole("menu", { name: "行操作" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Esc 关闭、方向键在可用项之间循环", () => {
    const { onClose } = renderSurface({ source: "keyboard" });
    const menu = screen.getByRole("menu", { name: "行操作" });

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "删除" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("分隔线渲染成 separator，不参与键盘循环", () => {
    renderSurface();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });
});
