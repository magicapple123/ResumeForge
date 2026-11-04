// SPDX-License-Identifier: Apache-2.0
/**
 * 批量生成简历的**字段组**（受控）：设置页的卡与批量动作的弹窗共用这一份。
 *
 * 只做渲染与回传，不持有状态、不发请求——设置卡接 `useBatchSectionAutoSave`（改动即落库），
 * 弹窗接本地 state（只作用于本次）。两处共用同一份字段，改一处不会漂移。
 */
import { Input, InputNumber, Select, Space, Switch, Typography } from "antd";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { resumeFontScaleLabel, resumeTemplateLabel } from "../../i18n/enum/resumeCatalog";
import type { BatchEnhancementLevel, BatchGenerationConfig } from "../../api/settingsBatch";
import type { ResumeFontScaleOption, ResumeTemplateOption } from "../../types";
import BatchConfigRow from "./BatchConfigRow";

const ENHANCEMENT_LEVELS: { value: BatchEnhancementLevel; labelKey: MessageKey }[] = [
  { value: "light", labelKey: "batchOperation.enhance.light" },
  { value: "balanced", labelKey: "batchOperation.enhance.balanced" },
  { value: "strong", labelKey: "batchOperation.enhance.strong" },
];

export interface BatchGenerationFieldsProps {
  value: BatchGenerationConfig;
  onChange: <K extends keyof BatchGenerationConfig>(
    key: K,
    value: BatchGenerationConfig[K],
  ) => void;
  templates: ResumeTemplateOption[];
  fontScales: ResumeFontScaleOption[];
  /** 为 true 时按弹窗的可用宽度排两列（设置卡的默认三列在 640 宽的弹窗里会挤）。 */
  compact?: boolean;
}

export default function BatchGenerationFields({
  value,
  onChange,
  templates,
  fontScales,
  compact = false,
}: BatchGenerationFieldsProps) {
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
        <BatchConfigRow label={t("batchOperation.field.enhance")} span2>
          <Space size={10} wrap>
            <Switch checked={value.enhance} onChange={(next) => onChange("enhance", next)} />
            <Select
              style={{ minWidth: 132 }}
              disabled={!value.enhance}
              value={value.enhancement_level}
              onChange={(next) => onChange("enhancement_level", next)}
              options={ENHANCEMENT_LEVELS.map((item) => ({
                value: item.value,
                label: t(item.labelKey),
              }))}
            />
          </Space>
        </BatchConfigRow>
        <BatchConfigRow
          label={t("batchOperation.field.customInstruction")}
          hint={t("batchOperation.field.optional")}
          wide
        >
          <Input.TextArea
            rows={2}
            maxLength={300}
            showCount
            value={value.custom_instruction}
            placeholder={t("batchOperation.field.customInstructionPlaceholder")}
            onChange={(event) => onChange("custom_instruction", event.target.value)}
          />
        </BatchConfigRow>
      </div>
      <Typography.Paragraph type="secondary" className="batch-config-footnote">
        {t("batchOperation.hint.layout")}
      </Typography.Paragraph>
    </>
  );
}
