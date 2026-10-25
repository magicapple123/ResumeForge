// SPDX-License-Identifier: Apache-2.0
/**
 * 九类补充事实的**默认字段清单与中文标签**（前端本地映射）。
 *
 * 字段 key（唯一真相）在后端 `services/profile/fact_field_schema.py`，但字段的中文名
 * 在 i18n 语言包里（不在后端下发）——这里把两边对上：
 * - 字段设置视图按默认字段列勾选项，需要中文名；
 * - 自定义字段校验"不得与默认字段同名"时，需要比较中文标签；
 * - 已知 key 的顺序仅作兜底（正常使用后端 schema 返回的 `default_fields` 顺序）。
 *
 * 新增字段 key 时：后端事实 schema、本文件、语言包三处一起改；`factFieldSchema.test.ts`
 * 会断言契约里的每个 key 都有标签，漏一处直接红。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { FACT_KINDS } from "./constants";
import type { FactKind } from "./types";

/** 契约 §3 的默认字段 key（顺序与后端 fact_field_schema.py 一致）。 */
export const DEFAULT_FIELD_KEYS: Record<FactKind, readonly string[]> = {
  publication: [
    "title",
    "authors",
    "venue",
    "year",
    "status",
    "doi",
    "url",
    "volume_pages",
    "note",
  ],
  research_project: [
    "name",
    "role",
    "organization",
    "start_date",
    "end_date",
    "funding",
    "description",
    "outcomes",
  ],
  patent: [
    "title",
    "inventors",
    "patent_number",
    "country",
    "status",
    "filed_date",
    "granted_date",
    "url",
  ],
  credential: [
    "name",
    "issuer",
    "issue_date",
    "expiry_date",
    "status",
    "credential_number",
    "verify_url",
    "note",
  ],
  work_project: [
    "name",
    "role",
    "start_date",
    "end_date",
    "tech_stack",
    "description",
    "highlights",
    "public_url",
    "artifact_type",
  ],
  practice: ["organization", "role", "experience_kind", "start_date", "end_date", "description"],
  award: ["name", "issuer", "date", "level", "description"],
  training: ["name", "organization", "start_date", "end_date", "hours", "description", "outcomes"],
  language: ["name", "level", "certificate", "score", "date"],
};

/**
 * 默认字段 key → 语言包 key。状态/作者等与制作台科研板块共用文案（同一实体一个叫法）；
 * 新增 3 类（award/training/language）用本批新增的 `profileFacts.*` key。
 */
export const DEFAULT_FIELD_LABEL_KEYS: Record<FactKind, Record<string, MessageKey>> = {
  publication: {
    title: "research.publications.title",
    authors: "research.authors.label",
    venue: "research.publications.venue",
    year: "research.publications.year",
    status: "research.publications.status",
    doi: "research.publications.doi",
    url: "research.publications.url",
    volume_pages: "research.publications.volumePages",
    note: "research.publications.note",
  },
  research_project: {
    name: "research.projects.name",
    role: "research.projects.role",
    organization: "research.projects.organization",
    start_date: "research.projects.start",
    end_date: "research.projects.end",
    funding: "research.projects.funding",
    description: "research.projects.description",
    outcomes: "research.projects.outcomes",
  },
  patent: {
    title: "research.patents.name",
    inventors: "research.inventors.label",
    patent_number: "research.patents.number",
    country: "research.patents.country",
    status: "research.patents.status",
    filed_date: "research.patents.filed",
    granted_date: "research.patents.granted",
    url: "research.patents.url",
  },
  credential: {
    name: "profileFacts.credential.name",
    issuer: "profileFacts.credential.issuer",
    issue_date: "profileFacts.credential.issueDate",
    expiry_date: "profileFacts.credential.expiryDate",
    status: "profileFacts.credential.status",
    credential_number: "profileFacts.credential.number",
    verify_url: "profileFacts.credential.verifyUrl",
    note: "profileFacts.credential.note",
  },
  work_project: {
    name: "profileFacts.workProject.name",
    role: "profileFacts.workProject.role",
    start_date: "profileFacts.workProject.start",
    end_date: "profileFacts.workProject.end",
    tech_stack: "profileFacts.workProject.techStack",
    description: "profileFacts.workProject.description",
    highlights: "profileFacts.workProject.highlights",
    public_url: "profileFacts.workProject.publicUrl",
    artifact_type: "profileFacts.workProject.artifactType",
  },
  practice: {
    organization: "profileFacts.practice.organization",
    role: "profileFacts.practice.role",
    experience_kind: "profileFacts.practice.kind",
    start_date: "profileFacts.practice.start",
    end_date: "profileFacts.practice.end",
    description: "profileFacts.practice.description",
  },
  award: {
    name: "profileFacts.award.name",
    issuer: "profileFacts.award.issuer",
    date: "profileFacts.award.date",
    level: "profileFacts.award.level",
    description: "profileFacts.award.description",
  },
  training: {
    name: "profileFacts.training.name",
    organization: "profileFacts.training.organization",
    start_date: "profileFacts.training.start",
    end_date: "profileFacts.training.end",
    hours: "profileFacts.training.hours",
    description: "profileFacts.training.description",
    outcomes: "profileFacts.training.outcomes",
  },
  language: {
    name: "profileFacts.language.name",
    level: "profileFacts.language.level",
    certificate: "profileFacts.language.certificate",
    score: "profileFacts.language.score",
    date: "profileFacts.language.date",
  },
};

/** 默认字段的中文标签；未知 key（后端比前端新）原样显示 key，不猜翻译。 */
export function defaultFieldLabel(kind: FactKind, key: string): string {
  const labelKey = DEFAULT_FIELD_LABEL_KEYS[kind][key];
  return labelKey ? t(labelKey) : key;
}

/** 全部类型的默认字段 key（顺序稳定；schema 缺失时用于兜底与测试）。 */
export function defaultFieldsFor(kind: FactKind): string[] {
  return [...DEFAULT_FIELD_KEYS[kind]];
}

export { FACT_KINDS };
