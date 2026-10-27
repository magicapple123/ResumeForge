// SPDX-License-Identifier: Apache-2.0
import { SECTION_LABELS } from "../components/profile/ProfileSectionConfig";
import type { RecognitionReviewRow } from "../components/profile/RecognitionReviewList";
import type {
  Profile,
  ProfileTextParseResult,
  WebFormExtraProfileParsedItem,
  WebFormField,
} from "../types";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";

export type EditableProfileValues = Omit<Profile, "id" | "updated_at">;

const SCALAR_FIELDS = [
  "name",
  "gender",
  "birth_year",
  "phone",
  "email",
  "city",
  "target_city",
  "job_intent",
  "personal_website",
  "github",
  "summary",
] as const satisfies ReadonlyArray<keyof EditableProfileValues>;

const LIST_FIELDS = [
  "educations",
  "experiences",
  "campus_experiences",
  "projects",
  "skills",
  "awards",
] as const satisfies ReadonlyArray<keyof EditableProfileValues>;

type ScalarField = (typeof SCALAR_FIELDS)[number];
type ListField = (typeof LIST_FIELDS)[number];

/**
 * 标量字段的中文名（校对列表的行标题）。
 *
 * 与资料表单里各分区组件的 `label` 逐字对应；改表单文案时这里要跟着改，
 * 否则校对卡会显示"和页面上不一样的名字"。
 */
const SCALAR_LABELS: Record<ScalarField, MessageKey> = {
  name: "editor.field.personName",
  gender: "editor.field.gender",
  birth_year: "editor.field.birthYear",
  phone: "editor.field.phone",
  email: "editor.field.email",
  city: "editor.field.city",
  target_city: "editor.field.targetCity",
  job_intent: "editor.field.jobIntent",
  personal_website: "editor.field.website",
  github: "editor.field.github",
  summary: "editor.field.summary",
};

/**
 * 列表字段里**每个子字段**的中文名与形态。
 *
 * `id` / `reference_file_name` / `reference_content` 刻意不在表里：前两个是内部字段，
 * 参考资料是旧版本兼容字段（界面已无入口），让它们在"校对"里出现等于请用户确认一个
 * 他看不见的东西。
 */
const LIST_ITEM_FIELDS: Record<ListField, Record<string, MessageKey>> = {
  educations: {
    school: "editor.field.school",
    department: "editor.field.department",
    major: "editor.field.major",
    degree: "editor.field.degree",
    study_mode: "editor.field.studyForm",
    degree_type: "editor.field.degreeType",
    start_date: "editor.field.startDate",
    end_date: "editor.field.endDate",
    gpa: "editor.field.gpa",
    cet4_score: "editor.field.cet4",
    cet6_score: "editor.field.cet6",
    courses: "editor.field.courses",
    achievements: "editor.field.studyAchievements",
  },
  experiences: {
    company: "editor.field.company",
    role: "editor.field.expRole",
    start_date: "editor.field.startDate",
    end_date: "editor.field.endDate",
    description: "editor.field.expDescription",
  },
  campus_experiences: {
    organization: "editor.field.organization",
    role: "editor.field.campusRole",
    start_date: "editor.field.startDate",
    end_date: "editor.field.endDate",
    description: "editor.field.campusDescription",
  },
  projects: {
    name: "editor.field.projectName",
    role: "editor.field.projectRole",
    start_date: "editor.field.startDate",
    end_date: "editor.field.endDate",
    tech_stack: "editor.field.techStack",
    description: "editor.field.projectDescription",
    highlights: "editor.field.highlights",
  },
  skills: {
    name: "editor.field.skillName",
    level: "editor.field.skillLevel",
  },
  awards: {
    name: "editor.field.awardName",
    date: "editor.field.awardDate",
    description: "editor.field.notes",
  },
};

/** 需要多行输入的子字段（其余都是单行）。 */
const MULTILINE_KEYS = new Set(["summary", "description", "courses", "achievements", "highlights"]);

/**
 * Merge a parser draft without treating omitted sections as delete requests.
 * The parser returns a complete schema with empty defaults, while a user may
 * intentionally paste only one experience or project into an existing profile.
 */
export function mergeParsedProfileValues(
  current: EditableProfileValues,
  parsed: ProfileTextParseResult,
): EditableProfileValues {
  const next: EditableProfileValues = { ...current };

  for (const field of SCALAR_FIELDS) {
    const value = parsed[field];
    if (typeof value === "string" && value.trim()) {
      next[field] = value;
    }
  }
  for (const field of LIST_FIELDS) {
    const value = parsed[field];
    if (Array.isArray(value) && value.length > 0) {
      // Indexed assignment over a union of array fields becomes an
      // intersection in TypeScript; Object.assign preserves the exact field
      // selected at runtime without weakening the public profile shape.
      Object.assign(next, { [field]: value });
    }
  }

  return next;
}

/**
 * 识别结果 → 校对清单（项 13）。
 *
 * 空值不出行：清单要回答"识别到了什么"，塞一堆空输入框只会让用户以为识别质量很差。
 * 列表字段**拍平到子字段级**（一行一个值），而不是一行一整条经历——那样用户没法只改
 * 「专业」而保留「学校」。
 */
export function profileToReviewRows(parsed: ProfileTextParseResult): RecognitionReviewRow[] {
  const rows: RecognitionReviewRow[] = [];

  for (const field of SCALAR_FIELDS) {
    const value = parsed[field];
    if (typeof value !== "string" || !value.trim()) continue;
    rows.push({
      id: field,
      section: field === "summary" ? SECTION_LABELS.summary : SECTION_LABELS.basic_info,
      label: t(SCALAR_LABELS[field]),
      value,
      multiline: MULTILINE_KEYS.has(field),
    });
  }

  for (const field of LIST_FIELDS) {
    const items = parsed[field] as unknown;
    if (!Array.isArray(items)) continue;
    const fieldLabels = LIST_ITEM_FIELDS[field];
    items.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      for (const [key, label] of Object.entries(fieldLabels)) {
        const raw = (item as Record<string, unknown>)[key];
        if (typeof raw !== "string" || !raw.trim()) continue;
        rows.push({
          id: `${field}.${index}.${key}`,
          section: SECTION_LABELS[field],
          label: t(label),
          value: raw,
          multiline: MULTILINE_KEYS.has(key),
        });
      }
    });
  }

  return rows;
}

/**
 * 校对清单 → 只含**被改过**的值的补丁。
 *
 * 为什么需要 `baseline`（识别结果本身）：补丁要能区分"用户改了这一行"与"这一行原样"。
 * 没有基线时只能整体回填，那样 `id` 之类没进清单的字段会被整段覆盖（后端会把它当成
 * 一条新记录）。有基线时我们**从基线克隆**再打补丁，没改的字段一个都不出现在结果里。
 *
 * 返回 `{}` 就是"什么都没改"——这是 `profileToReviewRows` → 本函数往返无损的判据。
 */
export function reviewRowsToProfile(
  rows: RecognitionReviewRow[],
  baseline: EditableProfileValues | null = null,
): Partial<Profile> {
  const result: Record<string, unknown> = {};
  const listDrafts = new Map<ListField, Record<string, unknown>[]>();
  const touchedLists = new Set<ListField>();

  for (const row of rows) {
    // 网申侧新增字段由网申那条链路处理，这里只回填资料表单认识的字段。
    if (row.isNew) continue;
    const parts = row.id.split(".");

    if (parts.length === 1) {
      const field = parts[0] as ScalarField;
      if (!SCALAR_FIELDS.includes(field)) continue;
      const original = baseline ? String(baseline[field] ?? "") : "";
      if (baseline && row.value === original) continue;
      result[field] = row.value;
      continue;
    }

    const [head, indexText, key] = parts;
    const field = head as ListField;
    if (!LIST_FIELDS.includes(field) || !key) continue;
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 0) continue;

    let items = listDrafts.get(field);
    if (!items) {
      const source = baseline?.[field] as unknown as Record<string, unknown>[] | undefined;
      items = Array.isArray(source) ? source.map((item) => ({ ...item })) : [];
      listDrafts.set(field, items);
    }
    const item = { ...(items[index] ?? {}) };
    const original = typeof item[key] === "string" ? (item[key] as string) : "";
    if (baseline && row.value === original) continue;
    item[key] = row.value;
    items[index] = item;
    touchedLists.add(field);
  }

  for (const field of touchedLists) {
    result[field] = listDrafts.get(field);
  }
  return result as Partial<Profile>;
}

/**
 * 「网申资料」识别结果 → 校对清单（项 12 / D21）。
 *
 * 与资料侧的两个差别：
 * - 分组标题用**后端下发的 `field.group`**（它本身就是中文），不自建一套分区名；
 * - 目录外的新字段进 `isNew` 行（默认不勾选），因为写进去等于**新增一个字段**，
 *   必须由用户逐条确认。
 *
 * 目录行**按 `fields` 的顺序**输出（不是 `values` 的键序）：用户核对时看到的顺序应该和
 * 他正在填的网申表单一致。目录外的键（不该出现在 `values` 里）一并忽略。
 */
export function webformToReviewRows(
  values: Record<string, string>,
  custom: WebFormExtraProfileParsedItem[],
  fields: WebFormField[],
): RecognitionReviewRow[] {
  const rows: RecognitionReviewRow[] = [];
  for (const field of fields) {
    const value = values[field.key];
    if (typeof value !== "string" || !value.trim()) continue;
    rows.push({
      id: field.key,
      section: field.group,
      label: field.label,
      value,
    });
  }
  for (const item of custom) {
    rows.push({
      id: item.key,
      section: t("editor.field.customSection"),
      label: item.label,
      value: item.value,
      isNew: true,
      // 默认不勾：新增字段是用户的选择，不是识别的决定（D21）。
      selected: false,
    });
  }
  return rows;
}

/** 校对清单 → 网申资料的两半（目录内的值 / 勾选了的新字段）。 */
export function reviewRowsToWebform(rows: RecognitionReviewRow[]): {
  values: Record<string, string>;
  custom: { key: string; label: string; value: string }[];
} {
  const values: Record<string, string> = {};
  const custom: { key: string; label: string; value: string }[] = [];
  for (const row of rows) {
    if (row.isNew) {
      if (!row.selected) continue;
      // key 用后端给的（`row.id`）：用户可能改了显示名，但"这是哪个字段"由 key 决定。
      custom.push({ key: row.id, label: row.label, value: row.value });
      continue;
    }
    values[row.id] = row.value;
  }
  return { values, custom };
}
