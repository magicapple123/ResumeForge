// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDiscardGuard } from "./useDiscardGuard";

function setup(overrides: Partial<Parameters<typeof useDiscardGuard>[0]> = {}) {
  const onCancel = vi.fn();
  const options = {
    open: true,
    submitting: false,
    dirty: false,
    hasDraft: false,
    onCancel,
    ...overrides,
  };
  const view = renderHook((props: typeof options) => useDiscardGuard(props), {
    initialProps: options,
  });
  return { ...view, onCancel };
}

describe("关闭语义四级", () => {
  it("L0 无脏值：Esc 与 × 都直接关", () => {
    const { result, onCancel } = setup();
    act(() => result.current.requestClose());
    expect(onCancel).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("L1 有草稿：脏值也不问，直接关", () => {
    const { result, onCancel } = setup({ dirty: true, hasDraft: true });
    act(() => result.current.requestClose());
    expect(result.current.confirming).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("L2 脏且无草稿：先出确认条，不关；再按 Esc 回到编辑", () => {
    const { result, onCancel } = setup({ dirty: true });
    act(() => result.current.requestClose());
    expect(result.current.confirming).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.confirming).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("L2 上点「放弃修改」才真的关", () => {
    const { result, onCancel } = setup({ dirty: true });
    act(() => result.current.requestClose());
    act(() => result.current.confirmDiscard());
    expect(result.current.confirming).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("L3 提交中：Esc 与 × 都不关", () => {
    const { result, onCancel } = setup({ dirty: true, submitting: true });
    act(() => result.current.requestClose());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.confirming).toBe(false);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("Esc 的边界", () => {
  it("已 preventDefault 的 Esc 不接管（下拉/日期面板正在用它）", () => {
    const { onCancel } = setup();
    act(() => {
      const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      event.preventDefault();
      document.dispatchEvent(event);
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("非 Esc 键不触发关闭", () => {
    const { onCancel } = setup();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("弹窗关闭后卸载监听：再按 Esc 不会误关别的弹层", () => {
    const { rerender, onCancel } = setup();
    rerender({
      open: false,
      submitting: false,
      dirty: false,
      hasDraft: false,
      onCancel,
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
