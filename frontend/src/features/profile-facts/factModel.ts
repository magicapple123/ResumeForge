// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实的写入层：默认 payload、表单值 ↔ payload 转换、自定义字段值、排序与链接校验。
 *
 * 列表摘要/徽标在 `factDisplay.ts`（为什么拆：见该文件头）。
 *
 * 表单里"每行一条"的列表字段以多行文本编辑（与 ExperienceSection 的既有做法一致），
 * 保存时才拆成后端契约要求的 `string[]`；读回时再拼回去。这个转换只做一次、只在这里做，
 * 九类编辑器共用，避免每类各写一份 split/join。
 *
 * **自定义字段**的展示输入由字段设置定义（schema）驱动，值存 payload.custom_fields
 * 快照。保存时：当前定义逐条写入值；已在定义里删除、但旧 payload 里还留着的键原样保留
 * （契约 §2：删除定义不删已录值，界面/AI 只是不再使用）。
 */
import {
  CREDENTIAL_STATUS_OPTIONS,
  PATENT_STATUS_OPTIONS,
  PRACTICE_KIND_OPTIONS,
  PUBLICATION_STATUS_OPTIONS,
  type FactStatusOption,
} from "./constants";
import type {
  AwardPayload,
  CredentialPayload,
  FactCustomField,
  FactCustomFieldDef,
  FactKind,
  FactPayload,
  FactPayloadByKind,
  FactPerson,
  LanguagePayload,
  PatentPayload,
  PracticePayload,
  ProfileFact,
  PublicationPayload,
  ResearchProjectPayload,
  TrainingPayload,
  WorkProjectPayload,
} from "./types";

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function trimmed(value: unknown): string {
  return asText(value).trim();
}

/** 多行文本 → 列表：空行忽略、首尾空白去掉，顺序原样保留。 */
export function splitLines(value: unknown): string[] {
  return asText(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function joinLines(value: readonly string[] | undefined): string {
  return (value ?? []).join("\n");
}

/** 下拉枚举：只接受契约白名单里的值，脏值回落到该类的默认值（不抛错）。 */
function asOption<T extends string>(
  value: unknown,
  options: readonly FactStatusOption<T>[],
  fallback: T,
): T {
  const candidate = asText(value);
  return options.some((option) => option.value === candidate) ? (candidate as T) : fallback;
}

/** 作者/发明人：保持顺序；姓名空白的行丢弃（用户加了一行又没填不算数据）。 */
function asPeople(value: unknown): FactPerson[] {
  if (!Array.isArray(value)) return [];
  const result: FactPerson[] = [];
  for (const item of value) {
    const record = (item ?? {}) as Record<string, unknown>;
    const name = trimmed(record.name);
    if (!name) continue;
    result.push({
      name,
      is_self: record.is_self === true,
      corresponding: record.corresponding === true,
    });
  }
  return result;
}

/** 事实 payload 里的自定义字段值快照（容错读取旧/脏数据）。 */
export function asCustomFields(value: unknown): FactCustomField[] {
  if (!Array.isArray(value)) return [];
  const result: FactCustomField[] = [];
  for (const item of value) {
    const record = (item ?? {}) as Record<string, unknown>;
    const key = asText(record.key).trim();
    const label = asText(record.label).trim();
    if (!key || !label) continue;
    result.push({ key, label, value: asText(record.value) });
  }
  return result;
}

/** 表单里自定义字段的值：`values.custom` 是 `{ [schemaKey]: string }`。 */
function customValueMap(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * 表单值 → payload.custom_fields：
 * 1. 当前定义里的每个字段写入最新 label 与输入值；
 * 2. 旧 payload 中已从定义删除的键原样保留（本地数据不删，只是界面不再展示）。
 */
function buildCustomFields(
  values: Record<string, unknown>,
  defs: readonly FactCustomFieldDef[],
  previous: readonly FactCustomField[],
): FactCustomField[] {
  const inputs = customValueMap(values.custom);
  const result: FactCustomField[] = [];
  const definedKeys = new Set<string>();
  for (const def of defs) {
    if (!def.key) continue;
    definedKeys.add(def.key);
    result.push({ key: def.key, label: def.label, value: asText(inputs[def.key]) });
  }
  const usedLabels = new Set(result.map((field) => field.label));
  for (const field of previous) {
    if (definedKeys.has(field.key)) continue;
    // 定义改成与旧快照同名时跳过旧条目：后端规定同一事实内 label 唯一，保留它会 422。
    // 这是契约里"同名重建不会自动关联旧值"的边界——值的归属以当前定义为准。
    if (usedLabels.has(field.label)) continue;
    usedLabels.add(field.label);
    result.push({ key: field.key, label: field.label, value: field.value });
  }
  return result;
}

/** 每类事实的默认 payload：新建时先给后端一份完整、合法的底稿。 */
export function createEmptyPayload<K extends FactKind>(kind: K): FactPayloadByKind[K] {
  return createEmptyPayloadImpl(kind) as FactPayloadByKind[K];
}

function createEmptyPayloadImpl(kind: FactKind): FactPayload {
  const custom_fields: FactCustomField[] = [];
  switch (kind) {
    case "publication":
      return {
        title: "",
        authors: [],
        venue: "",
        year: "",
        status: "other",
        doi: "",
        url: "",
        volume_pages: "",
        note: "",
        custom_fields,
      } satisfies PublicationPayload;
    case "research_project":
      return {
        name: "",
        role: "",
        organization: "",
        start_date: "",
        end_date: "",
        funding: "",
        description: [],
        outcomes: [],
        custom_fields,
      } satisfies ResearchProjectPayload;
    case "patent":
      return {
        title: "",
        inventors: [],
        patent_number: "",
        country: "",
        status: "other",
        filed_date: "",
        granted_date: "",
        url: "",
        custom_fields,
      } satisfies PatentPayload;
    case "credential":
      return {
        name: "",
        issuer: "",
        issue_date: "",
        expiry_date: "",
        status: "unknown",
        credential_number: "",
        verify_url: "",
        note: "",
        custom_fields,
      } satisfies CredentialPayload;
    case "work_project":
      return {
        name: "",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: [],
        highlights: [],
        public_url: "",
        artifact_type: "",
        custom_fields,
      } satisfies WorkProjectPayload;
    case "practice":
      return {
        organization: "",
        role: "",
        experience_kind: "unset",
        start_date: "",
        end_date: "",
        description: [],
        custom_fields,
      } satisfies PracticePayload;
    case "award":
      return {
        name: "",
        issuer: "",
        date: "",
        level: "",
        description: "",
        custom_fields,
      } satisfies AwardPayload;
    case "training":
      return {
        name: "",
        organization: "",
        start_date: "",
        end_date: "",
        hours: "",
        description: [],
        outcomes: [],
        custom_fields,
      } satisfies TrainingPayload;
    case "language":
      return {
        name: "",
        level: "",
        certificate: "",
        score: "",
        date: "",
        custom_fields,
      } satisfies LanguagePayload;
  }
}

/** 结构是"人员数组"而不是"每行一条文本"的键；其余数组都渲染成多行文本框。 */
const PEOPLE_LIST_KEYS = new Set(["authors", "inventors"]);

/** payload → 表单值：列表拼成多行文本，人员列表复制一份避免表单直接改到接口对象。 */
export function payloadToForm(payload: FactPayload): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "custom_fields") {
      // 自定义字段按 schema key 平铺成 {custom: {cf_xxx: value}}，供字段设置驱动渲染。
      const custom: Record<string, string> = {};
      for (const field of asCustomFields(value)) custom[field.key] = field.value;
      values.custom = custom;
    } else if (!Array.isArray(value)) {
      values[key] = value;
    } else if (PEOPLE_LIST_KEYS.has(key)) {
      // 空数组也必须保持数组：Form.List 的初始值若是字符串 "" 会与字段类型不符。
      values[key] = value.map((item) => ({ ...(item as FactPerson) }));
    } else {
      values[key] = joinLines(value as string[]);
    }
  }
  return values;
}

/** 新建时的空白表单值（与 payload 同一套字段，只是列表变成多行文本）。 */
export function emptyFormValues(kind: FactKind): Record<string, unknown> {
  return payloadToForm(createEmptyPayload(kind));
}

/** 编辑时用到的字段设置上下文：当前自定义字段定义 + 旧 payload 的值快照。 */
export interface FactFormOptions {
  customDefs?: readonly FactCustomFieldDef[];
  previousCustomFields?: readonly FactCustomField[];
}

/** 表单值 → 完整 payload：字段一个不少，保证 PATCH 不会把未展示的键清成后端默认值。 */
export function formToPayload<K extends FactKind>(
  kind: K,
  values: Record<string, unknown>,
  options: FactFormOptions = {},
): FactPayloadByKind[K] {
  return formToPayloadImpl(kind, values, options) as FactPayloadByKind[K];
}

function formToPayloadImpl(
  kind: FactKind,
  values: Record<string, unknown>,
  options: FactFormOptions,
): FactPayload {
  const custom_fields = buildCustomFields(
    values,
    options.customDefs ?? [],
    options.previousCustomFields ?? [],
  );
  switch (kind) {
    case "publication":
      return {
        title: trimmed(values.title),
        authors: asPeople(values.authors),
        venue: trimmed(values.venue),
        year: trimmed(values.year),
        status: asOption(values.status, PUBLICATION_STATUS_OPTIONS, "other"),
        doi: trimmed(values.doi),
        url: trimmed(values.url),
        volume_pages: trimmed(values.volume_pages),
        note: asText(values.note).trim(),
        custom_fields,
      } satisfies PublicationPayload;
    case "research_project":
      return {
        name: trimmed(values.name),
        role: trimmed(values.role),
        organization: trimmed(values.organization),
        start_date: trimmed(values.start_date),
        end_date: trimmed(values.end_date),
        funding: trimmed(values.funding),
        description: splitLines(values.description),
        outcomes: splitLines(values.outcomes),
        custom_fields,
      } satisfies ResearchProjectPayload;
    case "patent":
      return {
        title: trimmed(values.title),
        inventors: asPeople(values.inventors),
        patent_number: trimmed(values.patent_number),
        country: trimmed(values.country),
        status: asOption(values.status, PATENT_STATUS_OPTIONS, "other"),
        filed_date: trimmed(values.filed_date),
        granted_date: trimmed(values.granted_date),
        url: trimmed(values.url),
        custom_fields,
      } satisfies PatentPayload;
    case "credential":
      return {
        name: trimmed(values.name),
        issuer: trimmed(values.issuer),
        issue_date: trimmed(values.issue_date),
        expiry_date: trimmed(values.expiry_date),
        status: asOption(values.status, CREDENTIAL_STATUS_OPTIONS, "unknown"),
        credential_number: trimmed(values.credential_number),
        verify_url: trimmed(values.verify_url),
        note: asText(values.note).trim(),
        custom_fields,
      } satisfies CredentialPayload;
    case "work_project":
      return {
        name: trimmed(values.name),
        role: trimmed(values.role),
        start_date: trimmed(values.start_date),
        end_date: trimmed(values.end_date),
        tech_stack: splitLines(values.tech_stack),
        description: splitLines(values.description),
        highlights: splitLines(values.highlights),
        public_url: trimmed(values.public_url),
        artifact_type: trimmed(values.artifact_type),
        custom_fields,
      } satisfies WorkProjectPayload;
    case "practice":
      return {
        organization: trimmed(values.organization),
        role: trimmed(values.role),
        experience_kind: asOption(values.experience_kind, PRACTICE_KIND_OPTIONS, "unset"),
        start_date: trimmed(values.start_date),
        end_date: trimmed(values.end_date),
        description: splitLines(values.description),
        custom_fields,
      } satisfies PracticePayload;
    case "award":
      return {
        name: trimmed(values.name),
        issuer: trimmed(values.issuer),
        date: trimmed(values.date),
        level: trimmed(values.level),
        description: asText(values.description).trim(),
        custom_fields,
      } satisfies AwardPayload;
    case "training":
      return {
        name: trimmed(values.name),
        organization: trimmed(values.organization),
        start_date: trimmed(values.start_date),
        end_date: trimmed(values.end_date),
        hours: trimmed(values.hours),
        description: splitLines(values.description),
        outcomes: splitLines(values.outcomes),
        custom_fields,
      } satisfies TrainingPayload;
    case "language":
      return {
        name: trimmed(values.name),
        level: trimmed(values.level),
        certificate: trimmed(values.certificate),
        score: trimmed(values.score),
        date: trimmed(values.date),
        custom_fields,
      } satisfies LanguagePayload;
  }
}

/** 新建时追加到末尾：取现有最大 sort_order + 1（不按 kind 重排用户既有顺序）。 */
export function nextSortOrder(facts: readonly ProfileFact[]): number {
  return facts.reduce((max, fact) => Math.max(max, fact.sort_order), 0) + 1;
}

/** 前端只校验协议，不抓取链接内容（抓取交给后端/用户自己核对）。 */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}
