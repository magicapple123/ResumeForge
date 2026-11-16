// SPDX-License-Identifier: Apache-2.0
/**
 * 选区与全局搜索共用一个快捷键派发器：有选中文字开选区面板，没有选中开搜索；搜索球体
 * 被禁用时退回搜索。两者不能同时打开。
 *
 * 守的是「同一个键只能有一个赢家」：两个面板同时弹出时，用户按 Esc 都不知道先关哪个。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

/**
 * I-18 验收 ③：`Alt+H`（提示模式）在输入框里**不能**触发。
 *
 * 用户正在 textarea 里写字时按 `Alt+H` 的意图是输入字符/系统组合，而不是"把整页说明
 * 铺开"——铺开还会把光标所在的位置顶走。守卫与 undo/redo 共用 `isEditableTarget`。
 */
describe("hint mode shortcut respects editable targets", () => {
  function HelpHarness({ toggle }: { toggle: () => void }) {
    useShortcutKeymap();
    useShortcut("showHints", toggle);
    return <input aria-label="sample-field" />;
  }

  it("does not toggle while focus is inside an input", () => {
    const toggle = vi.fn();
    render(<HelpHarness toggle={toggle} />);
    const input = screen.getByRole("textbox", { name: "sample-field" });
    input.focus();
    fireEvent.keyDown(input, { key: "h", altKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });

  it("toggles when focus is not in an editable element", () => {
    const toggle = vi.fn();
    render(<HelpHarness toggle={toggle} />);
    fireEvent.keyDown(window, { key: "h", altKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
