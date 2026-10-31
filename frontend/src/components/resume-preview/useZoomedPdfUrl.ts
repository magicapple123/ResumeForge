// SPDX-License-Identifier: Apache-2.0
/**
 * 缩放档位对应的 PDF objectURL（Q18）。
 *
 * 背景：Chromium 只认 `#zoom=<百分比>`，而且**同一个文档只改 hash 不会重新读参数**，所以
 * 每换一档缩放都得拿同一份字节再造一个 objectURL。旧实现把这个 URL 放在 `useMemo`（渲染期）
 * 创建、再用 effect 的 cleanup 释放——React StrictMode 下 effect 会「挂载 → 清理 → 再挂载」，
 * 清理那一拍恰好把**已经挂到 iframe 上的 URL** revoke 掉，于是精确预览整块空白；打开 F12
 * 触发一次尺寸变化、重建 URL 才"复活"（2026-10-31 用户实测的 Q18）。
 *
 * 现在的契约：
 * 1. **渲染期绝不创建 URL**：只在 effect 的定时器里创建，结果进 state；
 * 2. URL 登记进面板的 `urlsRef`（`keep`），由面板单点释放（宿主卸载 / 换成新图时）；
 * 3. 这一档换下一档时，本 hook 只释放**自己创建的上一个** URL，绝不碰 shot 自身的
 *    `url`（那份还被「在新标签打开」与无查看器兜底用着）；
 * 4. `pct === null` 表示"不缩放"：返回 null，iframe 退回 shot.url 的 `#zoom=page-width`，
 *    不额外造 URL。
 */
import { useEffect, useRef, useState } from "react";
import { zoomedPdfUrl } from "./pdfViewerSupport";

export function useZoomedPdfUrl(
  shot: { url: string; blob: Blob } | null,
  pct: number | null,
  keep: (url: string) => string,
  release: (url: string | null) => void,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const previousRef = useRef<string | null>(null);

  useEffect(() => {
    // setState 挪到定时器里：effect body 同步 setState 会触级联渲染（项目 lint 规则）。
    const timer = window.setTimeout(() => {
      const next = shot && pct !== null ? keep(zoomedPdfUrl(shot, pct)) : null;
      setUrl(next);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [shot, pct, keep]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = url;
    if (previous && previous !== url) release(previous);
  }, [release, url]);

  return url;
}
