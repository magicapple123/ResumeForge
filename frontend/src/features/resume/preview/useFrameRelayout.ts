// SPDX-License-Identifier: Apache-2.0
/**
 * 报告回来后**重排已有的纸**（问题 3）。
 *
 * 纸张数由页数（服务端报告的 `pages_needed` 优先）决定，而报告是异步到的：先到的那一版
 * 只有浏览器测量（28 号是 7 列），报告说 8 页时第五~八张纸是新挂载的（`onLoad` 自然会跑
 * 一遍 `layoutFrame`），但前七张是**复用的同一个 DOM**——它们的 `column-count` 还停在上一次
 * 的 7。不重排的话每张纸显示的还是"7 列里的那一列"，最后一张空白、第七张内容错位。
 *
 * 这里按 DOM 顺序重排全部 iframe（`applyLayout` 对 index > 0 会顺便滚到自己的列）。
 * 跳过还在解析的文档（`childElementCount === 0`）：那种文档量不到东西，写了也白写，而且
 * 会拿一个空测量值把状态冲掉——真正的排版由它自己的 `onLoad` 负责。
 *
 * 为什么单独成文件：`ResumePreview.tsx` 贴着 500 行预算，这段是"跟着画布 DOM 走"的独立
 * 关注点（与测量、缩放、模式切换都无关），搬出来反而更容易读。
 */
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export interface FrameRelayoutOptions {
  /** 画布视口（`.resume-preview-viewport`）：全部页 iframe 都在它下面。 */
  containerRef: RefObject<HTMLDivElement | null>;
  /** 把一个 iframe 重新排一遍（`ResumePreview` 里的 `applyLayoutToFrame`）。 */
  applyLayout: (frame: HTMLIFrameElement, index: number) => void;
  /** 用户设定的页数上限（变了也要重排：列数随之变）。 */
  pageLimit: number;
  /** 服务端报告给出的页数；`null` = 没有报告（此时不必单独重排，测量与列数没变）。 */
  reportedPages: number | null;
}

export function useFrameRelayout({
  containerRef,
  applyLayout,
  pageLimit,
  reportedPages,
}: FrameRelayoutOptions): void {
  // 走 ref 而不是把 `applyLayout` 放进依赖：它的身份会随 `onLayoutStatus` / `onMeasure`
  // 这些宿主回调一起变（宿主常常内联箭头函数），放进依赖会让这段在每次渲染后都跑一遍。
  const applyRef = useRef(applyLayout);
  useEffect(() => {
    applyRef.current = applyLayout;
  }, [applyLayout]);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const frames = Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe.resume-iframe"));
    frames.forEach((frame, index) => {
      const document = frame.contentDocument;
      if (!document?.body || document.body.childElementCount === 0) return;
      applyRef.current(frame, index);
    });
  }, [containerRef, pageLimit, reportedPages]);
}
