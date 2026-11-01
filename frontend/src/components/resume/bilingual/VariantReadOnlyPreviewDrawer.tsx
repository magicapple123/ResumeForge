// SPDX-License-Identifier: Apache-2.0
/** Read-only, isolated preview of a language variant using its effective export layout. */
import { Alert, Button, Flex } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { renderResume } from "../../../api/resumeLayout";
import { fetchVariantExportInput } from "../../../features/resume-bilingual/api";
import { bt } from "../../../features/resume-bilingual/i18n";
import type { ResumeLanguage, ResumeLayout } from "../../../types";
import { useLocale } from "../../../i18n/i18nContext";
import LoadingBlock from "../../common/LoadingBlock";

/** #18：Ctrl+滚轮缩放边界（0.5–2.0，步进 10%）。 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;

interface Props {
  open: boolean;
  resumeId: number;
  variantId: number | null;
  fallbackLayout: ResumeLayout;
  onClose: () => void;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function renderLayout(raw: Record<string, unknown>, fallback: ResumeLayout) {
  const pageLimit = Number(raw["page_limit"] ?? fallback.page_limit) || 1;
  const language = raw["language"];
  return {
    template: typeof raw["template"] === "string" ? raw["template"] : fallback.template,
    format_name: typeof raw["format_name"] === "string" ? raw["format_name"] : fallback.format_name,
    page_limit: pageLimit,
    font_scale:
      raw["font_scale"] === "small" ||
      raw["font_scale"] === "standard" ||
      raw["font_scale"] === "large"
        ? raw["font_scale"]
        : fallback.font_scale,
    language:
      language === "zh-CN" || language === "en-US"
        ? (language as ResumeLanguage)
        : fallback.language,
    format_config: record(raw["format_config"]) as ResumeLayout["format_config"],
    document_mode: raw["document_mode"] === "long_cv" || pageLimit > 3 ? "long_cv" : "resume",
  } satisfies Partial<ResumeLayout> & { document_mode: "resume" | "long_cv" };
}

export default function VariantReadOnlyPreviewDrawer({
  open,
  resumeId,
  variantId,
  fallbackLayout,
  onClose,
}: Props) {
  useLocale();
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  // #18：预览缩放（只作用于预览内容，不影响界面其他部分）。
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const handleZoomWheel = useCallback((event: WheelEvent) => {
    // 不按 Ctrl/Meta：交给浏览器默认滚动，不劫持。
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom((prev) =>
      Math.min(
        MAX_ZOOM,
        Math.max(
          MIN_ZOOM,
          Math.round((prev + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)) * 10) / 10,
        ),
      ),
    );
  }, []);

  // 滚动容器上的 Ctrl+滚轮（容器 padding / 未铺满处）。
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !open || !html) return;
    node.addEventListener("wheel", handleZoomWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleZoomWheel);
  }, [handleZoomWheel, html, open]);

  // 关闭抽屉（含 Esc）复位 100%；切换语种/重试时由下方取数流程复位。
  useEffect(() => {
    if (!open) setZoom(1);
  }, [open]);

  useEffect(() => {
    if (!open || variantId === null) return;
    const controller = new AbortController();
    let active = true;
    // effect 体里同步 setState 会触发级联渲染告警：放进微任务（仍在本帧内生效）。
    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setError("");
      setHtml("");
      setZoom(1); // 换语种 / 重试：缩放回到 100%。
    });
    void (async () => {
      try {
        const input = await fetchVariantExportInput(resumeId, variantId, controller.signal);
        const rendered = await renderResume(
          input.content,
          renderLayout(record(input.layout), {
            ...fallbackLayout,
            language: input.language as ResumeLanguage,
          }),
          controller.signal,
        );
        if (active) setHtml(rendered);
      } catch (caught) {
        if (active && !controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : bt("bilingual.preview.failed"));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [fallbackLayout, open, resumeId, retry, variantId]);

  // iframe 是独立文档，滚轮事件不会冒泡到父文档——内容加载后到它的 document 上再绑一份
  // （同 useFrameInteractions 的做法）。srcDoc 换内容时旧文档整体丢弃，无需手动清理。
  const handleFrameLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    event.currentTarget.contentDocument?.addEventListener("wheel", handleZoomWheel, {
      passive: false,
    });
  };

  return open ? (
    <section className="bilingual-variant-preview" aria-label={bt("bilingual.preview.title")}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <strong>{bt("bilingual.preview.title")}</strong>
        <Flex align="center" gap={8}>
          <span className="bilingual-variant-preview-zoom" title={bt("bilingual.preview.zoom")}>
            {Math.round(zoom * 100)}%
          </span>
          <Button size="small" onClick={onClose}>
            {bt("bilingual.preview.close")}
          </Button>
        </Flex>
      </Flex>
      {loading ? (
        <LoadingBlock tip={bt("bilingual.preview.loading")} />
      ) : error ? (
        <Alert
          type="error"
          showIcon
          title={error}
          action={
            <Button onClick={() => setRetry((value) => value + 1)}>
              {bt("bilingual.preview.retry")}
            </Button>
          }
        />
      ) : html ? (
        <div ref={scrollRef} className="bilingual-variant-preview-scroll">
          <iframe
            title={bt("bilingual.preview.title")}
            srcDoc={html}
            sandbox="allow-same-origin"
            onLoad={handleFrameLoad}
            style={{
              width: `${100 / zoom}%`,
              minHeight: "70vh",
              border: 0,
              transform: `scale(${zoom})`,
              transformOrigin: "top center",
            }}
          />
        </div>
      ) : null}
    </section>
  ) : null;
}
