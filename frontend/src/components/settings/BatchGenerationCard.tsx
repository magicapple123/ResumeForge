// SPDX-License-Identifier: Apache-2.0
/**
 * 设置 · 批量生成简历参数（岗位广场「批量 AI 生成简历」专用）。
 *
 * 没有保存按钮：改动即自动保存（`useBatchSectionAutoSave`）。首次打开若从未配置，
 * 会用当前默认值启用一次，避免"只想用默认值"的用户被守卫反复挡回去。
 */
import { Card, Input, InputNumber, Select, Space, Switch, Typography } from "antd";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { resumeFontScaleLabel, resumeTemplateLabel } from "../../i18n/enum/resumeCatalog";
import type { BatchGenerationConfigOut } from "../../api/settingsBatch";
import type { ResumeFontScaleOption, ResumeTemplateOption } from "../../types";
import { useBatchSectionAutoSave } from "../../features/settings/useBatchSectionAutoSave";
import BatchConfigRow from "./BatchConfigRow";
import BatchSaveStatus from "./BatchSaveStatus";

const ENHANCEMENT_LEVELS: { value: "light" | "balanced" | "strong"; labelKey: MessageKey }[] = [
  { value: "light", labelKey: "batchOperation.enhance.light" },
  { value: "balanced", labelKey: "batchOperation.enhance.balanced" },
  { value: "strong", labelKey: "batchOperation.enhance.strong" },
];

export default function BatchGenerationCard({
  section,
  templates,
  fontScales,
}: {
  section: BatchGenerationConfigOut;
  templates: ResumeTemplateOption[];
  fontScales: ResumeFontScaleOption[];
}) {
  useLocale();
  const { draft, status, update } = useBatchSectionAutoSave("generation", section);
  return (
    <Card
      className="batch-config-card"
      title={t("batchOperation.generation.title")}
      extra={<BatchSaveStatus status={status} />}
      styles={{ body: { padding: "14px 20px 16px" } }}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {t("batchOperation.generation.intro")}
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
        <BatchConfigRow label={t("batchOperation.field.enhance")} span2>
          <Space size={10} wrap>
            <Switch checked={draft.enhance} onChange={(checked) => update("enhance", checked)} />
            <Select
              style={{ minWidth: 132 }}
              disabled={!draft.enhance}
              value={draft.enhancement_level}
              onChange={(value) => update("enhancement_level", value)}
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
            value={draft.custom_instruction}
            placeholder={t("batchOperation.field.customInstructionPlaceholder")}
            onChange={(event) => update("custom_instruction", event.target.value)}
          />
        </BatchConfigRow>
      </div>
      <Typography.Paragraph type="secondary" className="batch-config-footnote">
        {t("batchOperation.hint.layout")}
      </Typography.Paragraph>
    </Card>
  );
}
