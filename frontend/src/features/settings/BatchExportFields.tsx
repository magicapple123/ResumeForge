// SPDX-License-Identifier: Apache-2.0
/**
 * 批量导出简历的**字段组**（受控）：设置页的卡与批量动作的弹窗共用这一份。
 *
 * 与生成字段组同一套写法：只渲染、只回传，状态归调用方（卡走自动保存、弹窗走本地 state）。
 */
import { InputNumber, Select, Space, Typography } from "antd";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { resumeFontScaleLabel, resumeTemplateLabel } from "../../i18n/enum/resumeCatalog";
import type { BatchExportConfig, BatchExportFormat } from "../../api/settingsBatch";
import type { ResumeFontScaleOption, ResumeTemplateOption } from "../../types";
import BatchConfigRow from "./BatchConfigRow";

const EXPORT_FORMATS: { value: BatchExportFormat; labelKey: MessageKey }[] = [
  { value: "pdf", labelKey: "batchOperation.format.pdf" },
  { value: "docx", labelKey: "batchOperation.format.docx" },
  { value: "html", labelKey: "batchOperation.format.html" },
  { value: "md", labelKey: "batchOperation.format.md" },
];

export interface BatchExportFieldsProps {
  value: BatchExportConfig;
  onChange: <K extends keyof BatchExportConfig>(key: K, value: BatchExportConfig[K]) => void;
  templates: ResumeTemplateOption[];
  fontScales: ResumeFontScaleOption[];
  /** 为 true 时按弹窗的可用宽度排两列。 */
  compact?: boolean;
}

export default function BatchExportFields({
  value,
  onChange,
  templates,
  fontScales,
  compact = false,
}: BatchExportFieldsProps) {
  useLocale();
  return (
    <>
      <div className={compact ? "batch-config-rows is-modal" : "batch-config-rows"}>
        <BatchConfigRow label={t("batchOperation.field.template")}>
          <Select
            value={value.template}
            onChange={(next) => onChange("template", next)}
            options={
              templates.length > 0
                ? templates.map((item) => ({ value: item.name, label: resumeTemplateLabel(item) }))
                : [{ value: value.template, label: value.template }]
            }
          />
        </BatchConfigRow>
        <BatchConfigRow label={t("batchOperation.field.fontScale")}>
          <Select
            value={value.font_scale}
            onChange={(next) => onChange("font_scale", next)}
            options={
              fontScales.length > 0
                ? fontScales.map((item) => ({
                    value: item.name,
                    label: resumeFontScaleLabel(item),
                  }))
                : ["small", "standard", "large"].map((next) => ({ value: next, label: next }))
            }
          />
        </BatchConfigRow>
        <BatchConfigRow label={t("batchOperation.field.pageLimit")}>
          <Space size={6}>
            <InputNumber
              min={1}
              max={3}
              value={value.page_limit}
              onChange={(next) => onChange("page_limit", Number(next) || 1)}
            />
            <Typography.Text type="secondary">{t("batchOperation.pageLimit.unit")}</Typography.Text>
          </Space>
        </BatchConfigRow>
        <BatchConfigRow label={t("batchOperation.field.language")}>
          <Select
            value={value.language}
            onChange={(next) => onChange("language", next)}
            options={[
              { value: "zh-CN", label: t("batchOperation.language.zh") },
              { value: "en-US", label: t("batchOperation.language.en") },
            ]}
          />
        </BatchConfigRow>
        <BatchConfigRow label={t("batchOperation.field.exportFormat")}>
          <Select
            value={value.export_format}
            onChange={(next) => onChange("export_format", next)}
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
    </>
  );
}
