// SPDX-License-Identifier: Apache-2.0
/** 补充事实测试夹具：纯 ASCII 内容，避免语言包之外再引入中文界面文案。 */
import { FACT_KINDS } from "./constants";
import { MAX_CUSTOM_FIELD_VALUE_CHARS, fallbackKindSchema } from "./factFieldSchema";
import type {
  FactCustomFieldDef,
  FactKind,
  ProfileFactKindSchema,
  ProfileFactOf,
  ProfileFactSchema,
} from "./types";

export const PUBLICATION_FACT: ProfileFactOf<"publication"> = {
  fact_id: "fact_pub_1",
  kind: "publication",
  schema_version: 1,
  revision: 2,
  payload: {
    title: "Graph learning for resume ranking",
    authors: [
      { name: "Zhang San", is_self: true, corresponding: true },
      { name: "Li Si", is_self: false, corresponding: false },
    ],
    venue: "Example Conference",
    year: "2025",
    status: "under_review",
    doi: "10.1000/example",
    url: "https://example.com/paper",
    volume_pages: "Vol 1, 1-10",
    note: "",
    custom_fields: [],
  },
  sort_order: 1,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: null,
  deleted_at: null,
};

export const CREDENTIAL_FACT: ProfileFactOf<"credential"> = {
  fact_id: "fact_cred_1",
  kind: "credential",
  schema_version: 1,
  revision: 1,
  payload: {
    name: "Registered Nurse License",
    issuer: "Example Health Commission",
    issue_date: "2024-06",
    expiry_date: "2029-06",
    status: "active",
    credential_number: "NURSE-0001",
    verify_url: "https://example.com/verify",
    note: "",
    custom_fields: [],
  },
  sort_order: 2,
  created_at: "2026-10-02T00:00:00Z",
  updated_at: null,
  deleted_at: null,
};

export const RESEARCH_FACT: ProfileFactOf<"research_project"> = {
  fact_id: "fact_research_1",
  kind: "research_project",
  schema_version: 1,
  revision: 1,
  payload: {
    name: "Smart campus energy project",
    role: "Lead",
    organization: "Example University",
    start_date: "2023-09",
    end_date: "2025-06",
    funding: "Example Fund 2023",
    description: ["Built the data pipeline", "Led a team of four"],
    outcomes: ["One demo deployed"],
    custom_fields: [],
  },
  sort_order: 3,
  created_at: "2026-10-03T00:00:00Z",
  updated_at: null,
  deleted_at: null,
};

export const PRACTICE_FACT: ProfileFactOf<"practice"> = {
  fact_id: "fact_practice_1",
  kind: "practice",
  schema_version: 1,
  revision: 1,
  payload: {
    organization: "Community Service Center",
    role: "Volunteer",
    experience_kind: "volunteer",
    start_date: "2024-01",
    end_date: "2024-06",
    description: ["Supported weekend reading sessions"],
    custom_fields: [],
  },
  sort_order: 4,
  created_at: "2026-10-04T00:00:00Z",
  updated_at: null,
  deleted_at: null,
};

export const AWARD_FACT: ProfileFactOf<"award"> = {
  fact_id: "fact_award_1",
  kind: "award",
  schema_version: 1,
  revision: 1,
  payload: {
    name: "National Math Contest First Prize",
    issuer: "Example Education Board",
    date: "2025-06",
    level: "National",
    description: "Top 1 percent nationwide",
    custom_fields: [],
  },
  sort_order: 5,
  created_at: "2026-10-05T00:00:00Z",
  updated_at: null,
  deleted_at: null,
};

export const TRAINING_FACT: ProfileFactOf<"training"> = {
  fact_id: "fact_training_1",
  kind: "training",
  schema_version: 1,
  revision: 1,
  payload: {
    name: "Project management basics",
    organization: "Example Academy",
    start_date: "2024-03",
    end_date: "2024-05",
    hours: "32",
    description: ["Scope and schedule planning"],
    outcomes: ["Used the method on two projects"],
    custom_fields: [],
  },
  sort_order: 6,
  created_at: "2026-10-06T00:00:00Z",
  updated_at: null,
  deleted_at: null,
};

export const LANGUAGE_FACT: ProfileFactOf<"language"> = {
  fact_id: "fact_language_1",
  kind: "language",
  schema_version: 1,
  revision: 1,
  payload: {
    name: "English",
    level: "CET-6",
    certificate: "College English Test Band 6",
    score: "512",
    date: "2023-12",
    custom_fields: [],
  },
  sort_order: 7,
  created_at: "2026-10-07T00:00:00Z",
  updated_at: null,
  deleted_at: null,
};

/** 一条自定义字段定义（9 类通用的结构，测试按需挂到某个 kind 上）。 */
export const CUSTOM_FIELD_DEF: FactCustomFieldDef = {
  key: "cf_0123456789ab",
  label: "Team size",
};

/** 构造单类 schema（默认全默认，测试按需覆盖 hidden/custom）。 */
export function makeKindSchema(
  kind: FactKind,
  overrides: Partial<ProfileFactKindSchema> = {},
): ProfileFactKindSchema {
  return { ...fallbackKindSchema(kind), ...overrides };
}

/** 构造整份 schema；`overrides` 按 kind 指定要覆盖的字段。 */
export function makeSchema(
  overrides: Partial<Record<FactKind, Partial<ProfileFactKindSchema>>> = {},
): ProfileFactSchema {
  return {
    kinds: FACT_KINDS.map((kind) => makeKindSchema(kind, overrides[kind])),
    max_custom_field_value_chars: MAX_CUSTOM_FIELD_VALUE_CHARS,
  };
}

/** 默认 schema：九类全默认可见、无自定义字段。 */
export const DEFAULT_SCHEMA: ProfileFactSchema = makeSchema();

/** kind → 单类 schema 的映射（编辑器/字段设置视图的 props 形状）。 */
export function makeSchemaMap(
  overrides: Partial<Record<FactKind, Partial<ProfileFactKindSchema>>> = {},
): Record<FactKind, ProfileFactKindSchema> {
  const map = {} as Record<FactKind, ProfileFactKindSchema>;
  for (const kindSchema of makeSchema(overrides).kinds) map[kindSchema.kind] = kindSchema;
  return map;
}
