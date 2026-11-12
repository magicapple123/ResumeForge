// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的**相框测量**：宽度（决定页宽与请求分辨率）与设备像素比。
 *
 * 为什么不用 `window.resize`：中栏分隔条可以拖动，窗口尺寸一点没变，变的只是这一块的
 * 宽度。`ResizeObserver` 是唯一能看见"容器自己变宽"的接口。
 *
 * 为什么第一枪是异步的：`observe()` 之后由观察器自己投递回调，所以不存在"effect 体里
 * 同步 setState"（项目有 `react-hooks/set-state-in-effect`）。
 *
 * 宽度量不到的三种情况：首次布局前、面板在 `hidden` 容器里（草稿模式）、jsdom
 * （`src/test/setup.ts` 的 `ResizeObserverMock` 只占位、不投递回调）。此时返回 `0`，
 * 由调用方回落到 A4 宽——**绝不**自己编一个"看起来差不多"的数（那会让请求分辨率与
 * 屏幕上的纸宽对不上）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export interface PreviewFrame {
  /** 挂到相框元素上（`.exact-preview`）。 */
  frameRef: RefObject<HTMLDivElement | null>;
  /** 相框的实测内容宽（0 = 还没量到）。 */
  frameWidth: number;
}

/**
 * 量出相框的内容宽。
 *
 * 读 `contentRect.width` 而不是 `clientWidth`：后者会被滚动条宽度影响，而我们正是在
 * 决定"要不要出滚动条"的那一层——拿被滚动条污染的数去算会自激。
 */
export function usePreviewFrame(): PreviewFrame {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setFrameWidth(width > 0 ? width : 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { frameRef, frameWidth };
}

/**
 * 设备像素比（位图分辨率的一半依据）。
 *
 * 只在挂载与 `resize` 时读：dpr 变化基本只有两种来源——拖到另一块屏幕、或改系统缩放，
 * 两种都会顺带触发一次 `resize`。用 `matchMedia` 逐档监听会在缩放连续变化时抖出一串
 * 重排请求，而位图分辨率对这点抖动完全不敏感（服务端还按 0.25 分桶）。
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => {
    if (typeof window === "undefined") return 1;
    const value = window.devicePixelRatio;
    return value > 0 ? value : 1;
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const sync = () => {
      const value = window.devicePixelRatio;
      setDpr(value > 0 ? value : 1);
    };
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  return dpr;
}
