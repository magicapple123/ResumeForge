// SPDX-License-Identifier: Apache-2.0
/**
 * 把一个快速变化的值压成"停下来之后的那一版"（尾随防抖）。
 *
 * 用途（Q05，2026-10-31）：制作台右栏的**精确预览**要按未保存的正文排 PDF。中栏每敲一个字
 * 都会产生一份新文档；直接当请求依赖就是"每个键一次服务端排版"。草稿画布那条链路已有
 * 自己的 600ms 防抖（`useResumeLivePreview`），这里给另一条链路同样的合并窗口。
 *
 * 首帧立即返回传入值：打开制作台时宿主刚渲染过同一份内容，再等 600ms 只会让精确预览
 * 平白晚一拍出现。之后每次变化都在 `delayMs` 内合并，最后那一版赢。
 */
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (!(delayMs > 0)) return;
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
