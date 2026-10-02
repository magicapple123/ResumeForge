/** 批量选择的纯状态逻辑：入口/退出、勾选、全选本页（跨页保留已选）。 */
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBatchSelection } from "./useBatchSelection";

describe("useBatchSelection", () => {
  it("进入/退出多选，退出时清空已选", () => {
    const { result } = renderHook(() => useBatchSelection<number>());

    act(() => {
      result.current.enterSelecting();
      result.current.toggle(1);
      result.current.toggle(2);
    });
    expect(result.current.selecting).toBe(true);
    expect(result.current.selectedCount).toBe(2);

    act(() => {
      result.current.exitSelecting();
    });
    expect(result.current.selecting).toBe(false);
    expect(result.current.selectedCount).toBe(0);
  });

  it("toggle 勾选与取消", () => {
    const { result } = renderHook(() => useBatchSelection<number>());

    act(() => result.current.toggle(7));
    expect(result.current.isSelected(7)).toBe(true);
    act(() => result.current.toggle(7));
    expect(result.current.isSelected(7)).toBe(false);
  });

  it("toggleAll 对可见批次整体切换，且不影响其他已选（跨页保留）", () => {
    const { result } = renderHook(() => useBatchSelection<number>());

    act(() => {
      result.current.toggle(1); // 上一页勾的
      result.current.toggleAll([2, 3]); // 本页全勾
    });
    expect(result.current.selectedCount).toBe(3);

    act(() => result.current.toggleAll([2, 3])); // 本页全取消，1 保留
    expect(result.current.selectedCount).toBe(1);
    expect(result.current.isSelected(1)).toBe(true);
  });

  it("setSelected 按 Table onChange 语义整体替换", () => {
    const { result } = renderHook(() => useBatchSelection<number>());

    act(() => result.current.toggle(1));
    act(() => result.current.setSelected([9, 8]));
    expect(result.current.selectedCount).toBe(2);
    expect(result.current.isSelected(1)).toBe(false);
    expect(result.current.isSelected(9)).toBe(true);
  });
});
