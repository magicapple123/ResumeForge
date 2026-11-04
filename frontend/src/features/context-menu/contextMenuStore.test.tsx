// SPDX-License-Identifier: Apache-2.0
/**
 * 全局右键菜单 store：没有宿主也不能白屏、同一时刻只能有一份、关掉就没了。
 *
 * 这几条正是线上事故的形状：`AppShell` 少写了 children → 取不到 context → 整页
 * `Unexpected Application Error`。所以第一条用例专门在**完全没有宿主**的树里取用菜单，
 * 它必须只是"点了没反应"，而不是抛错。
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContextMenu } from "./contextMenuContext";
import { ContextMenuHost } from "./ContextMenuHost";
import {
  closeContextMenu,
  getContextMenuSnapshot,
  openContextMenu,
  resetContextMenuForTests,
  type ContextMenuOpenOptions,
} from "./contextMenuStore";
import type { RowMenuItem } from "../../components/common/rowActionMenu";

const FIRST_LABEL = "First action";
const SECOND_LABEL = "Second action";

function options(label: string, overrides: Partial<ContextMenuOpenOptions> = {}) {
  const items: RowMenuItem[] = [{ key: label, label, onClick: vi.fn() }];
  return { x: 10, y: 20, items, ariaLabel: "Menu", ...overrides };
}

/** 真实故障现场：在一个没有宿主的树里调 `useContextMenu()` 并打开菜单。 */
function ProbeWithoutHost() {
  const menu = useContextMenu();
  useEffect(() => {
    menu.open(options(FIRST_LABEL));
  }, [menu]);
  return <span data-testid="probe" />;
}

const menus = () => document.querySelectorAll(".rf-ctx-menu");

beforeEach(() => {
  resetContextMenuForTests();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  resetContextMenuForTests();
});

describe("contextMenuStore", () => {
  it("没有宿主时取用菜单不抛错，只是没有浮层", () => {
    render(<ProbeWithoutHost />);
    expect(screen.getByTestId("probe")).toBeInTheDocument();
    expect(menus()).toHaveLength(0);
    // 快照仍然记下了这次请求：后续挂上宿主就能接上，不需要调用方重试。
    expect(getContextMenuSnapshot()?.items[0]?.key).toBe(FIRST_LABEL);
  });

  it("连续 open 两次只留一份，且是第二次的那份", () => {
    render(<ContextMenuHost />);

    act(() => openContextMenu(options(FIRST_LABEL)));
    expect(menus()).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: FIRST_LABEL })).toBeInTheDocument();

    act(() => openContextMenu(options(SECOND_LABEL)));
    expect(menus()).toHaveLength(1);
    expect(screen.getByRole("menuitem", { name: SECOND_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: FIRST_LABEL })).toBeNull();
  });

  it("替换菜单时保留最后一次的 keepSelection（选区类菜单不能被下一份冲掉）", () => {
    render(<ContextMenuHost />);

    act(() => {
      openContextMenu(options(FIRST_LABEL, { keepSelection: true }));
      openContextMenu(options(SECOND_LABEL, { keepSelection: true }));
    });
    expect(getContextMenuSnapshot()?.keepSelection).toBe(true);

    const menu = document.querySelector<HTMLElement>(".rf-ctx-menu");
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    menu?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("close 之后浮层卸载，快照归零", () => {
    render(<ContextMenuHost />);

    act(() => openContextMenu(options(FIRST_LABEL)));
    expect(menus()).toHaveLength(1);

    act(() => closeContextMenu());
    expect(menus()).toHaveLength(0);
    expect(getContextMenuSnapshot()).toBeNull();
  });

  it("关闭时只回调最后一份的 onClose", () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    render(<ContextMenuHost />);

    act(() => {
      openContextMenu(options(FIRST_LABEL, { onClose: firstClose }));
      openContextMenu(options(SECOND_LABEL, { onClose: secondClose }));
    });
    act(() => closeContextMenu());

    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledTimes(1);

    // 已经关掉了，再关一次不该重复回调。
    act(() => closeContextMenu());
    expect(secondClose).toHaveBeenCalledTimes(1);
  });
});
