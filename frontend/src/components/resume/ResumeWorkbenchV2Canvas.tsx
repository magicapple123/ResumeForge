// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台右栏画布（v2）：把"文档变了就重排"接到预览上。
 *
 * 与旧 ResumeWorkbenchLiveCanvas 的差别：内容只有一份（v2 文档，历史 hook 给出），
 * 不再有"宿主已保存 + 草稿 store + overlay"三条来源；草稿就是文档本身。
 * 实时预览的防抖 / 取消 / 滚动位置恢复仍由 useResumeLivePreview 负责（一行未改）。
 */
import { Button, Space, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { renderResume } from "../../api/resumeLayout";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeLayout } from "../../types";
import type { ResumeDocument } from "../../types/resumeDocument";
import { useResumeLivePreview } from "../../features/resume/useResumeLivePreview";
import type { ExactPreviewOptions, ResumePreviewHandle } from "../ResumePreview";
import type { PreviewMode } from "../resume-preview/config";
import ResumeWorkbenchCanvas from "./ResumeWorkbenchCanvas";
import { useDebouncedValue } from "./useDebouncedValue";

/**
 * 精确预览合并窗口（Q05）。
 *
 * 精确预览按**未保存**的正文排 PDF，而 PDF 是服务端排的：每一版都要完整走一次请求 +
 * 查看器重建。中栏每敲一个字都直接当依赖，就是"每键一次排版"。600ms 与草稿画布的
 * 实时预览（`useResumeLivePreview` 的 DEFAULT_DEBOUNCE_MS）取同一个值——两条链路的
 * 合并窗口一致，用户看到的草稿与精确不会一前一后跳。
 */
const EXACT_PREVIEW_DEBOUNCE_MS = 600;

function signatureOf(document: ResumeDocument): string {
  try {
    return JSON.stringify(document);
  } catch {
    return "";
  }
}

export interface ResumeWorkbenchV2CanvasProps {
  html: string;
  warnings: string[];
  pages: number;
  previewRef: RefObject<ResumePreviewHandle | null>;
  previewMode?: PreviewMode;
  onPreviewModeChange?: (mode: PreviewMode) => void;
  exactPreview?: ExactPreviewOptions;
  onPickField?: (path: string) => void;
  document: ResumeDocument | null;
  layout?: ResumeLayout;
  /** 保存（内容或版式）在飞：实时预览让路，别用旧结果盖住保存返回的 html。 */
  suspended?: boolean;
  /** 画布容器节点出口（结构面板向 iframe 注入选中/悬停高亮时要用）。 */
  onContainerReady?: (node: HTMLElement | null) => void;
}

export default function ResumeWorkbenchV2Canvas({
  html,
  warnings,
  pages,
  previewRef,
  previewMode,
  onPreviewModeChange,
  exactPreview,
  onPickField,
  document,
  layout,
  suspended = false,
  onContainerReady,
}: ResumeWorkbenchV2CanvasProps) {
  useLocale();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 容器节点交给宿主（结构面板高亮注入要它）；未挂载时回调 null，避免持有旧 DOM。
  useEffect(() => {
    onContainerReady?.(scrollRef.current);
    return () => onContainerReady?.(null);
  }, [onContainerReady]);
  const [live, setLive] = useState<{ source: string; html: string } | null>(null);
  const runRender = useCallback(
    (next: ResumeDocument, nextLayout: ResumeLayout, signal: AbortSignal) =>
      renderResume(next, nextLayout, signal),
    [],
  );
  const handleHtml = useCallback((next: string) => setLive({ source: html, html: next }), [html]);
  // 精确预览把"还没保存"的正文一起带上（预览与导出一致）。正文先过一层 600ms 合并窗口：
  // 草稿画布那条链路自己会合并击键，精确这条是服务端排版，不合并就是每键一份 PDF。
  const exactDocument = useDebouncedValue(document, EXACT_PREVIEW_DEBOUNCE_MS);
  const exactPreviewWithDraft = useMemo(() => {
    if (!exactPreview || !exactDocument) return exactPreview;
    return {
      ...exactPreview,
      content: exactDocument,
      contentSignature: signatureOf(exactDocument),
    };
  }, [exactDocument, exactPreview]);
  const { state, retry, suspend, resume } = useResumeLivePreview({
    // 精确模式是服务端排的 PDF，不做草稿 html 重排。
    enabled: Boolean(document) && previewMode !== "exact",
    content: document,
    layout,
    render: runRender,
    onHtml: handleHtml,
    scrollRef,
  });
  useSuspension(suspended, suspend, resume);
  const status =
    state === "error" ? (
      <Space size={4}>
        <Typography.Text type="secondary" className="resume-wb-canvas-note">
          {t("rich.preview.stale")}
        </Typography.Text>
        <Button size="small" type="link" onClick={retry}>
          {t("rich.preview.retry")}
        </Button>
      </Space>
    ) : state === "idle" ? null : (
      <Typography.Text type="secondary" className="resume-wb-canvas-note">
        {t("rich.preview.updating")}
      </Typography.Text>
    );
  return (
    <ResumeWorkbenchCanvas
      html={live && live.source === html ? live.html : html}
      warnings={warnings}
      pages={pages}
      previewRef={previewRef}
      previewMode={previewMode}
      onPreviewModeChange={onPreviewModeChange}
      exactPreview={exactPreviewWithDraft}
      onPickField={onPickField}
      scrollRef={scrollRef}
      status={status}
    />
  );
}

function useSuspension(suspended: boolean, suspend: () => void, resume: () => void): void {
  // 与旧画布同一个写法：保存开始挂起、结束交还控制权。
  useEffect(() => {
    if (suspended) suspend();
    else resume();
  }, [resume, suspended, suspend]);
}
