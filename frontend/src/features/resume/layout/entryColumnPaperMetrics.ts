// SPDX-License-Identifier: Apache-2.0
/**
 * 从预览 iframe 里读纸张的「实际字号」与「内容宽」（分栏控件的 mm↔% 换算要用）。
 *
 * 遍历所有 canvas iframe：先加载的那一帧可能还是空文档，读不到就继续找下一帧；跨域/未加载
 * 的帧直接跳过——控件宁可暂时禁用（算不出 mm），也不要拿 0 去换算。
 */

export interface PaperMetrics {
  font: number | null;
  content: number | null;
}

export function readPaperMetrics(): PaperMetrics {
  const metrics: PaperMetrics = { font: null, content: null };
  const frames = document.querySelectorAll<HTMLIFrameElement>(".resume-wb-canvas iframe");
  for (const frame of frames) {
    try {
      const doc = frame.contentDocument;
      if (!doc) continue;
      if (metrics.font === null) {
        const px = Number.parseFloat(
          getComputedStyle(doc.documentElement).getPropertyValue("--fs"),
        );
        if (Number.isFinite(px) && px > 0) metrics.font = px;
      }
      if (metrics.content === null) {
        const row =
          doc.querySelector<HTMLElement>(".entry .sub-row") ??
          doc.querySelector<HTMLElement>(".entry");
        const width = row?.getBoundingClientRect().width ?? 0;
        if (width > 0) metrics.content = width;
      }
      if (metrics.font !== null && metrics.content !== null) return metrics;
    } catch {
      // An unloaded or cross-origin frame may be followed by the active canvas.
    }
  }
  return metrics;
}
