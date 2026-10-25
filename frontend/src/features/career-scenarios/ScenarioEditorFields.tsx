// SPDX-License-Identifier: Apache-2.0
/** 场景编辑器的字段区（纯受控）：只画表单，不发请求、不持有保存状态。 */
import { Button, Checkbox, Input, Select, Space, Typography } from "antd";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import {
  careerPurposeOptions,
  careerStageOptions,
  contentLanguageOptions,
  cooperationFormOptions,
  employmentStatusOptions,
} from "./dimensions";
import type { CareerScenarioConfig, CareerScenarioPreset } from "./types";
import { useState } from "react";

interface Props {
  name: string;
  setName: (value: string) => void;
  config: CareerScenarioConfig;
  setConfig: (next: CareerScenarioConfig) => void;
  /** 内置快捷场景（"另存为自定义场景"的起点）；空数组 = 目录不可用。 */
  presets: CareerScenarioPreset[];
  /** 偏好栏目的可选项（来自简历模板目录的 section_options）。 */
  sectionOptions: { key: string; label: string }[];
  nameMaxLength: number;
  expressionMaxLength: number;
  disabled?: boolean;
}

export default function ScenarioEditorFields({
  name,
  setName,
  config,
  setConfig,
  presets,
  sectionOptions,
  nameMaxLength,
  expressionMaxLength,
  disabled = false,
}: Props) {
  const [presetKey, setPresetKey] = useState<string | undefined>(undefined);
  const patch = (next: Partial<CareerScenarioConfig>) => setConfig({ ...config, ...next });
  const applyPreset = () => {
    const preset = presets.find((item) => item.key === presetKey);
    if (!preset) return;
    // 快捷场景只是起点：套用后仍可逐项修改，保存的是自定义场景（不改内置目录）。
    setConfig({ ...preset.config, include_employment_status: false });
    if (!name.trim()) setName(preset.name);
  };

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Field label={t("careerScenarios.editor.nameLabel")}>
        <Input
          aria-label={t("careerScenarios.editor.nameLabel")}
          value={name}
          maxLength={nameMaxLength}
          disabled={disabled || undefined}
          placeholder={t("careerScenarios.editor.namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field label={t("careerScenarios.editor.presetKey")}>
        <Space.Compact style={{ width: "100%" }}>
          <Select
            style={{ flex: 1 }}
            aria-label={t("careerScenarios.editor.presetLabel")}
            value={presetKey}
            disabled={disabled || presets.length === 0 || undefined}
            placeholder={t("careerScenarios.editor.presetPlaceholder")}
            onChange={setPresetKey}
            options={presets.map((item) => ({ value: item.key, label: item.name }))}
          />
          <Button disabled={disabled || !presetKey || undefined} onClick={applyPreset}>
            {t("careerScenarios.editor.presetApply")}
          </Button>
        </Space.Compact>
      </Field>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Field label={t("careerScenarios.field.careerStage")} grow>
          <Select
            style={{ width: "100%" }}
            aria-label={t("careerScenarios.field.careerStage")}
            value={config.career_stage}
            disabled={disabled || undefined}
            onChange={(value) => patch({ career_stage: value })}
            options={careerStageOptions()}
          />
        </Field>
        <Field label={t("careerScenarios.field.purpose")} grow>
          <Select
            style={{ width: "100%" }}
            aria-label={t("careerScenarios.field.purpose")}
            value={config.purpose}
            disabled={disabled || undefined}
            onChange={(value) => patch({ purpose: value })}
            options={careerPurposeOptions()}
          />
        </Field>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Field label={t("careerScenarios.field.cooperationForm")} grow>
          <Select
            style={{ width: "100%" }}
            aria-label={t("careerScenarios.field.cooperationForm")}
            value={config.cooperation_form}
            disabled={disabled || undefined}
            onChange={(value) => patch({ cooperation_form: value })}
            options={cooperationFormOptions()}
          />
        </Field>
        <Field label={t("careerScenarios.field.contentLanguage")} grow>
          <Select
            style={{ width: "100%" }}
            aria-label={t("careerScenarios.field.contentLanguage")}
            value={config.content_language}
            disabled={disabled || undefined}
            onChange={(value) => patch({ content_language: value })}
            options={contentLanguageOptions()}
          />
        </Field>
      </div>

      <Field label={t("careerScenarios.field.employmentStatus")}>
        <Select
          style={{ width: "100%" }}
          aria-label={t("careerScenarios.field.employmentStatus")}
          value={config.employment_status}
          disabled={disabled || undefined}
          onChange={(value) => patch({ employment_status: value })}
          options={employmentStatusOptions()}
        />
      </Field>

      <Field label={t("careerScenarios.field.targetIndustries")}>
        <Select
          mode="tags"
          style={{ width: "100%" }}
          aria-label={t("careerScenarios.field.targetIndustries")}
          value={config.target_industries}
          disabled={disabled || undefined}
          placeholder={t("careerScenarios.field.targetIndustriesPlaceholder")}
          onChange={(values: string[]) => patch({ target_industries: values.slice(0, 5) })}
          options={[]}
        />
      </Field>

      <Field label={t("careerScenarios.field.targetFunction")}>
        <Input
          aria-label={t("careerScenarios.field.targetFunction")}
          value={config.target_function}
          maxLength={120}
          disabled={disabled || undefined}
          placeholder={t("careerScenarios.field.targetFunctionPlaceholder")}
          onChange={(event) => patch({ target_function: event.target.value })}
        />
      </Field>

      <Field label={t("careerScenarios.field.workRegion")}>
        <Input
          aria-label={t("careerScenarios.field.workRegion")}
          value={config.work_region}
          maxLength={40}
          disabled={disabled || undefined}
          placeholder={t("careerScenarios.field.workRegionPlaceholder")}
          onChange={(event) => patch({ work_region: event.target.value })}
        />
      </Field>

      <Field label={t("careerScenarios.field.preferredSections")}>
        <Select
          mode="multiple"
          style={{ width: "100%" }}
          aria-label={t("careerScenarios.field.preferredSections")}
          value={config.preferred_sections}
          disabled={disabled || undefined}
          onChange={(values: string[]) => patch({ preferred_sections: values.slice(0, 10) })}
          options={sectionOptions.map((item) => ({ value: item.key, label: item.label }))}
        />
      </Field>

      <Field label={t("careerScenarios.field.expressionPreferences")}>
        <Input.TextArea
          aria-label={t("careerScenarios.field.expressionPreferences")}
          value={config.expression_preferences}
          maxLength={expressionMaxLength}
          disabled={disabled || undefined}
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder={t("careerScenarios.field.expressionPlaceholder")}
          onChange={(event) => patch({ expression_preferences: event.target.value })}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("careerScenarios.field.expressionHint")}
        </Typography.Text>
      </Field>

      <Checkbox
        checked={config.include_employment_status}
        disabled={disabled || undefined}
        onChange={(event) => patch({ include_employment_status: event.target.checked })}
      >
        {t("careerScenarios.editor.includeEmploymentStatus")}
      </Checkbox>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("careerScenarios.editor.includeEmploymentStatusHint")}
      </Typography.Text>
    </Space>
  );
}

function Field({
  label,
  children,
  grow = false,
}: {
  label: ReactNode;
  children: ReactNode;
  grow?: boolean;
}) {
  return (
    <div style={{ flex: grow ? "1 1 200px" : undefined, minWidth: 0 }}>
      <Typography.Text strong style={{ display: "block", marginBottom: 4 }}>
        {label}
      </Typography.Text>
      {children}
    </div>
  );
}
