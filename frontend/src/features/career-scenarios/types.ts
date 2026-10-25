// SPDX-License-Identifier: Apache-2.0
/**
 * 职业场景（A2/A5）的前端类型：与后端契约 §2 逐字段一致（snake_case，不自造别名）。
 *
 * 枚举是**字面量联合**：值只能来自契约 §2.1，前端不得扩展。归一函数把缺失/未知值
 * 收敛成安全默认值——旧场景或脏数据不应该把控件打挂。
 */
import type { CareerContextRequest, GenerationContextSnapshot } from "../../types/resume";

/** 本次生成上下文请求体：字段名与后端 `CareerContextRequest` 逐字一致。 */
export type { CareerContextRequest, GenerationContextSnapshot };

/** 职业阶段（契约 §2.1）。 */
export type CareerStage = "unset" | "student" | "entry" | "experienced" | "senior";

/** 当前就业状态（本地保存；默认不进 AI/导出）。 */
export type EmploymentStatus =
  "unset" | "employed" | "unemployed" | "self_employed" | "studying" | "career_break" | "other";

/** 使用目的。 */
export type CareerPurpose =
  | "general"
  | "internship"
  | "job_search"
  | "career_change"
  | "internal_transfer"
  | "research_application"
  | "project_collaboration"
  | "career_return";

/** 合作形式（偏好，不能改写真实雇佣关系）。 */
export type CooperationForm =
  "unset" | "full_time" | "part_time" | "contract" | "self_employed" | "other";

/** 内容语言。 */
export type ContentLanguage = "unset" | "zh-CN" | "en-US";

export const CAREER_STAGES: readonly CareerStage[] = [
  "unset",
  "student",
  "entry",
  "experienced",
  "senior",
];

export const EMPLOYMENT_STATUSES: readonly EmploymentStatus[] = [
  "unset",
  "employed",
  "unemployed",
  "self_employed",
  "studying",
  "career_break",
  "other",
];

export const CAREER_PURPOSES: readonly CareerPurpose[] = [
  "general",
  "internship",
  "job_search",
  "career_change",
  "internal_transfer",
  "research_application",
  "project_collaboration",
  "career_return",
];

export const COOPERATION_FORMS: readonly CooperationForm[] = [
  "unset",
  "full_time",
  "part_time",
  "contract",
  "self_employed",
  "other",
];

export const CONTENT_LANGUAGES: readonly ContentLanguage[] = ["unset", "zh-CN", "en-US"];

/** 场景配置（契约 §2.2，后端 `extra="forbid"`）。 */
export interface CareerScenarioConfig {
  career_stage: CareerStage;
  /** 本地保存；默认不进 AI/导出（`include_employment_status` 才允许）。 */
  employment_status: EmploymentStatus;
  purpose: CareerPurpose;
  /** ≤5 个，每个 ≤40 字。 */
  target_industries: string[];
  /** ≤120 字。 */
  target_function: string;
  cooperation_form: CooperationForm;
  content_language: ContentLanguage;
  /** ≤40 字。 */
  work_region: string;
  /** 合法 section key，≤10 个。 */
  preferred_sections: string[];
  /** ≤800 字。 */
  expression_preferences: string;
  /** 显式允许就业状态进入本次生成。 */
  include_employment_status: boolean;
}

/** 一份已保存的场景（`GET /career-scenarios` 的 item）。 */
export interface CareerScenario {
  id: number;
  name: string;
  schema_version: number;
  revision: number;
  config: CareerScenarioConfig;
  archived: boolean;
  created_at: string;
  updated_at: string | null;
}

/** 目录限额（服务端下发，前端不写死数值）。 */
export interface CareerScenarioLimits {
  max_name_chars: number;
  max_scenarios: number;
  max_config_bytes: number;
  max_expression_preferences: number;
}

/** 内置快捷场景（仅快捷组合、不互斥、可跳过）。 */
export interface CareerScenarioPreset {
  key: string;
  name: string;
  config: CareerScenarioConfig;
  suggested_sections: string[];
  guidance: string[];
}

/** 内置目录（`GET /career-scenarios/catalog`）。 */
export interface CareerScenarioCatalog {
  catalog_version: string;
  schema_version: number;
  limits: CareerScenarioLimits;
  presets: CareerScenarioPreset[];
}

/** 归一：未知值一律当"未设置"，避免旧/脏数据把控件打挂。 */
export function normalizeCareerStage(value: unknown): CareerStage {
  return CAREER_STAGES.includes(value as CareerStage) ? (value as CareerStage) : "unset";
}

export function normalizeEmploymentStatus(value: unknown): EmploymentStatus {
  return EMPLOYMENT_STATUSES.includes(value as EmploymentStatus)
    ? (value as EmploymentStatus)
    : "unset";
}

export function normalizeCareerPurpose(value: unknown): CareerPurpose {
  return CAREER_PURPOSES.includes(value as CareerPurpose) ? (value as CareerPurpose) : "general";
}

export function normalizeCooperationForm(value: unknown): CooperationForm {
  return COOPERATION_FORMS.includes(value as CooperationForm)
    ? (value as CooperationForm)
    : "unset";
}

export function normalizeContentLanguage(value: unknown): ContentLanguage {
  return CONTENT_LANGUAGES.includes(value as ContentLanguage)
    ? (value as ContentLanguage)
    : "unset";
}

/** 把后端可能缺字段的 config 补成一份可编辑的完整配置。 */
export function normalizeCareerScenarioConfig(value: unknown): CareerScenarioConfig {
  const record = (value && typeof value === "object" ? value : {}) as Partial<CareerScenarioConfig>;
  return {
    career_stage: normalizeCareerStage(record.career_stage),
    employment_status: normalizeEmploymentStatus(record.employment_status),
    purpose: normalizeCareerPurpose(record.purpose),
    target_industries: stringList(record.target_industries).slice(0, 5),
    target_function: typeof record.target_function === "string" ? record.target_function : "",
    cooperation_form: normalizeCooperationForm(record.cooperation_form),
    content_language: normalizeContentLanguage(record.content_language),
    work_region: typeof record.work_region === "string" ? record.work_region : "",
    preferred_sections: stringList(record.preferred_sections).slice(0, 10),
    expression_preferences:
      typeof record.expression_preferences === "string" ? record.expression_preferences : "",
    include_employment_status: record.include_employment_status === true,
  };
}

/** 空白配置（新建场景的起点）。每次都造一份新对象，避免多个表单共享同一份状态。 */
export function emptyCareerScenarioConfig(): CareerScenarioConfig {
  return normalizeCareerScenarioConfig({});
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
