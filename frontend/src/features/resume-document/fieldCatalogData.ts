// SPDX-License-Identifier: Apache-2.0
/**
 * 字段目录的**离线 fallback** 与查询帮助（纯函数）。
 *
 * ## 唯一真相在后端
 *
 * 目录由 `GET /api/profile/field-placement-catalog` 下发（标签、默认位置、material_only、
 * 枚举选项都由服务端给）。本文件只在三种情况下兜底：旧后端 / 接口失败 / 组件单测。
 * fallback **不参与保存口径**，也不会覆盖后端下发的任何值。
 *
 * ## 默认位置（计划 §4，前端唯一一份副本）
 *
 * 短文本 / 日期 / 枚举 → trail；多行 → body；仅素材 → hidden + material_only 标记。
 * 后端 `document_catalog.py` 改动时要同步这里（测试会对比字段集合）。
 */
import type { MessageKey } from "../../i18n";
import type {
  HeaderCatalogField,
  ItemFormat,
  Placement,
  SectionKind,
} from "../../types/resumeDocument";

/** 目录里一条字段的 fallback 描述（label 是 MessageKey，渲染时再取语言）。 */
export interface FallbackFieldSpec {
  key: string;
  labelKey: MessageKey;
  format?: ItemFormat;
  default_placement?: Placement;
  /** 只用于生成素材、不上纸面。 */
  material_only?: boolean;
  /** 枚举选项（value + labelKey）；format=enum 时必须有。 */
  enumOptions?: readonly { value: string; labelKey: MessageKey }[];
}

export interface FallbackSectionSpec {
  /** 与后端板块键一致（education / publications …）。 */
  key: string;
  titleKey: MessageKey;
  kind: SectionKind;
  profileSectionKey: string;
  fields: readonly FallbackFieldSpec[];
}

const EXPERIENCE_KIND_OPTIONS = [
  { value: "full_time", labelKey: "editor.jobKind.fullTime" },
  { value: "part_time", labelKey: "editor.jobKind.partTime" },
  { value: "contract", labelKey: "editor.jobKind.contract" },
  { value: "self_employed", labelKey: "editor.jobKind.selfEmployed" },
  { value: "internship", labelKey: "editor.jobKind.internship" },
  { value: "volunteer", labelKey: "editor.jobKind.volunteer" },
  { value: "other", labelKey: "editor.jobKind.other" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

const PUBLICATION_STATUS_OPTIONS = [
  { value: "published", labelKey: "research.status.published" },
  { value: "accepted", labelKey: "research.status.accepted" },
  { value: "in_press", labelKey: "research.status.in_press" },
  { value: "under_review", labelKey: "research.status.under_review" },
  { value: "preprint", labelKey: "research.status.preprint" },
  { value: "other", labelKey: "research.status.other" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

const PATENT_STATUS_OPTIONS = [
  { value: "granted", labelKey: "research.patentStatus.granted" },
  { value: "pending", labelKey: "research.patentStatus.pending" },
  { value: "filed", labelKey: "research.patentStatus.filed" },
  { value: "expired", labelKey: "research.patentStatus.expired" },
  { value: "other", labelKey: "research.patentStatus.other" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

const CREDENTIAL_STATUS_OPTIONS = [
  { value: "unknown", labelKey: "credentials.credentialStatus.unknown" },
  { value: "pending", labelKey: "credentials.credentialStatus.pending" },
  { value: "active", labelKey: "credentials.credentialStatus.active" },
  { value: "expired", labelKey: "credentials.credentialStatus.expired" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

const DATE_RANGE: ItemFormat = "date_range";
const DATE: ItemFormat = "date";

/** 系统板块与字段的 fallback 目录（顺序即页签/菜单顺序）。 */
export const FALLBACK_SECTIONS: readonly FallbackSectionSpec[] = [
  {
    key: "education",
    titleKey: "editor.section.education",
    kind: "entries",
    profileSectionKey: "educations",
    fields: [
      { key: "school", labelKey: "editor.field.school", default_placement: "title" },
      { key: "major", labelKey: "editor.field.major", default_placement: "title" },
      { key: "degree", labelKey: "editor.field.degree", default_placement: "meta" },
      {
        key: "period",
        labelKey: "document.field.period",
        format: DATE_RANGE,
        default_placement: "meta",
      },
      { key: "gpa", labelKey: "editor.field.gpa", default_placement: "lead" },
      {
        key: "courses",
        labelKey: "editor.field.courses",
        format: "list",
        default_placement: "lead",
      },
      { key: "study_form", labelKey: "editor.field.studyForm", default_placement: "trail" },
      { key: "degree_type", labelKey: "editor.field.degreeType", default_placement: "trail" },
      { key: "department", labelKey: "editor.field.department", default_placement: "trail" },
      { key: "rank", labelKey: "editor.field.classRank", default_placement: "trail" },
      { key: "advisor", labelKey: "editor.field.advisor", default_placement: "trail" },
      {
        key: "research_direction",
        labelKey: "editor.field.researchDirection",
        default_placement: "trail",
      },
      {
        key: "achievements",
        labelKey: "editor.field.studyAchievements",
        default_placement: "body",
      },
    ],
  },
  {
    key: "experience",
    titleKey: "editor.section.experience",
    kind: "entries",
    profileSectionKey: "experiences",
    fields: [
      { key: "company", labelKey: "editor.field.company", default_placement: "title" },
      { key: "role", labelKey: "editor.field.expRole", default_placement: "title" },
      {
        key: "period",
        labelKey: "document.field.period",
        format: DATE_RANGE,
        default_placement: "meta",
      },
      { key: "team_size", labelKey: "editor.field.teamSize", default_placement: "trail" },
      {
        key: "experience_kind",
        labelKey: "editor.field.jobKind",
        format: "enum",
        default_placement: "trail",
        enumOptions: EXPERIENCE_KIND_OPTIONS,
      },
      { key: "description", labelKey: "editor.field.expDescription", default_placement: "body" },
    ],
  },
  {
    key: "projects",
    titleKey: "editor.section.projects",
    kind: "entries",
    profileSectionKey: "projects",
    fields: [
      { key: "name", labelKey: "editor.field.projectName", default_placement: "title" },
      { key: "role", labelKey: "editor.field.projectRole", default_placement: "meta" },
      {
        key: "period",
        labelKey: "document.field.period",
        format: DATE_RANGE,
        default_placement: "meta",
      },
      { key: "project_size", labelKey: "editor.field.projectSize", default_placement: "trail" },
      {
        key: "tech_stack",
        labelKey: "editor.field.techStack",
        format: "list",
        default_placement: "trail",
      },
      { key: "artifact_type", labelKey: "editor.field.artifactType", default_placement: "trail" },
      {
        key: "public_url",
        labelKey: "document.field.publicUrl",
        format: "url",
        default_placement: "trail",
      },
      {
        key: "description",
        labelKey: "editor.field.projectDescription",
        default_placement: "body",
      },
      { key: "highlights", labelKey: "editor.field.highlights", default_placement: "body" },
    ],
  },
  {
    key: "campus_experience",
    titleKey: "editor.section.campus",
    kind: "entries",
    profileSectionKey: "campus_experiences",
    fields: [
      { key: "organization", labelKey: "editor.field.organization", default_placement: "title" },
      { key: "role", labelKey: "editor.field.campusRole", default_placement: "title" },
      {
        key: "period",
        labelKey: "document.field.period",
        format: DATE_RANGE,
        default_placement: "meta",
      },
      { key: "activity_type", labelKey: "editor.field.activityType", default_placement: "trail" },
      { key: "description", labelKey: "editor.field.campusDescription", default_placement: "body" },
    ],
  },
  {
    key: "awards",
    titleKey: "editor.section.awards",
    kind: "entries",
    profileSectionKey: "awards",
    fields: [
      { key: "name", labelKey: "editor.field.awardName", default_placement: "title" },
      { key: "date", labelKey: "editor.field.awardDate", format: DATE, default_placement: "meta" },
      { key: "issuer", labelKey: "editor.field.issuer", default_placement: "trail" },
      { key: "level", labelKey: "editor.field.awardLevel", default_placement: "trail" },
      { key: "ratio", labelKey: "editor.field.awardRatio", default_placement: "trail" },
      { key: "description", labelKey: "editor.field.notes", default_placement: "body" },
    ],
  },
  {
    key: "publications",
    titleKey: "research.tab.publications",
    kind: "entries",
    profileSectionKey: "publications",
    fields: [
      { key: "title", labelKey: "research.publications.title", default_placement: "title" },
      { key: "venue", labelKey: "research.publications.venue", default_placement: "meta" },
      { key: "year", labelKey: "research.publications.year", default_placement: "meta" },
      {
        key: "status",
        labelKey: "research.publications.status",
        format: "enum",
        default_placement: "meta",
        enumOptions: PUBLICATION_STATUS_OPTIONS,
      },
      {
        key: "authors",
        labelKey: "research.authors.label",
        format: "authors",
        default_placement: "trail",
      },
      {
        key: "outcome_type",
        labelKey: "research.publications.outcomeType",
        default_placement: "trail",
      },
      { key: "my_rank", labelKey: "research.publications.myRank", default_placement: "trail" },
      {
        key: "volume_pages",
        labelKey: "research.publications.volumePages",
        default_placement: "trail",
      },
      { key: "doi", labelKey: "research.publications.doi", default_placement: "trail" },
      {
        key: "url",
        labelKey: "research.publications.url",
        format: "url",
        default_placement: "trail",
      },
      { key: "note", labelKey: "research.publications.note", default_placement: "trail" },
    ],
  },
  {
    key: "research_projects",
    titleKey: "research.tab.projects",
    kind: "entries",
    profileSectionKey: "research_projects",
    fields: [
      { key: "name", labelKey: "research.projects.name", default_placement: "title" },
      { key: "role", labelKey: "research.projects.role", default_placement: "title" },
      {
        key: "organization",
        labelKey: "research.projects.organization",
        default_placement: "meta",
      },
      {
        key: "period",
        labelKey: "document.field.period",
        format: DATE_RANGE,
        default_placement: "meta",
      },
      { key: "level", labelKey: "research.projects.level", default_placement: "trail" },
      { key: "funding", labelKey: "research.projects.funding", default_placement: "trail" },
      { key: "description", labelKey: "research.projects.description", default_placement: "body" },
      { key: "outcomes", labelKey: "research.projects.outcomes", default_placement: "body" },
    ],
  },
  {
    key: "patents",
    titleKey: "research.tab.patents",
    kind: "entries",
    profileSectionKey: "patents",
    fields: [
      { key: "title", labelKey: "research.patents.name", default_placement: "title" },
      { key: "patent_number", labelKey: "research.patents.number", default_placement: "meta" },
      { key: "country", labelKey: "research.patents.country", default_placement: "meta" },
      {
        key: "status",
        labelKey: "research.patents.status",
        format: "enum",
        default_placement: "meta",
        enumOptions: PATENT_STATUS_OPTIONS,
      },
      {
        key: "inventors",
        labelKey: "research.inventors.label",
        format: "authors",
        default_placement: "trail",
      },
      {
        key: "filed_date",
        labelKey: "research.patents.filed",
        format: DATE,
        default_placement: "trail",
      },
      {
        key: "granted_date",
        labelKey: "research.patents.granted",
        format: DATE,
        default_placement: "trail",
      },
      { key: "url", labelKey: "research.patents.url", format: "url", default_placement: "trail" },
      {
        key: "outcome_type",
        labelKey: "research.publications.outcomeType",
        default_placement: "hidden",
        material_only: true,
      },
    ],
  },
  {
    key: "credentials",
    titleKey: "editor.tab.credentials",
    kind: "entries",
    profileSectionKey: "credentials",
    fields: [
      { key: "name", labelKey: "credentials.credential.name", default_placement: "title" },
      { key: "issuer", labelKey: "credentials.credential.issuer", default_placement: "meta" },
      {
        key: "status",
        labelKey: "credentials.credential.status",
        format: "enum",
        default_placement: "meta",
        enumOptions: CREDENTIAL_STATUS_OPTIONS,
      },
      {
        key: "credential_type",
        labelKey: "credentials.credential.credentialType",
        default_placement: "trail",
      },
      {
        key: "issue_date",
        labelKey: "credentials.credential.issueDate",
        format: DATE,
        default_placement: "trail",
      },
      {
        key: "expiry_date",
        labelKey: "credentials.credential.expiryDate",
        format: DATE,
        default_placement: "trail",
      },
      {
        key: "verify_url",
        labelKey: "credentials.credential.verifyUrl",
        format: "url",
        default_placement: "trail",
      },
      { key: "note", labelKey: "credentials.credential.note", default_placement: "trail" },
    ],
  },
  {
    key: "skills",
    titleKey: "editor.section.skills",
    kind: "inline",
    profileSectionKey: "skills",
    fields: [
      { key: "category", labelKey: "editor.field.skillCategory", default_placement: "trail" },
      { key: "name", labelKey: "editor.field.skillName", default_placement: "body" },
      { key: "level", labelKey: "editor.field.skillLevel", default_placement: "body" },
    ],
  },
  {
    key: "languages",
    titleKey: "editor.section.languages",
    kind: "inline",
    profileSectionKey: "languages",
    fields: [
      {
        key: "obtained_at",
        labelKey: "editor.field.languageObtained",
        format: DATE,
        default_placement: "trail",
      },
      { key: "name", labelKey: "editor.field.language", default_placement: "body" },
      { key: "level", labelKey: "editor.field.languageLevel", default_placement: "body" },
      {
        key: "certificate",
        labelKey: "editor.field.languageCertificate",
        default_placement: "body",
      },
      { key: "score", labelKey: "editor.field.languageScore", default_placement: "body" },
    ],
  },
  {
    key: "summary",
    titleKey: "editor.field.summary",
    kind: "text",
    profileSectionKey: "summary",
    fields: [{ key: "content", labelKey: "editor.field.summary", default_placement: "body" }],
  },
];

/** 页眉字段的 fallback 目录（placement 即页眉内的位置）。 */
export const FALLBACK_HEADER_FIELDS: readonly {
  key: string;
  labelKey: MessageKey;
  placement: HeaderCatalogField["placement"];
  format?: ItemFormat;
}[] = [
  { key: "name", labelKey: "document.headerField.name", placement: "name" },
  { key: "gender", labelKey: "document.headerField.gender", placement: "name_meta" },
  { key: "birth_year", labelKey: "document.headerField.birth_year", placement: "name_meta" },
  { key: "job_intent", labelKey: "document.headerField.job_intent", placement: "subtitle" },
  { key: "phone", labelKey: "document.headerField.phone", placement: "contact" },
  { key: "email", labelKey: "document.headerField.email", placement: "contact" },
  { key: "city", labelKey: "document.headerField.city", placement: "contact" },
  { key: "github", labelKey: "document.headerField.github", placement: "contact" },
  {
    key: "personal_website",
    labelKey: "document.headerField.personal_website",
    placement: "contact",
  },
  { key: "photo", labelKey: "document.headerField.photo", placement: "photo" },
];

/** fallback 字段的默认形式（下拉/日期范围/作者等控件选择依据）。 */
export function fallbackFormatOf(spec: FallbackFieldSpec): ItemFormat {
  return spec.format ?? "text";
}
