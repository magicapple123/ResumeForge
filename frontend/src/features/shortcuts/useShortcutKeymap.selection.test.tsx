// SPDX-License-Identifier: Apache-2.0
/**
 * 选区与全局搜索共用一个快捷键派发器：有选中文字开选区面板，没有选中开搜索；搜索球体
 * 被禁用时退回搜索。两者不能同时打开。
 *
 * 守的是「同一个键只能有一个赢家」：两个面板同时弹出时，用户按 Esc 都不知道先关哪个。
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShortcut, useShortcutKeymap } from "./useShortcutKeymap";

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

function selectText() {
  const text = document.createTextNode("selected resume text");
  document.body.append(text);
  const range = document.createRange();
  range.selectNodeContents(text);
  window.getSelection()?.addRange(range);
}

function Harness({
  search,
  panel,
  enabled = true,
}: {
  search: () => void;
  panel: () => void;
  enabled?: boolean;
}) {
  useShortcutKeymap();
  useShortcut("search", search);
  useShortcut("selectionPanel", panel, enabled);
  return null;
}

describe("selection and global search share one shortcut dispatcher", () => {
  it("opens only the selection panel when text is selected", () => {
    const search = vi.fn();
    const panel = vi.fn();
    render(<Harness search={search} panel={panel} />);
    selectText();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(panel).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
  });

  it("opens only search without a selection", () => {
    const search = vi.fn();
    const panel = vi.fn();
    render(<Harness search={search} panel={panel} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(search).toHaveBeenCalledTimes(1);
    expect(panel).not.toHaveBeenCalled();
  });

  it("falls back to search with a selection when the orb is disabled", () => {
    const search = vi.fn();
    const panel = vi.fn();
    render(<Harness search={search} panel={panel} enabled={false} />);
    selectText();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(search).toHaveBeenCalledTimes(1);
    expect(panel).not.toHaveBeenCalled();
  });
});
