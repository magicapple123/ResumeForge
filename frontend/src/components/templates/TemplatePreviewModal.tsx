/** 单个模板的放大预览：可切字号与版式，看的始终是真实渲染结果。 */
import { Alert, Modal, Segmented, Space, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import { previewResumeTemplate } from "../../api/resumes";
import type {
  ResumeFontScale,
  ResumeFormatConfig,
  ResumeFormatPreset,
  ResumeTemplateDetail,
} from "../../types";
import A4PreviewFrame from "./A4PreviewFrame";

/** 场景预设直预（模板市场用）：预设自带完整的样式/版式/字号组合，不提供切换器。 */
export interface TemplatePresetPreview {
  title: string;
  templateName: string;
  formatName: string;
  formatConfig?: ResumeFormatConfig;
  fontScale: ResumeFontScale;
  pageLimit?: number;
}

interface Props {
  template: ResumeTemplateDetail | null;
  formatPresets: ResumeFormatPreset[];
  onClose: () => void;
  /** 传入时走预设预览（组合固定），``template`` 被忽略——两路共用同一个弹窗组件。 */
  preset?: TemplatePresetPreview | null;
}

const FONT_SCALES: { value: ResumeFontScale; label: string }[] = [
  { value: "small", label: "小字号" },
  { value: "standard", label: "标准" },
  { value: "large", label: "大字号" },
];

export default function TemplatePreviewModal({ template, formatPresets, onClose, preset }: Props) {
  const [fontScale, setFontScale] = useState<ResumeFontScale>("standard");
  const [formatName, setFormatName] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const active = preset ?? template;
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setHtml("");
    const request = preset
      ? {
          template_name: preset.templateName,
          format_name: preset.formatName,
          format_config: preset.formatConfig,
          font_scale: preset.fontScale,
          page_limit: preset.pageLimit,
        }
      : {
          template_id: template?.kind === "style" ? template.id : undefined,
          template_name: template?.kind === "format" ? "classic" : undefined,
          format_name: template?.kind === "format" ? template.name : formatName,
          font_scale: fontScale,
        };
    void previewResumeTemplate(request)
      .then((rendered) => {
        if (!cancelled) setHtml(rendered);
      })
      .catch((err) => {
        if (!cancelled) {
          setHtml("");
          setError(err instanceof Error ? err.message : "预览失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preset, template, fontScale, formatName]);

  const title = preset ? preset.title : template ? `模板预览 · ${template.name}` : "模板预览";

  return (
    <Modal
      title={title}
      open={!!template || !!preset}
      onCancel={onClose}
      footer={null}
      width="min(1000px, 96vw)"
      styles={{
        body: { maxHeight: "calc(100vh - 200px)", overflowY: "auto", overflowX: "hidden" },
      }}
      destroyOnHidden
    >
      {!preset && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            size="small"
            value={fontScale}
            options={FONT_SCALES}
            onChange={(value) => setFontScale(value as ResumeFontScale)}
          />
          {template?.kind === "style" ? (
            <Segmented
              size="small"
              value={formatName || ""}
              options={[
                { value: "", label: "模板自带版式" },
                ...formatPresets.map((item) => ({ value: item.name, label: item.label })),
              ]}
              onChange={(value) => setFormatName(String(value))}
            />
          ) : null}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            预览使用内置示例简历内容
          </Typography.Text>
        </Space>
      )}
      {error ? (
        <Alert type="error" showIcon title="预览渲染失败" description={error} />
      ) : loading ? (
        <div className="template-preview-loading">
          <Spin />
        </div>
      ) : (
        <A4PreviewFrame html={html} title="模板预览" />
      )}
    </Modal>
  );
}
