// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」的字段/分区/枚举标签表（从 fieldLayout.ts 按 500 行预算拆出）。
 * fieldLayout.ts 仍重新导出这些名字，既有导入路径（面板、测试）不变。
 */
import type { MessageKey } from "../../i18n";
import type { FieldLayoutAlign, FieldLayoutColumns, FieldLayoutSection } from "./fieldLayout";

/** 各分区可调整的字段（顺序 = 默认顺序，与后端 PROFILE_FIELD_ORDER 一致）。 */
export const FIELD_LAYOUT_FIELDS: Record<FieldLayoutSection, readonly string[]> = {
  education: ["study_form", "degree_type", "department", "rank", "advisor", "research_direction"],
  experience: ["team_size"],
  campus_experience: ["activity_type"],
  projects: ["project_size"],
  awards: ["issuer", "level", "ratio"],
  publications: ["outcome_type", "my_rank"],
  research_projects: ["level"],
};

/** 字段标签复用编辑器既有词条（不新造一批同义词）。 */
export const FIELD_LABEL_KEYS: Record<string, MessageKey> = {
  "education:study_form": "editor.field.studyForm",
  "education:degree_type": "editor.field.degreeType",
  "education:department": "editor.field.department",
  "education:rank": "editor.field.classRank",
  "education:advisor": "editor.field.advisor",
  "education:research_direction": "editor.field.researchDirection",
  "experience:team_size": "editor.field.teamSize",
  "campus_experience:activity_type": "editor.field.activityType",
  "projects:project_size": "editor.field.projectSize",
  "awards:issuer": "editor.field.issuer",
  "awards:level": "editor.field.awardLevel",
  "awards:ratio": "editor.field.awardRatio",
  "publications:outcome_type": "research.publications.outcomeType",
  "publications:my_rank": "research.publications.myRank",
  "research_projects:level": "research.projects.level",
};

export const SECTION_LABEL_KEYS: Record<FieldLayoutSection, MessageKey> = {
  education: "outline.section.education",
  experience: "outline.section.experience",
  campus_experience: "outline.section.campus_experience",
  projects: "outline.section.projects",
  awards: "outline.section.awards",
  publications: "research.tab.publications",
  research_projects: "research.tab.projects",
};

export const COLUMN_LABEL_KEYS: Record<FieldLayoutColumns, MessageKey> = {
  1: "typography.fieldLayout.columns.1",
  2: "typography.fieldLayout.columns.2",
  3: "typography.fieldLayout.columns.3",
};

export const ALIGN_LABEL_KEYS: Record<FieldLayoutAlign, MessageKey> = {
  equal: "typography.fieldLayout.align.equal",
  flow: "typography.fieldLayout.align.flow",
};
