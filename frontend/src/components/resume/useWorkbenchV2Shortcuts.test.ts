// SPDX-License-Identifier: Apache-2.0
/** Q03：制作台键盘撤销/恢复接到全站快捷键体系（一次按键 = 历史栈一步）。 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getShortcutHandlerCount, runShortcut } from "../../features/shortcuts/useShortcutKeymap";
import { useWorkbenchV2Shortcuts } from "./useWorkbenchV2Shortcuts";

function keydown(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
}

describe("useWorkbenchV2Shortcuts", () => {
  it("注册 undo/redo，一次快捷键调用一次历史", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const { unmount } = renderHook(() => useWorkbenchV2Shortcuts({ undo, redo }));
    expect(getShortcutHandlerCount("undo")).toBe(1);
    expect(getShortcutHandlerCount("redo")).toBe(1);
    expect(runShortcut("undo", keydown())).toBe(true);
    expect(runShortcut("redo", keydown())).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
    unmount();
    expect(getShortcutHandlerCount("undo")).toBe(0);
    expect(getShortcutHandlerCount("redo")).toBe(0);
  });

  it("enabled=false 时不注册（只读宿主不受影响）", () => {
    const { unmount } = renderHook(() =>
      useWorkbenchV2Shortcuts({ undo: vi.fn(), redo: vi.fn(), enabled: false }),
    );
    expect(getShortcutHandlerCount("undo")).toBe(0);
    expect(getShortcutHandlerCount("redo")).toBe(0);
    unmount();
  });
});
