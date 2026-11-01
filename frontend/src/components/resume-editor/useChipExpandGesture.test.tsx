// SPDX-License-Identifier: Apache-2.0
/** #8 手势判定：单击选中 / 双击展开收起 / 连续第二组双击 / dblclick 去重。 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { describe, expect, it } from "vitest";
import { DocumentExpandContext } from "./documentExpandContext";
import { useChipExpandGesture, type ChipExpandGesture } from "./useChipExpandGesture";

const PATH = "a.b.c";

interface HostProps {
  children: ReactNode;
}

/** 展开态宿主：用真实 context 提供 expandedPath / toggleExpand / setExpanded。 */
function Host({ children }: HostProps) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const host = useMemo(
    () => ({
      expandedPath,
      toggleExpand: (target: string) =>
        setExpandedPath((current) => (current === target ? null : target)),
      setExpanded: (target: string | null) => setExpandedPath(target),
    }),
    [expandedPath],
  );
  return <DocumentExpandContext.Provider value={host}>{children}</DocumentExpandContext.Provider>;
}

function setup() {
  // 普通可变对象：这里在组件外收集 hook 的回调结果，不能用 useRef（会脱离 React 渲染上下文）。
  const selected: { current: string | null } = { current: null };
  const rendered = renderHook(
    () =>
      useChipExpandGesture(PATH, (target) => {
        selected.current = target;
      }) as ChipExpandGesture,
    { wrapper: Host },
  );
  return { gesture: () => rendered.result.current, selected };
}

describe("useChipExpandGesture #8", () => {
  it("干净双击：第一下不消费（交给单击选中），第二下展开", () => {
    const { gesture, selected } = setup();
    let first = true;
    act(() => {
      first = gesture().consumePairSecondClick(1);
    });
    expect(first).toBe(false);
    act(() => {
      gesture().consumePairSecondClick(2);
    });
    expect(selected.current).toBe(PATH);
  });

  it("已展开时再双击：第二下保持收起（不会先被 select 清空再 toggle 弹开）", () => {
    const { gesture } = setup();
    act(() => {
      gesture().setExpanded(PATH);
    });
    expect(gesture().expanded).toBe(true);
    act(() => {
      gesture().consumePairSecondClick(1);
    });
    act(() => {
      gesture().consumePairSecondClick(2);
    });
    expect(gesture().expanded).toBe(false);
  });

  it("已展开时立刻再双击（浏览器连击计数 3/4）：第二组仍能收起", () => {
    const { gesture } = setup();
    act(() => {
      gesture().setExpanded(PATH);
    });
    let consumed = false;
    act(() => {
      consumed = gesture().consumePairSecondClick(3);
    });
    expect(consumed).toBe(true);
    expect(gesture().expanded).toBe(true);
    act(() => {
      gesture().consumePairSecondClick(4);
    });
    expect(gesture().expanded).toBe(false);
  });

  it("同一手势随后送来的 dblclick 只清标记，不再 toggle", () => {
    const { gesture } = setup();
    act(() => {
      gesture().consumePairSecondClick(1);
    });
    act(() => {
      gesture().consumePairSecondClick(2);
    });
    expect(gesture().expanded).toBe(true);
    act(() => {
      gesture().handleDoubleClick();
    });
    expect(gesture().expanded).toBe(true);
  });

  it("只有 dblclick（旧引擎/测试工具）时仍能展开，F2 走独立通道", () => {
    const { gesture } = setup();
    act(() => {
      gesture().handleDoubleClick();
    });
    expect(gesture().expanded).toBe(true);
    act(() => {
      gesture().toggleFromKeyboard();
    });
    expect(gesture().expanded).toBe(false);
  });
});
