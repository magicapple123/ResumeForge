// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览**可见层 iframe 的加载兜底**（Q18，从 `ExactPreviewPanel.tsx` 拆出）。
 *
 * 内嵌 PDF 查看器（Chromium 自带）在某些环境/策略下不会触发 `onLoad`：改完之后用户看到的是
 * 一块空白，而请求其实已经成功。约定：**8 秒内没有 onLoad 就判定这一帧没起来**，交给
 * `ExactNoViewer`（在新标签打开）兜底，而不是留空白等人发现。
 *
 * 两个容易写错的点（都在这里收口）：
 * 1. 用 **frameKey** 而不是布尔值记录超时——换一版 PDF / 换一档缩放 key 就变了，状态天然复位，
 *    不需要在 effect 里同步 setState；
 * 2. `onLoad` 到达后定时器可能还会响一次，所以用 ref 记"这一帧已经加载过"，到点时放行。
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 可见层 iframe 的加载兜底（Q18）：超过这个时间还没 onLoad，就判定内嵌查看器没起来。
 * 8s 是正常 PDF（1–3 页）首次加载的若干倍，不会把慢机器误判成失败。
 */
export const FRAME_LOAD_TIMEOUT_MS = 8000;

export interface FrameLoadStall {
  /** 当前这一帧是不是超时了（换 key 自动复位）。 */
  stalled: boolean;
  /** 挂到可见层 iframe 的 `onLoad`：清掉兜底状态。 */
  handleLoaded: () => void;
}

export function useFrameLoadStall(frameKey: string | null, enabled = true): FrameLoadStall {
  const [stalledKey, setStalledKey] = useState<string | null>(null);
  const loadedFrameRef = useRef<string | null>(null);

  const handleLoaded = useCallback(() => {
    loadedFrameRef.current = frameKey;
    setStalledKey(null);
  }, [frameKey]);

  useEffect(() => {
    if (!enabled || frameKey === null) return;
    const timer = setTimeout(() => {
      if (loadedFrameRef.current === frameKey) return;
      setStalledKey(frameKey);
    }, FRAME_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [enabled, frameKey]);

  return { stalled: frameKey !== null && stalledKey === frameKey, handleLoaded };
}
