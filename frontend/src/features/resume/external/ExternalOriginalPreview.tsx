// SPDX-License-Identifier: Apache-2.0
/**
 * 「原件」页签（R9-4 / R9-7 / R12 / R22）：pdf.js 画布 + 自建工具栏，其余格式交给
 * `ExternalDocumentPreview`。
 *
 * ## 为什么不再用 iframe
 *
 * iframe 里跑的是浏览器自带的 PDF 阅读器：画布与工具栏跟随浏览器/系统主题，CSS 进不去，
 * 暗色下它就是界面里的**一块亮岛**（R12）。改成本项目已有的 `pdfjs-dist` 之后，纸面配色、
 * 工具栏、打印全在自己手里。
 *
 * ## 暗色怎么不把照片一起反色
 *
 * 见 `pdfDark.ts`：反色只包住文字那几笔，`drawImage`（照片 / 扫描件整页图）前后临时关掉
 * 滤镜。扫描件因此整页保持原色，再叠 `brightness(.84)` 压暗，免得成为第二个亮岛。
 *
 * ## 打印
 *
 * `@media print` 会清掉 CSS 滤镜（压暗那一层）。反色是烘进像素的，所以打印前监听
 * `beforeprint` / `afterprint` 重新画一遍不带滤镜的页面 —— `Ctrl+P` 打出来是白纸黑字。
 */
import {
  DownloadOutlined,
  LeftOutlined,
  MinusOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Alert, Button, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { externalResumeFileUrl } from "../../../api/externalResumes";
import type { ExternalResumeDetail } from "../../../api/externalResumes";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { useResolvedTheme } from "../../theme/themeStore";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { fileKindOf } from "../../../utils/fileKind";
import { ExternalDocumentPreview } from "./ExternalDocumentPreview";
import { isScannedOriginal, pdfPaintPlan } from "./pdfDark";
import { drawPdfImagesOver, drawPdfPage, usePdfPages } from "./usePdfPages";
import "./externalPreview.css";

export interface ExternalOriginalPreviewProps {
  /** 当前详情（`file_id` 变了 URL 才会换，编辑后能立刻看到新版）。 */
  record: ExternalResumeDetail;
  /** 预览某一历史版本时给版本 id；不传就是当前版本。 */
  revisionId?: number;
}

/** 缩放档位：只在几个整数档之间跳，避免出现 83.7% 这种读数。 */
const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2];
const DEFAULT_ZOOM_INDEX = 1;

/** 原件字节地址：当前版本带 `?v=file_id`（防浏览器缓存旧 PDF），历史版本走 `?revision_id=`。 */
function originalUrl(record: ExternalResumeDetail, revisionId?: number): string {
  return revisionId == null
    ? `${externalResumeFileUrl(record.id)}?v=${record.file_id}`
    : externalResumeFileUrl(record.id, revisionId);
}

/** PDF：单页 canvas + 工具栏（页码 / 缩放 / 适应宽度 / 下载）。 */
function PdfOriginalViewer({ record, revisionId }: ExternalOriginalPreviewProps) {
  const url = originalUrl(record, revisionId);
  const pdf = usePdfPages(url);
  const dark = useResolvedTheme() === "dark";
  /** 打印态：`beforeprint` 时置真，让页面重画成白纸。 */
  const [printing, setPrinting] = useState(false);
  const [page, setPage] = useState(1);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const scanned = isScannedOriginal(record.has_text);
  const plan = pdfPaintPlan(dark && !printing, scanned);
  const total = pdf.pages.length;

  useEffect(() => {
    const onBefore = () => setPrinting(true);
    const onAfter = () => setPrinting(false);
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  // 换页 / 换缩放 / 换主题都要重画。
  //
  // **必须串行**：pdf.js 不允许同一页在渲染中再开始一次 `render()`（会抛 "Cannot use the
  // same canvas during multiple render() operations" 并留下半张空画布），而 React 在 HMR /
  // 主题切换时很容易连跑两次 effect。所以用一个 promise 链排队，并且只让"最新那次"真的画。
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const runRef = useRef(0);
  useEffect(() => {
    const doc = pdf.document;
    const canvas = canvasRef.current;
    const box = pdf.pages[page - 1];
    if (pdf.status !== "ready" || doc === null || canvas === null || box === undefined) return;
    const target = { ...box, width: box.width * ZOOM_STEPS[zoomIndex] };
    const run = runRef.current + 1;
    runRef.current = run;
    chainRef.current = chainRef.current
      .then(async () => {
        if (runRef.current !== run) return;
        await drawPdfPage(canvas, doc, target, {
          background: plan.background,
          invert: plan.invert,
        });
        // 反色页里照片被反了色：把只有图片的那一块贴回去，照片恢复原样（R22）。
        if (!plan.imagesOverlay || runRef.current !== run) return;
        await drawPdfImagesOver(canvas, doc, target);
      })
      .catch(() => {
        // 单页渲染失败不该炸掉整个弹层：工具栏仍在，用户能翻页或下载原件。
      });
  }, [
    pdf.status,
    pdf.document,
    pdf.pages,
    page,
    zoomIndex,
    plan.background,
    plan.invert,
    plan.imagesOverlay,
  ]);

  const zoomLabel = t("externalEdit.original.zoom", {
    percent: Math.round(ZOOM_STEPS[zoomIndex] * 100),
  });

  return (
    <div className="rf-ext-viewer" data-testid="external-original-viewer">
      <div className="rf-ext-viewer-toolbar" data-testid="external-original-toolbar">
        <Space size={4}>
          <Button
            size="small"
            type="text"
            aria-label={t("externalEdit.original.prev")}
            icon={<LeftOutlined />}
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          />
          <Typography.Text className="rf-ext-viewer-page" data-testid="external-original-pager">
            {t("externalEdit.original.page", {
              page: Math.min(page, Math.max(total, 1)),
              total: Math.max(total, 1),
            })}
          </Typography.Text>
          <Button
            size="small"
            type="text"
            aria-label={t("externalEdit.original.next")}
            icon={<RightOutlined />}
            disabled={page >= total}
            onClick={() => setPage((current) => Math.min(Math.max(total, 1), current + 1))}
          />
        </Space>
        <Space size={4}>
          <Button
            size="small"
            aria-label={t("externalEdit.original.zoomOut")}
            icon={<MinusOutlined />}
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
          />
          <Button
            size="small"
            type="text"
            onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)}
            title={t("externalEdit.original.fitWidth")}
          >
            {t("externalEdit.original.fitWidth")}
          </Button>
          <Button
            size="small"
            aria-label={t("externalEdit.original.zoomIn")}
            icon={<PlusOutlined />}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}
          />
          <Typography.Text type="secondary" data-testid="external-original-zoom">
            {zoomLabel}
          </Typography.Text>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            {t("resumesPage.external.downloadOriginal")}
          </Button>
        </Space>
      </div>
      {pdf.status === "error" ? (
        <Alert
          type="warning"
          showIcon
          title={t("externalEdit.original.failed")}
          description={pdf.error}
        />
      ) : null}
      <div className={`rf-ext-viewer-canvas${dark && !printing ? " is-dark" : ""}`}>
        {pdf.status === "loading" ? (
          <LoadingBlock tip={t("externalEdit.original.loading")} />
        ) : null}
        <div className="rf-ext-page-stack" style={{ width: `${ZOOM_STEPS[zoomIndex] * 100}%` }}>
          <canvas
            ref={canvasRef}
            data-testid="external-original-canvas"
            className={`rf-ext-page${plan.canvasFilter === "none" ? "" : " rf-ext-page--dim"}`}
          />
        </div>
      </div>
      {scanned ? (
        <Typography.Text type="secondary" className="rf-ext-viewer-hint">
          {t("externalEdit.original.scanHint")}
        </Typography.Text>
      ) : null}
    </div>
  );
}

export function ExternalOriginalPreview({ record, revisionId }: ExternalOriginalPreviewProps) {
  useLocale();
  const kind = fileKindOf(record.mime, record.name);
  if (kind === "pdf") return <PdfOriginalViewer record={record} revisionId={revisionId} />;
  return <ExternalDocumentPreview record={record} kind={kind} />;
}

export default ExternalOriginalPreview;
