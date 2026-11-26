// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑页**左栏「原件」**（T11）：只显示选中那一段所在的页，并把那一段框出来。
 *
 * ## 为什么编辑页也要原件（T11 改口径）
 *
 * 只给"段落清单 + 右侧表单"时，用户改一句话要自己在脑子里回忆"这句话长什么样、
 * 上面下面是什么"，改完还得切到「原件」页签确认没压到别的内容。加一列只读原件、
 * 并把当前块框出来，"我在改哪里"始终在视野里 —— 与 R9-5 的"段落清单是主入口"不冲突：
 * 这一列**不可点**，选块仍然只在清单里进行。
 *
 * ## 为什么只画一页
 *
 * 整份 PDF 逐页画在窄栏里既慢又小。选中块自带 `page`，画那一页就够；翻页由"再选一段"
 * 完成，不另做一套翻页器（那会与「原件」页签的工具栏各说各话）。
 *
 * ## 高亮怎么定位
 *
 * bbox 是 pt、原点在左下角；换算成页面内百分比由 `blockGeometry.blockPercentRect` 负责
 * （唯一一处 y 翻转，已有单测）。百分比定位的好处与旧热区一致：缩放、栏宽变化都不用重算。
 *
 * ## 滚动互不干扰
 *
 * 选中块变化时只让**这一列自己的容器**滚到框住的那一块（`scrollIntoView({block:"nearest"})`），
 * 不碰页面滚动、也不碰右栏表单的滚动位置：改字的上下文不该因为点了另一段而跳走。
 */
import { Alert, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { externalResumeFileUrl } from "../../../api/externalResumes";
import type { ExternalResumeBlock, ExternalResumeDetail } from "../../../api/externalResumes";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { useResolvedTheme } from "../../theme/themeStore";
import { blockPercentRect } from "./blockGeometry";
import { isScannedOriginal, pdfPaintPlan } from "./pdfDark";
import { drawPdfImagesOver, drawPdfPage, usePdfPages } from "./usePdfPages";
import "./externalPreview.css";

export interface ExternalBlockPreviewProps {
  /** 当前详情：URL 要带 `file_id`，否则编辑后会一直画旧 PDF。 */
  record: ExternalResumeDetail;
  /** 选中的块；null = 还没点。 */
  block: ExternalResumeBlock | null;
  /** 页宽 / 页高（pt，来自 `/blocks`）：bbox 换算成百分比要用。 */
  pageWidth: number;
  pageHeight: number;
}

/** PDF 分支：画选中块所在的那一页 + 一个高亮框。 */
function PdfBlockPage({
  record,
  block,
  pageWidth,
  pageHeight,
}: ExternalBlockPreviewProps & { block: ExternalResumeBlock }) {
  const url = `${externalResumeFileUrl(record.id)}?v=${record.file_id}`;
  const pdf = usePdfPages(url);
  const dark = useResolvedTheme() === "dark";
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [painting, setPainting] = useState(true);

  const page = block.page > 0 ? block.page : 1;
  const box = pdf.pages[page - 1];
  const plan = pdfPaintPlan(dark, isScannedOriginal(record.has_text));
  const rect = blockPercentRect(block, { width: pageWidth, height: pageHeight });

  // 重画：换页 / 换主题 / 编辑后换文件都要重画。串行排队的原因同 `ExternalOriginalPreview`
  // （pdf.js 不允许同一 canvas 并发 render）。
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const runRef = useRef(0);
  useEffect(() => {
    const doc = pdf.document;
    const canvas = canvasRef.current;
    if (pdf.status !== "ready" || doc === null || canvas === null || box === undefined) return;
    const run = runRef.current + 1;
    runRef.current = run;
    setPainting(true);
    chainRef.current = chainRef.current
      .then(async () => {
        if (runRef.current !== run) return;
        await drawPdfPage(canvas, doc, box, { background: plan.background, invert: plan.invert });
        if (!plan.imagesOverlay || runRef.current !== run) return;
        await drawPdfImagesOver(canvas, doc, box);
      })
      .catch(() => {
        // 单页画失败不该炸掉整个编辑页：清单与表单仍然可用。
      })
      .finally(() => {
        if (runRef.current === run) setPainting(false);
      });
  }, [pdf.status, pdf.document, pdf.pages, box, plan.background, plan.invert, plan.imagesOverlay]);

  // 换块就把这一列滚到框住的位置：只动自己这一列（见文件头"滚动互不干扰"）。
  //
  // `scrollIntoView` 在 jsdom 里不存在（单测环境没有布局），所以先探一下再做——这不是
  // 为了测试而加的分支：任何"没有布局引擎"的宿主（SSR 快照、打印预览）都会走到这里。
  useEffect(() => {
    const target = boxRef.current;
    if (target === null || typeof target.scrollIntoView !== "function") return;
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [block.block_id, page, pdf.status]);

  if (pdf.status === "error") {
    return <Alert type="warning" showIcon title={t("externalEdit.original.failed")} description={pdf.error} />;
  }
  return (
    <div className="rf-ext-block-page" data-testid="external-block-page">
      <div className={`rf-ext-block-page-canvas${dark ? " is-dark" : ""}`}>
        {pdf.status === "loading" || painting ? (
          <LoadingBlock tip={t("externalEdit.previewLoading")} />
        ) : null}
        <div className="rf-ext-block-page-stack" ref={boxRef}>
          <canvas ref={canvasRef} className="rf-ext-page" data-testid="external-block-canvas" />
          {rect === null ? null : (
            <div
              className="rf-ext-block-highlight"
              data-testid="external-block-highlight"
              style={{
                left: `${rect.left}%`,
                top: `${rect.top}%`,
                width: `${rect.width}%`,
                height: `${rect.height}%`,
              }}
            />
          )}
        </div>
      </div>
      <Typography.Text type="secondary" className="rf-ext-block-page-hint">
        {t("externalEdit.blockPreview.page", { page })}
      </Typography.Text>
    </div>
  );
}

/** 非 PDF（docx / txt / md）：没有纸面坐标，直接把这一段原文框出来。 */
function TextBlockPreview({ block }: { block: ExternalResumeBlock }) {
  return (
    <div className="rf-ext-block-page" data-testid="external-block-text-preview">
      <div className="rf-ext-doc-paper">
        <div className="rf-ext-block-highlight-text" data-testid="external-block-highlight">
          {block.text}
        </div>
        <Typography.Text type="secondary" className="rf-ext-doc-footer">
          {t("externalEdit.blockPreview.textFoot")}
        </Typography.Text>
      </div>
    </div>
  );
}

export function ExternalBlockPreview({ record, block, pageWidth, pageHeight }: ExternalBlockPreviewProps) {
  useLocale();
  if (block === null) {
    return (
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Alert type="info" showIcon title={t("externalEdit.hint.pick")} data-testid="external-block-preview-empty" />
      </Space>
    );
  }
  if (block.page <= 0) return <TextBlockPreview block={block} />;
  return (
    <PdfBlockPage
      record={record}
      block={block}
      pageWidth={pageWidth}
      pageHeight={pageHeight}
    />
  );
}

export default ExternalBlockPreview;
