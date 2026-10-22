// SPDX-License-Identifier: Apache-2.0
import { Alert } from "antd";
import type { RefObject, SyntheticEvent } from "react";
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  APPROXIMATE_PAGINATION_NOTE,
  OVERFLOW_NOTE,
  PAGE_STACK_GAP_PX,
} from "./config";

interface Props {
  warnings: string[];
  overflow: boolean;
  /** 溢出内容被裁掉（1 页上限）而不是排成第二页：决定提示里说哪一句话。 */
  overflowClipped: boolean;
  pagesNeeded: number;
  pageCount: number;
  overflowAmountText: string;
  isPanning: boolean;
  viewportHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  scale: number;
  /** 视觉上要画几张 A4（正文实际需要几页）。 */
  totalVisualPages: number;
  html: string;
  containerRef: RefObject<HTMLDivElement | null>;
  /** 第 1 页的 iframe：版面测量与字号探针都作用在它身上。 */
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: (event: SyntheticEvent<HTMLIFrameElement>, index: number) => void;
}

/**
 * 草稿画布：**每页一张 A4，竖向堆叠**（2026-10-21 用户要求）。
 *
 * 为什么是 N 个 iframe 而不是一个宽 iframe：分页本身仍然靠 CSS 多列——把 body 撑成
 * `N × 794` 宽、`column-count: N`，第 i 列就是第 i 页。横向排完之后，每个 iframe 只开
 * 一个 A4 的窗口并**横向滚动到第 i 列**（`scrollLeft = i × 794`），于是同一份排版结果
 * 被"裁"成 N 张独立的纸，再竖向摞起来。
 *
 * 这样断点口径一点没变（列宽 / 列间距仍按页边距算、`break-inside: avoid` 仍生效），
 * 变的只是观看方式：横向并排要看第 2 页得先横滚，而简历的阅读顺序是从上往下。
 *
 * 代价是同一份 HTML 被渲染 N 次（N ≤ 3）：照片这类内嵌 data URL 会各存一份。换成
 * "一个 iframe + JS 切分 DOM"能省内存，但那要自己复刻浏览器分页，断点必然漂移。
 */
export default function ResumePreviewCanvas({
  warnings,
  overflow,
  overflowClipped,
  pagesNeeded,
  pageCount,
  overflowAmountText,
  isPanning,
  viewportHeight,
  scaledWidth,
  scaledHeight,
  scale,
  totalVisualPages,
  html,
  containerRef,
  iframeRef,
  onIframeLoad,
}: Props) {
  return (
    <>
      {warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="发现以下内容需要人工核对（可能存在 AI 虚构）"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          }
        />
      )}
      {overflow && (
        <Alert
          type="warning"
          showIcon
          className="resume-preview-overflow"
          // 措辞只说事实（约需几页、超了多少），**不再说"字号已降到最小"**：2026-10-21
          // 起不再自动缩字号，装不下就是装不下，改法由用户决定（加页 / 收紧排版 / 删内容）。
          title={`按当前设置约需 ${pagesNeeded} 页（上限 ${pageCount} 页）。`}
          description={
            <>
              字号、行距、页边距都按你设定的值原样渲染，不会自动缩小；{overflowAmountText}
              {overflowClipped ? OVERFLOW_NOTE : APPROXIMATE_PAGINATION_NOTE}
            </>
          }
        />
      )}
      <div
        ref={containerRef}
        className={`resume-preview-viewport${isPanning ? " is-panning" : ""}`}
        style={{ height: viewportHeight }}
      >
        <div
          className="resume-preview-scale-box"
          style={{ width: scaledWidth, height: scaledHeight }}
        >
          <div
            className="resume-preview-pages"
            style={{ gap: PAGE_STACK_GAP_PX, transform: `scale(${scale})` }}
          >
            {Array.from({ length: totalVisualPages }, (_, index) => (
              <div
                key={index}
                className="resume-preview-page"
                style={{ width: A4_WIDTH_PX, height: A4_HEIGHT_PX }}
              >
                <iframe
                  // 第 1 页挂外部 ref：版面测量与"字号 / 行距"探针只需要一份权威结果。
                  ref={index === 0 ? iframeRef : undefined}
                  title={index === 0 ? "简历预览" : `简历预览 第 ${index + 1} 页`}
                  className="resume-iframe"
                  width={A4_WIDTH_PX}
                  height={A4_HEIGHT_PX}
                  srcDoc={html}
                  sandbox="allow-same-origin"
                  scrolling="no"
                  onLoad={(event) => onIframeLoad(event, index)}
                />
                {totalVisualPages > 1 ? (
                  <span className="resume-preview-page-label">
                    第 {index + 1} 页 / 共 {totalVisualPages} 页（近似）
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
