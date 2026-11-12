// SPDX-License-Identifier: Apache-2.0
/**
 * 视口监听器的生命周期。
 *
 * 2026-10-21 的回归：草稿画布在「草稿 / 精确」之间切换时会被卸载再挂载，
 * `containerRef.current` 换成一个全新的 div，而绑定在旧 div 上的 wheel / pointer
 * 监听器随旧元素一起消失。effect 的依赖全是稳定引用（ref、setState），不会重跑——
 * 于是**首次进草稿缩放正常，切到「精确」再切回来就失效**。
 *
 * 这条用例把"视口换代时必须重绑"钉死，顺便确认旧元素上的监听器被摘干净。
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MutableRefObject } from "react";
import { useFrameInteractions } from "./useFrameInteractions";
import type { PanStart } from "./config";

function mount(key: unknown) {
  const containerRef = { current: null as HTMLDivElement | null };
  const panStartRef: MutableRefObject<PanStart | null> = { current: null };
  const onZoomWheel = vi.fn();
  const onPanningChange = vi.fn();

  const view = renderHook(
    (props: { viewportKey: unknown }) =>
      useFrameInteractions({
        containerRef: containerRef as unknown as Parameters<
          typeof useFrameInteractions
        >[0]["containerRef"],
        panStartRef,
        onZoomWheel,
        onPanningChange,
        viewportKey: props.viewportKey,
      }),
    { initialProps: { viewportKey: key } },
  );

  return { ...view, containerRef, onZoomWheel };
}

const wheel = () =>
  new WheelEvent("wheel", { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true });

describe("useFrameInteractions · 视口换代", () => {
  it("依次 草稿 → 精确 → 草稿：新视口必须重新绑上滚轮监听器", () => {
    // 用 "exact" 起步：精确模式下没有草稿画布，视口是 null。
    const { rerender, containerRef, onZoomWheel } = mount("exact");

    // 切到草稿：画布挂载 → ref 指向新 div，key 跟着变 → effect 重跑并绑上。
    const firstCanvas = document.createElement("div");
    containerRef.current = firstCanvas;
    rerender({ viewportKey: "draft" });
    firstCanvas.dispatchEvent(wheel());
    expect(onZoomWheel).toHaveBeenCalledTimes(1);

    // 切回精确：画布卸载 → ref 清空、key 变 → 旧 div 上的监听器必须被摘掉。
    containerRef.current = null;
    rerender({ viewportKey: "exact" });
    firstCanvas.dispatchEvent(wheel());
    expect(onZoomWheel).toHaveBeenCalledTimes(1);

    // 再切回草稿：**换了一个全新的 div**——这正是用户遇到的场景。
    const secondCanvas = document.createElement("div");
    containerRef.current = secondCanvas;
    rerender({ viewportKey: "draft" });
    secondCanvas.dispatchEvent(wheel());
    expect(onZoomWheel).toHaveBeenCalledTimes(2);
  });

  it("视口不变、只有参数重渲染时不会叠加监听器", () => {
    const { rerender, containerRef, onZoomWheel } = mount("exact");
    const canvas = document.createElement("div");
    containerRef.current = canvas;
    rerender({ viewportKey: "draft" });
    // 同一版式下的多次重渲染（父组件状态变化）不应让一次滚轮触发多次回调。
    rerender({ viewportKey: "draft" });
    rerender({ viewportKey: "draft" });

    canvas.dispatchEvent(wheel());
    expect(onZoomWheel).toHaveBeenCalledTimes(1);
  });
});
