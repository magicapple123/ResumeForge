// SPDX-License-Identifier: Apache-2.0
/** Read-only, isolated preview of a language variant using its effective export layout. */
import { Alert, Button, Flex } from "antd";
import { useEffect, useState } from "react";
import { renderResume } from "../../../api/resumeLayout";
import { fetchVariantExportInput } from "../../../features/resume-bilingual/api";
import { bt } from "../../../features/resume-bilingual/i18n";
import type { ResumeLanguage, ResumeLayout } from "../../../types";
import { useLocale } from "../../../i18n/i18nContext";
import LoadingBlock from "../../common/LoadingBlock";

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

  return open ? (
    <section className="bilingual-variant-preview" aria-label={bt("bilingual.preview.title")}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <strong>{bt("bilingual.preview.title")}</strong>
        <Button size="small" onClick={onClose}>
          {bt("bilingual.preview.close")}
        </Button>
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
        <iframe
          title={bt("bilingual.preview.title")}
          srcDoc={html}
          sandbox="allow-same-origin"
          style={{ width: "100%", minHeight: "70vh", border: 0 }}
        />
      ) : null}
    </section>
  ) : null;
}
