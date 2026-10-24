// SPDX-License-Identifier: Apache-2.0
/**
 * 双语**字段对照**的生成规则（W16 / D07、D15）：把两份 content 摊成"同一字段左右并排"的行。
 *
 * ## 为什么用"字段规格表"而不是写死一组 UI
 *
 * 字段对照必须跟着 `ResumeContent` 的结构走：教育有几个条目、经历有几个字段，都由数据决定。
 * 所以这里只维护一份**规格表**（分组 → 字段 → 文案 key → 是否多行 → 是否事实锁），
 * 行数由数据生成。新增字段只改这张表，组件与测试不用动。
 *
 * ## 事实锁（locked）
 *
 * 姓名 / 机构 / 时间 / 数字 / 职责边界不参与翻译改写（Wave3 §2.3）。这里只做**标记**：
 * 界面据此禁用"采纳这条翻译"；真正的拒写在服务端（W12 的 `resume_fact_lock`）。
 */
import type { ResumeContent } from "../../types/resumeContent";
import { getByPath } from "../resume/useRichTextOverrides";
import type { BilingualGroup, BilingualPair } from "./types";

interface FieldSpec {
  /** content 里的字段名（也是 data-resume-path 的末段）。 */
  field: string;
  /** 文案 key（`bilingual.field.*`）。 */
  labelKey: string;
  /** 多行字段（数组）用换行连接展示。 */
  kind: "text" | "lines";
  locked?: boolean;
}

interface SectionSpec {
  group: BilingualGroup;
  /** content 里的数组字段名。 */
  array: string;
  fields: FieldSpec[];
}

/** 页眉字段（不属于任何板块）。 */
export const HEADER_FIELDS: readonly FieldSpec[] = [
  { field: "name", labelKey: "bilingual.field.name", kind: "text", locked: true },
  { field: "gender", labelKey: "bilingual.field.gender", kind: "text" },
  { field: "job_intent", labelKey: "bilingual.field.job_intent", kind: "text" },
  { field: "phone", labelKey: "bilingual.field.phone", kind: "text", locked: true },
  { field: "email", labelKey: "bilingual.field.email", kind: "text" },
  { field: "city", labelKey: "bilingual.field.city", kind: "text" },
  { field: "github", labelKey: "bilingual.field.github", kind: "text" },
  { field: "personal_website", labelKey: "bilingual.field.personal_website", kind: "text" },
];

/** 七个板块 + 个人总结的字段规格。 */
export const SECTION_FIELDS: readonly SectionSpec[] = [
  {
    group: "education",
    array: "education",
    fields: [
      { field: "school", labelKey: "bilingual.field.school", kind: "text", locked: true },
      { field: "major", labelKey: "bilingual.field.major", kind: "text", locked: true },
      { field: "degree", labelKey: "bilingual.field.degree", kind: "text" },
      { field: "start_date", labelKey: "bilingual.field.start_date", kind: "text", locked: true },
      { field: "end_date", labelKey: "bilingual.field.end_date", kind: "text", locked: true },
      { field: "gpa", labelKey: "bilingual.field.gpa", kind: "text", locked: true },
      { field: "courses", labelKey: "bilingual.field.courses", kind: "lines" },
      { field: "achievements", labelKey: "bilingual.field.achievements", kind: "lines" },
    ],
  },
  {
    group: "experience",
    array: "experience",
    fields: [
      { field: "company", labelKey: "bilingual.field.company", kind: "text", locked: true },
      { field: "role", labelKey: "bilingual.field.role", kind: "text" },
      { field: "start_date", labelKey: "bilingual.field.start_date", kind: "text", locked: true },
      { field: "end_date", labelKey: "bilingual.field.end_date", kind: "text", locked: true },
      { field: "description", labelKey: "bilingual.field.description", kind: "lines" },
    ],
  },
  {
    group: "projects",
    array: "projects",
    fields: [
      { field: "name", labelKey: "bilingual.field.project_name", kind: "text", locked: true },
      { field: "role", labelKey: "bilingual.field.role", kind: "text" },
      { field: "start_date", labelKey: "bilingual.field.start_date", kind: "text", locked: true },
      { field: "end_date", labelKey: "bilingual.field.end_date", kind: "text", locked: true },
      { field: "tech_stack", labelKey: "bilingual.field.tech_stack", kind: "lines" },
      { field: "description", labelKey: "bilingual.field.description", kind: "lines" },
      { field: "highlights", labelKey: "bilingual.field.highlights", kind: "lines" },
    ],
  },
  {
    group: "campus",
    array: "campus_experience",
    fields: [
      {
        field: "organization",
        labelKey: "bilingual.field.organization",
        kind: "text",
        locked: true,
      },
      { field: "role", labelKey: "bilingual.field.role", kind: "text" },
      { field: "start_date", labelKey: "bilingual.field.start_date", kind: "text", locked: true },
      { field: "end_date", labelKey: "bilingual.field.end_date", kind: "text", locked: true },
      { field: "description", labelKey: "bilingual.field.description", kind: "lines" },
    ],
  },
  {
    group: "skills",
    array: "skills",
    fields: [
      { field: "name", labelKey: "bilingual.field.skill_name", kind: "text" },
      { field: "level", labelKey: "bilingual.field.skill_level", kind: "text" },
    ],
  },
  {
    group: "awards",
    array: "awards",
    fields: [
      { field: "name", labelKey: "bilingual.field.award_name", kind: "text" },
      { field: "date", labelKey: "bilingual.field.date", kind: "text", locked: true },
      { field: "description", labelKey: "bilingual.field.award_description", kind: "text" },
    ],
  },
];

/** 读一个路径的值并摊成展示文本：字符串原样、数组换行连接、其它忽略。 */
export function readFieldText(content: ResumeContent | null, path: string): string {
  if (!content) return "";
  const value = getByPath(content, path);
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .join("\n")
      .trim();
  }
  return "";
}

function pairStatus(primary: string, secondary: string): BilingualPair["status"] {
  if (!primary && !secondary) return "empty";
  return primary === secondary ? "same" : "changed";
}

/**
 * 生成字段对照行：页眉 → 个人总结 → 各板块（按**两边条目数的较大值**展开）。
 *
 * 一侧条目更多时，多出的行另一侧为空串（`changed`）——这正是"英文版还没翻这条"的可见状态，
 * 不能因为对侧没有就整行不显示。
 */
export function buildBilingualPairs(
  primary: ResumeContent | null,
  secondary: ResumeContent | null,
): BilingualPair[] {
  const rows: BilingualPair[] = [];
  const push = (
    group: BilingualGroup,
    path: string,
    labelKey: string,
    locked: boolean,
    kind: "text" | "lines",
  ) => {
    const left = readFieldText(primary, path);
    const right = readFieldText(secondary, path);
    rows.push({
      id: path,
      group,
      path,
      labelKey,
      primary: left,
      secondary: right,
      locked,
      status: pairStatus(left, right),
    });
    void kind;
  };

  for (const field of HEADER_FIELDS) {
    push("header", field.field, field.labelKey, field.locked === true, field.kind);
  }
  push("summary", "summary", "bilingual.field.summary", false, "text");

  for (const section of SECTION_FIELDS) {
    const leftItems = getByPath(primary, section.array);
    const rightItems = getByPath(secondary, section.array);
    const leftCount = Array.isArray(leftItems) ? leftItems.length : 0;
    const rightCount = Array.isArray(rightItems) ? rightItems.length : 0;
    const count = Math.max(leftCount, rightCount);
    for (let index = 0; index < count; index += 1) {
      for (const field of section.fields) {
        push(
          section.group,
          section.array + "." + index + "." + field.field,
          field.labelKey,
          field.locked === true,
          field.kind,
        );
      }
    }
  }
  return rows;
}

/** 只保留有内容或有差异的行（对照视图的默认展开集合）。 */
export function changedPairs(pairs: readonly BilingualPair[]): BilingualPair[] {
  return pairs.filter((pair) => pair.status !== "empty");
}
