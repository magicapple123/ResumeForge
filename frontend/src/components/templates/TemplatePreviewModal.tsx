// SPDX-License-Identifier: Apache-2.0
/** 单个模板的放大预览：可切字号与版式，看的始终是真实渲染结果。 */
import { Alert, Modal, Segmented, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { previewResumeTemplate } from "../../api/resumes";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeFontScale, ResumeFormatPreset, ResumeTemplateDetail } from "../../types";
import A4PreviewFrame from "./A4PreviewFrame";

interface Props {
  template: ResumeTemplateDetail | null;
  formatPresets: ResumeFormatPreset[];
  onClose: () => void;
}

// 只存 key：模块作用域求值 `t()` 会让切语言后停在旧文案。
const FONT_SCALES: { value: ResumeFontScale; labelKey: MessageKey }[] = [
  { value: "small", labelKey: "templatesUi.preview.fontScale.small" },
  { value: "standard", labelKey: "templatesUi.preview.fontScale.standard" },
  { value: "large", labelKey: "templatesUi.preview.fontScale.large" },
];

export default function TemplatePreviewModal({ template, formatPresets, onClose }: Props) {
  useLocale();
  const [fontScale, setFontScale] = useState<ResumeFontScale>("standard");
  const [formatName, setFormatName] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 模板/字号/格式任一变化都重取预览。Compiler 规范：随输入变化的状态重置改到
  // 渲染期「调整状态」模式（守卫式 setState），effect 只保留真正的异步请求。
  const previewKey = `${template?.kind ?? ""}:${template?.id ?? ""}:${template?.name ?? ""}:${fontScale}:${formatName}`;
  const [prevPreviewKey, setPrevPreviewKey] = useState(previewKey);
  if (prevPreviewKey !== previewKey) {
    setPrevPreviewKey(previewKey);
    setLoading(true);
    setError("");
    setHtml("");
  }

  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    void previewResumeTemplate({
      template_id: template.kind === "style" ? template.id : undefined,
      template_name: template.kind === "format" ? "classic" : undefined,
      format_name: template.kind === "format" ? template.name : formatName,
      font_scale: fontScale,
    })
      .then((rendered) => {
        if (!cancelled) setHtml(rendered);
      })
      .catch((err) => {
        if (!cancelled) {
          setHtml("");
          setError(err instanceof Error ? err.message : t("templatesUi.preview.error"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [template, fontScale, formatName, previewKey]);

  const title = template
    ? t("templatesUi.preview.titleWithName", { name: template.name })
    : t("templatesUi.preview.title");

  return (
    <Modal
      title={title}
      open={!!template}
      onCancel={onClose}
      footer={null}
      width="min(1000px, 96vw)"
      styles={{
        body: { maxHeight: "var(--rf-modal-body-max-h)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          size="small"
          value={fontScale}
          options={FONT_SCALES.map(({ value, labelKey }) => ({ value, label: t(labelKey) }))}
          onChange={(value) => setFontScale(value as ResumeFontScale)}
        />
        {template?.kind === "style" ? (
          <Segmented
            size="small"
            value={formatName || ""}
            options={[
              { value: "", label: t("templatesUi.preview.followTemplate") },
              ...formatPresets.map((item) => ({ value: item.name, label: item.label })),
            ]}
            onChange={(value) => setFormatName(String(value))}
          />
        ) : null}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("templatesUi.preview.demoNote")}
        </Typography.Text>
      </Space>
      {error ? (
        <Alert
          type="error"
          showIcon
          title={t("templatesUi.preview.errorTitle")}
          description={error}
        />
      ) : loading ? (
        <div className="template-preview-loading">
          <Spin />
        </div>
      ) : (
        <A4PreviewFrame html={html} title={t("templatesUi.preview.title")} />
      )}
    </Modal>
  );
}
