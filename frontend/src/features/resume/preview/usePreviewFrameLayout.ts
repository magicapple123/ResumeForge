// SPDX-License-Identifier: Apache-2.0
/**
 * Frame layout applier of the resume preview: paginate ONE iframe and report the
 * first page's measurements. Split out of `./ResumePreview.tsx` to keep both files
 * under the line budget; pure move, no behaviour change.
 */
import { useCallback, useState } from "react";
import type { LayoutMeasure } from "../../../utils/resumeLayoutMeasure";
import { A4_WIDTH_PX, type PreviewLayoutStatus } from "./config";
import { layoutFrame } from "./layout";

interface Options {
  pageLimit: number;
  paperHeight: number;
  reportedPages: number | null;
  onLayoutStatus?: (status: PreviewLayoutStatus) => void;
  onMeasure?: (measure: LayoutMeasure) => void;
}

export function usePreviewFrameLayout({
  pageLimit,
  paperHeight,
  reportedPages,
  onLayoutStatus,
  onMeasure,
}: Options) {
  const [measure, setMeasure] = useState<LayoutMeasure | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState(A4_WIDTH_PX);

  /**
   * 对**一个** iframe 应用分页样式，并把它滚到第 `index` 列。
   *
   * 每个 iframe 都是同一份 HTML 的独立文档：`layoutFrame` 会把 body 撑成 `页数 × 794`
   * 宽、切成对应数量的列，然后这个 iframe 只开一个 A4 的窗口、横向滚到第 index 列。
   * 所以"第 i 页"= 同一份排版的第 i 列，断点口径与横向并排时**完全一致**。
   *
   * 每页都跑一次测量是刻意的：只有第 1 页上报状态（`index === 0`），但每页都得拿到
   * 同一份列宽 / 列间距——否则某一页的列宽算错，那一页就会显示成"上一列的尾巴"。
   */
  const applyLayoutToFrame = useCallback(
    (frame: HTMLIFrameElement, index: number) => {
      const document = frame.contentDocument;
      if (!document?.body || !document.documentElement) return;
      const result = layoutFrame({ document, pageLimit, paperHeight, reportedPages });
      if (!result) return;
      if (index === 0) {
        if (result.measure) {
          setMeasure(result.measure);
          onMeasure?.(result.measure);
        }
        setOverflow(result.overflow);
        setNaturalWidth(result.naturalWidth);
        onLayoutStatus?.({
          pages: pageLimit,
          overflow: result.overflow,
          pagesNeeded: result.pagesNeeded,
          pagesRendered: result.visualPages,
        });
      }
      // `overflow: hidden` 的文档仍然可以编程滚动（只是不给用户拖滚动条）。
      //
      // **只保留一个滚动出口**（问题 1）：`columnsCss()` 给 `html,body` 都写了
      // `overflow: hidden`，于是 `body` 自身也是一个横向滚动容器（`scrollWidth` 是整份
      // 多列排版的宽度）。`overflow: hidden` 只是不给用户拖滚动条，**不阻止编程滚动**——
      // 之前这里同时写 `documentElement.scrollLeft` 与 `body.scrollLeft`，两次位移叠加，
      // 第 i 页实际偏移变成 `2 × i × 794`，于是第 2 列（项目经历…）与第 4 列从来没有
      // 任何一页在显示。`window.scrollTo()` 滚的也是 `documentElement`，与上面那行等价，
      // 一并收敛成一行，避免以后再出现"两个出口"。
      if (index > 0) {
        document.documentElement.scrollLeft = index * A4_WIDTH_PX;
      }
    },
    [onLayoutStatus, onMeasure, pageLimit, paperHeight, reportedPages],
  );

  return { measure, overflow, naturalWidth, applyLayoutToFrame };
}
