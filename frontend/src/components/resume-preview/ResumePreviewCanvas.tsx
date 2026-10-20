// SPDX-License-Identifier: Apache-2.0
import { Alert } from "antd";
import type { RefObject } from "react";
import {
  A4_WIDTH_PX,
  APPROXIMATE_PAGINATION_NOTE,
  type InteractionMode,
  OVERFLOW_NOTE,
} from "./config";

interface Props {
  warnings: string[];
  overflow: boolean;
  /** 溢出内容被裁掉（1 页上限）而不是排成第二列：决定提示里说哪一句话。 */
  overflowClipped: boolean;
  pagesNeeded: number;
  pageCount: number;
  overflowAmountText: string;
  interactionMode: InteractionMode;
  isPanning: boolean;
  viewportHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  contentTotalWidth: number;
  contentTotalHeight: number;
  scale: number;
  separatorCount: number;
  totalVisualPages: number;
  /** 页间隙（未缩放 px）＝ 左右页边距之和；两页并排时按 `pageGap × scale` 画分页条。 */
  pageGap: number;
  html: string;
  containerRef: RefObject<HTMLDivElement | null>;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
}

export default function ResumePreviewCanvas({
  warnings,
  overflow,
  overflowClipped,
  pagesNeeded,
  pageCount,
  overflowAmountText,
  interactionMode,
  isPanning,
  viewportHeight,
  scaledWidth,
  scaledHeight,
  contentTotalWidth,
  contentTotalHeight,
  scale,
  separatorCount,
  totalVisualPages,
  pageGap,
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
          title={`按当前设置约需 ${pagesNeeded} 页（上限 ${pageCount} 页）；字号已降到最小，仍然放不下。`}
          description={
            <>
              {overflowAmountText} {overflowClipped ? OVERFLOW_NOTE : APPROXIMATE_PAGINATION_NOTE}
            </>
          }
        />
      )}
      <div
        ref={containerRef}
        className={`resume-preview-viewport${isPanning ? " is-panning" : ""}${interactionMode === "edit" ? " is-editing" : ""}`}
        style={{ height: viewportHeight }}
      >
        <div
          className="resume-preview-scale-box"
          style={{ width: scaledWidth, height: scaledHeight, position: "relative" }}
        >
          <iframe
            ref={iframeRef}
            title="简历预览"
            className="resume-iframe"
            width={contentTotalWidth}
            height={contentTotalHeight}
            srcDoc={html}
            sandbox="allow-same-origin"
            scrolling="no"
            onLoad={onIframeLoad}
            data-interaction-mode={interactionMode}
            style={{
              width: contentTotalWidth,
              height: contentTotalHeight,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
          {Array.from({ length: separatorCount }, (_, index) => {
            const pageNumber = index + 2;
            return (
              // 页间隙：盖住连续纸面的分页处，露出视口底色 + 双侧纸边阴影，
              // 观感是两张并排的独立 A4 纸（替代旧的两点虚线）。间隙压住的是
              // 简历自身的页边距区域，不遮正文。
              <div
                key={pageNumber}
                className="resume-preview-page-separator"
                style={{
                  left: (index + 1) * A4_WIDTH_PX * scale,
                  width: pageGap * scale,
                }}
              >
                <span className="resume-preview-page-separator-line" />
                <span className="resume-preview-page-separator-label">
                  第 {pageNumber} 页 / 共 {totalVisualPages} 页（近似）
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
