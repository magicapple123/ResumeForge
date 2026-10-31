// SPDX-License-Identifier: Apache-2.0
/**
 * 读原图的像素尺寸（裁剪清晰度提示用，D09）。
 *
 * 为什么不在 UI 里内联 `new Image()`：jsdom 不解码图片、真实浏览器是异步回调，两边
 * 都要求"组件卸载后丢弃迟到结果"。集中成一个 hook 后，测试可以 `vi.mock` 这个模块，
 * 不必伪造 Image 实现。
 */
import { useEffect, useState } from "react";

export interface PhotoDimensions {
  width: number;
  height: number;
}

/** 解码 data URL 得到原图像素尺寸；失败（损坏 / 非图片）返回 `null`。 */
export function usePhotoDimensions(dataUrl: string | null | undefined): PhotoDimensions | null {
  const [size, setSize] = useState<PhotoDimensions | null>(null);
  // 换图先清尺寸：渲染期对齐（不在 effect 里同步 setState，旧尺寸也不会挂在新图上）。
  const [activeDataUrl, setActiveDataUrl] = useState<string | null>(dataUrl ?? null);
  if ((dataUrl ?? null) !== activeDataUrl) {
    setActiveDataUrl(dataUrl ?? null);
    setSize(null);
  }

  useEffect(() => {
    if (!dataUrl) return undefined;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setSize({ width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    image.onerror = () => {
      if (!cancelled) setSize(null);
    };
    image.src = dataUrl;
    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [dataUrl]);

  return size;
}
