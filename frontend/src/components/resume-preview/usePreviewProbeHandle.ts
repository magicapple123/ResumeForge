// SPDX-License-Identifier: Apache-2.0
/**
 * 预览的**命令式测量接口**（从 `ResumePreview.tsx` 拆出，文件行预算）。
 *
 * 两个方法都作用于**第 1 页的 iframe**（那是版面测量与字号/行距探针的唯一权威来源）：
 * - `measureWithProbe(css)`：「版面诊断 → 自动一页」逐档试版式时，临时注入一段 CSS、
 *   量一次版面，再把样式**原样还原**（试完不能把预览留在试版式的状态）；
 * - `setLiveProbe(css)`：拖字号/行距滑杆时的实时探针样式，空串 = 移除。
 *
 * 与拆分前逐字一致；单独成 hook 是因为这段只有"操作 iframe 文档"一件事，与缩放/口径/
 * 渲染都无关，放在组件里会挤掉真正属于组件的那部分。
 */
import { useImperativeHandle } from "react";
import type { ForwardedRef, RefObject } from "react";
import { measureResumeLayout } from "../../utils/resumeLayoutMeasure";
import { LIVE_PROBE_STYLE_ID, PROBE_STYLE_ID, type ResumePreviewHandle } from "./config";

export function usePreviewProbeHandle(
  ref: ForwardedRef<ResumePreviewHandle>,
  iframeRef: RefObject<HTMLIFrameElement | null>,
  pageCount: number,
): void {
  useImperativeHandle(
    ref,
    () => ({
      measureWithProbe(css: string) {
        const document = iframeRef.current?.contentDocument;
        if (!document?.body) return null;
        const style = document.getElementById("resume-preview-style") as HTMLStyleElement | null;
        const previousLayoutCss = style?.textContent ?? null;
        if (style) style.textContent = "";
        document.getElementById(PROBE_STYLE_ID)?.remove();
        if (css) {
          const probe = document.createElement("style");
          probe.id = PROBE_STYLE_ID;
          probe.textContent = css;
          document.head.appendChild(probe);
        }
        try {
          void document.body.offsetHeight;
          return measureResumeLayout(document, pageCount);
        } finally {
          if (css) document.getElementById(PROBE_STYLE_ID)?.remove();
          if (style && previousLayoutCss !== null) style.textContent = previousLayoutCss;
        }
      },
      setLiveProbe(css: string) {
        const document = iframeRef.current?.contentDocument;
        const head = document?.head;
        if (!document || !head) return;
        const existing = document.getElementById(LIVE_PROBE_STYLE_ID) as HTMLStyleElement | null;
        if (!css) {
          existing?.remove();
          return;
        }
        const style = existing ?? document.createElement("style");
        style.id = LIVE_PROBE_STYLE_ID;
        style.textContent = css;
        if (!existing) head.appendChild(style);
      },
    }),
    [iframeRef, pageCount],
  );
}
