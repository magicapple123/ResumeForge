// SPDX-License-Identifier: Apache-2.0
/**
 * 职业场景的**维度 → 界面文案**映射（编辑表单的选项与「本次会发送的维度」共用一份）。
 *
 * 只认契约 §2.1 的枚举取值；未知值用归一函数兜底，不新增维度、不改写后端语义。
 */
import { t } from "../../i18n";
import {
  CAREER_PURPOSES,
  CAREER_STAGES,
  CONTENT_LANGUAGES,
  COOPERATION_FORMS,
  EMPLOYMENT_STATUSES,
  normalizeCareerScenarioConfig,
  type CareerScenarioConfig,
  type ContentLanguage,
} from "./types";

export interface DimensionOption {
  value: string;
  label: string;
}

/** 内容语言只有两个业务取值，key 用驼峰（zh-CN / en-US 不能直接拼进 key）。 */
const LANGUAGE_KEY: Record<ContentLanguage, "unset" | "zhCN" | "enUS"> = {
  unset: "unset",
  "zh-CN": "zhCN",
  "en-US": "enUS",
};

export function careerStageOptions(): DimensionOption[] {
  return CAREER_STAGES.map((value) => ({ value, label: t(`careerScenarios.stage.${value}`) }));
}

export function employmentStatusOptions(): DimensionOption[] {
  return EMPLOYMENT_STATUSES.map((value) => ({
    value,
    label: t(`careerScenarios.status.${value}`),
  }));
}

export function careerPurposeOptions(): DimensionOption[] {
  return CAREER_PURPOSES.map((value) => ({ value, label: t(`careerScenarios.purpose.${value}`) }));
}

export function cooperationFormOptions(): DimensionOption[] {
  return COOPERATION_FORMS.map((value) => ({
    value,
    label: t(`careerScenarios.cooperation.${value}`),
  }));
}

export function contentLanguageOptions(): DimensionOption[] {
  return CONTENT_LANGUAGES.map((value) => ({
    value,
    label: t(`careerScenarios.language.${LANGUAGE_KEY[value]}`),
  }));
}

export function careerStageLabel(value: string): string {
  return careerStageOptions().find((option) => option.value === value)?.label ?? value;
}

export function employmentStatusLabel(value: string): string {
  return employmentStatusOptions().find((option) => option.value === value)?.label ?? value;
}

export function careerPurposeLabel(value: string): string {
  return careerPurposeOptions().find((option) => option.value === value)?.label ?? value;
}

export function cooperationFormLabel(value: string): string {
  return cooperationFormOptions().find((option) => option.value === value)?.label ?? value;
}

export function contentLanguageLabel(value: string): string {
  return contentLanguageOptions().find((option) => option.value === value)?.label ?? value;
}

/** 「本次会发送的维度」的一行。 */
export interface DimensionLine {
  key: string;
  label: string;
  value: string;
}

/**
 * 按契约 §2.5 的 `resolved_dimensions` 口径列出本次会发送的维度：
 * 只列**非默认值**；就业状态仅在显式允许（`include_employment_status`）时出现。
 */
export function configuredDimensionLines(
  config: CareerScenarioConfig | null | undefined,
  options: {
    /** section key → 中文名（没有时退回 key 本身）。 */
    sectionLabels?: Record<string, string>;
    /** 是否允许就业状态进本次生成（默认读 config 自己的开关）。 */
    includeEmploymentStatus?: boolean;
  } = {},
): DimensionLine[] {
  if (!config) return [];
  const normalized = normalizeCareerScenarioConfig(config);
  const lines: DimensionLine[] = [];
  const push = (key: string, label: string, value: string): void => {
    const trimmed = value.trim();
    if (trimmed) lines.push({ key, label, value: trimmed });
  };

  if (normalized.career_stage !== "unset") {
    push(
      "career_stage",
      t("careerScenarios.field.careerStage"),
      careerStageLabel(normalized.career_stage),
    );
  }
  if (normalized.purpose !== "general") {
    push("purpose", t("careerScenarios.field.purpose"), careerPurposeLabel(normalized.purpose));
  }
  if (normalized.target_industries.length > 0) {
    push(
      "target_industries",
      t("careerScenarios.field.targetIndustries"),
      normalized.target_industries.join(t("careerScenarios.field.listSeparator")),
    );
  }
  push("target_function", t("careerScenarios.field.targetFunction"), normalized.target_function);
  if (normalized.cooperation_form !== "unset") {
    push(
      "cooperation_form",
      t("careerScenarios.field.cooperationForm"),
      cooperationFormLabel(normalized.cooperation_form),
    );
  }
  if (normalized.content_language !== "unset") {
    push(
      "content_language",
      t("careerScenarios.field.contentLanguage"),
      contentLanguageLabel(normalized.content_language),
    );
  }
  push("work_region", t("careerScenarios.field.workRegion"), normalized.work_region);
  if (normalized.preferred_sections.length > 0) {
    const labels = normalized.preferred_sections.map((key) => options.sectionLabels?.[key] ?? key);
    push(
      "preferred_sections",
      t("careerScenarios.field.preferredSections"),
      labels.join(t("careerScenarios.field.listSeparator")),
    );
  }
  push(
    "expression_preferences",
    t("careerScenarios.field.expressionPreferences"),
    normalized.expression_preferences,
  );
  const includeEmployment = options.includeEmploymentStatus ?? normalized.include_employment_status;
  if (includeEmployment && normalized.employment_status !== "unset") {
    push(
      "employment_status",
      t("careerScenarios.field.employmentStatus"),
      employmentStatusLabel(normalized.employment_status),
    );
  }
  return lines;
}

/** 是否填写了可披露的就业状态（"发送就业状态"保险框是否可用）。 */
export function hasEmploymentStatus(config: CareerScenarioConfig | null | undefined): boolean {
  return normalizeCareerScenarioConfig(config).employment_status !== "unset";
}
