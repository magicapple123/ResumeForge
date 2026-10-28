// SPDX-License-Identifier: Apache-2.0
/**
 * 设置 · 批量导出简历参数（简历中心「批量导出」专用）。
 *
 * 与生成卡分开存储：改导出格式不会影响下一次批量生成。改动即自动保存。
 */
import { Card, InputNumber, Select, Space, Typography } from "antd";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { resumeFontScaleLabel, resumeTemplateLabel } from "../../i18n/enum/resumeCatalog";
import type { BatchExportConfigOut, BatchExportFormat } from "../../api/settingsBatch";
import type { ResumeFontScaleOption, ResumeTemplateOption } from "../../types";
import { useBatchSectionAutoSave } from "../../features/settings/useBatchSectionAutoSave";
import BatchConfigRow from "./BatchConfigRow";
import BatchSaveStatus from "./BatchSaveStatus";

const EXPORT_FORMATS: { value: BatchExportFormat; labelKey: MessageKey }[] = [
  { value: "pdf", labelKey: "batchOperation.format.pdf" },
  { value: "docx", labelKey: "batchOperation.format.docx" },
  { value: "html", labelKey: "batchOperation.format.html" },
  { value: "md", labelKey: "batchOperation.format.md" },
];

export default function BatchExportCard({
  section,
  templates,
  fontScales,
}: {
  section: BatchExportConfigOut;
  templates: ResumeTemplateOption[];
  fontScales: ResumeFontScaleOption[];
}) {
  useLocale();
  const { draft, status, update } = useBatchSectionAutoSave("export", section);
  return (
    <Card
      className="batch-config-card"
      title={t("batchOperation.export.title")}
      extra={<BatchSaveStatus status={status} />}
      styles={{ body: { padding: "14px 20px 16px" } }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("batchOperation.export.intro")}
      </Typography.Paragraph>
      <div className="batch-config-rows">
        <BatchConfigRow label={t("batchOperation.field.template")}>
          <Select
            value={draft.template}
            onChange={(value) => update("template", value)}
            options={
              templates.length > 0
                ? templates.map((item) => ({ value: item.name, label: resumeTemplateLabel(item) }))
                : [{ value: draft.template, label: draft.template }]
            }
          />
        </BatchConfigRow>
        <BatchConfigRow label={t("batchOperation.field.fontScale")}>
          <Select
            value={draft.font_scale}
            onChange={(value) => update("font_scale", value)}
            options={
              fontScales.length > 0
                ? fontScales.map((item) => ({
                    value: item.name,
                    label: resumeFontScaleLabel(item),
                  }))
                : ["small", "standard", "large"].map((value) => ({ value, label: value }))
            }
          />
        </BatchConfigRow>
        <BatchConfigRow label={t("batchOperation.field.pageLimit")}>
          <Space size={6}>
            <InputNumber
              min={1}
              max={3}
              value={draft.page_limit}
              onChange={(value) => update("page_limit", Number(value) || 1)}
            />
            <Typography.Text type="secondary">{t("batchOperation.pageLimit.unit")}</Typography.Text>
          </Space>
        </BatchConfigRow>
        <BatchConfigRow label={t("batchOperation.field.language")}>
          <Select
            value={draft.language}
            onChange={(value) => update("language", value)}
            options={[
              { value: "zh-CN", label: t("batchOperation.language.zh") },
              { value: "en-US", label: t("batchOperation.language.en") },
            ]}
          />
        </BatchConfigRow>
        <BatchConfigRow label={t("batchOperation.field.exportFormat")}>
          <Select
            value={draft.export_format}
            onChange={(value) => update("export_format", value)}
            options={EXPORT_FORMATS.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
          />
        </BatchConfigRow>
      </div>
      <Typography.Paragraph type="secondary" className="batch-config-footnote">
        {t("batchOperation.hint.layout")}
      </Typography.Paragraph>
    </Card>
  );
}
