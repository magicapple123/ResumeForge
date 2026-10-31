// SPDX-License-Identifier: Apache-2.0
/**
 * 简历字段路径的读写与中文说明——与预览里的 `data-resume-path` 同一套写法。
 *
 * 为什么需要它：预览里"点中的那一栏"是一个路径（``summary`` / ``projects.0.description.1``），
 * 而编辑器里的表单字段是另一个形状（列表要点在表单里是一个多行文本框、对应整个数组）。
 * 用路径把 AI 返回的文本写回**内容对象**，比换算成表单字段名再拼数组可靠得多，
 * 也不会因为编辑器换了控件形状而失效。
 *
 * 与后端 `services/resume/resume_field_rewrite.py` 的解析规则一致（那是一份 Python 实现）：
 * 能改的路径集合两边必须相同，否则会出现"前端让改、后端说指不到"。
 */
import type { ResumeContent } from "../types";
import type { ResumeDocument } from "../types/resumeDocument";
import { isDocument, entryValue } from "../features/resume-document/view";
import { buildFallbackCatalog } from "../features/resume-document/fieldCatalog";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";

/** 在简历里是"若干条要点"的字段（与后端 resume_field_rewrite 的 _LIST_FIELD_LABELS 一致）。 */
const LINE_FIELDS = new Set(["description", "highlights", "achievements", "courses", "tech_stack"]);

const SECTION_LABELS: Record<string, MessageKey> = {
  education: "editor.section.education",
  experience: "editor.section.experience",
  campus_experience: "editor.section.campus",
  projects: "editor.section.projects",
  skills: "editor.section.skills",
  awards: "editor.section.awards",
};

const ITEM_IDENTITY: Record<string, string> = {
  education: "school",
  experience: "company",
  campus_experience: "organization",
  projects: "name",
  skills: "name",
  awards: "name",
};

const LIST_FIELD_LABELS: Record<string, MessageKey> = {
  description: "fieldPath.point",
  highlights: "editor.field.highlights",
  achievements: "fieldPath.outcome",
  courses: "fieldPath.course",
  tech_stack: "editor.field.techStack",
};

const SCALAR_FIELD_LABELS: Record<string, MessageKey> = {
  name: "editor.field.personName",
  gender: "editor.field.gender",
  birth_year: "editor.field.birthYear",
  phone: "editor.field.phone",
  email: "editor.field.email",
  city: "editor.field.city",
  personal_website: "editor.field.website",
  github: "fieldPath.githubProfile",
  job_intent: "editor.field.jobIntent",
  summary: "editor.field.summary",
};

const ITEM_SCALAR_LABELS: Record<string, MessageKey> = {
  school: "editor.field.school",
  major: "editor.field.major",
  degree: "editor.field.degree",
  start_date: "editor.field.startDate",
  end_date: "editor.field.endDate",
  gpa: "editor.field.gpa",
  company: "editor.field.company",
  role: "editor.field.campusRole",
  organization: "editor.field.organization",
  name: "fieldPath.name",
  date: "fieldPath.time",
};

/** 把路径拆成 `(string | number)[]`；非法路径返回空数组。 */
export function parseResumeFieldPath(path: string): (string | number)[] {
  return (path ?? "")
    .split(".")
    .filter((part) => part !== "")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/**
 * 读出路径指向的值（可能是字符串，也可能是数组——编辑器里列表字段是一个整体）。
 *
 * 接受 `string` 路径或已经拆好的段数组：编辑器的表单字段名就是段数组，用它读回来
 * 才能保证"读的"和"写的"是同一个位置。
 */
export function readResumeValueByPath(
  content: ResumeContent | null,
  path: string | (string | number)[],
): unknown {
  if (!content) return undefined;
  const segments = Array.isArray(path) ? path : parseResumeFieldPath(path);
  let current: unknown = content;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/** 读出路径指向的那一栏的文本；指不到（或不是文本）时返回空串。 */
export function readResumeFieldByPath(content: ResumeContent | null, path: string): string {
  const value = readResumeValueByPath(content, path);
  return typeof value === "string" ? value : "";
}

/**
 * 把任意值写回路径（字符串、字符串数组都行），返回**新的**内容对象。
 *
 * 「整段重写」要写回的是一个数组（一段经历的多条要点），所以这里不能只收字符串。
 */
export function writeResumeValueByPath(
  content: ResumeContent,
  path: string,
  value: unknown,
): ResumeContent {
  const segments = parseResumeFieldPath(path);
  if (segments.length === 0) return content;

  const cloneAt = (node: unknown, depth: number): unknown => {
    if (depth >= segments.length) return value;
    const key = segments[depth];
    if (node === null || node === undefined) return node;
    if (!(key in (node as object))) return node;
    if (Array.isArray(node)) {
      const next = [...node];
      next[key as number] = cloneAt(node[key as number], depth + 1);
      return next;
    }
    if (typeof node === "object") {
      const record = node as Record<string | number, unknown>;
      return { ...record, [key]: cloneAt(record[key], depth + 1) };
    }
    return node;
  };

  return cloneAt(content, 0) as ResumeContent;
}

/** 分成若干条要点的那一栏（一段经历的工作内容、项目亮点……）。 */
export function isLineListPath(path: string): boolean {
  const segments = parseResumeFieldPath(path);
  return segments.length === 3 && LINE_FIELDS.has(String(segments[2]));
}

/** 把某条要点（`experience.0.description.1`）收敛成它所属的那一段（`experience.0.description`）。 */
export function toWholeSegmentPath(path: string): string {
  const segments = parseResumeFieldPath(path);
  if (segments.length === 4 && LINE_FIELDS.has(String(segments[2]))) {
    return `${segments[0]}.${segments[1]}.${segments[2]}`;
  }
  return path;
}

/** 读出某一栏的所有要点；不是列表时返回空数组。 */
export function readResumeLinesByPath(content: ResumeContent | null, path: string): string[] {
  const value = readResumeValueByPath(content, path);
  if (!Array.isArray(value)) return [];
  return value.map((line) => String(line ?? ""));
}

/**
 * 把一段文本写回路径（`writeResumeValueByPath` 的字符串版）。
 *
 * 只复制路径经过的那几个分支，其余保持引用——这样 React 侧只重渲染真正变了的部分，
 * 也避免因为整体深拷贝而丢掉未在表单里呈现的字段。
 */
export function writeResumeFieldByPath(
  content: ResumeContent,
  path: string,
  value: string,
): ResumeContent {
  return writeResumeValueByPath(content, path, value);
}

/** 人话说明"这是哪一栏"，用于弹窗标题与错误提示。 */
export function describeResumeFieldPath(
  path: string,
  content?: ResumeContent | ResumeDocument | null,
): string {
  if (isDocument(content)) {
    const parts = path.split(".");
    const catalog = buildFallbackCatalog(t);
    if (parts[0] === "header" || (parts.length === 1 && parts[0] !== "summary")) {
      const item = content.header.items.find(
        (item) => item.id === parts[1] || item.key === parts[0],
      );
      if (item)
        return (
          item.label ||
          catalog.header_fields.find((field) => field.key === item.key)?.label ||
          item.key
        );
    }
    const section = content.sections.find((section) => section.key === parts[0]);
    const spec = catalog.sections.find((spec) => spec.key === parts[0]);
    const label = section?.layout.title_override || section?.title || spec?.title || parts[0];
    const entry =
      section?.entries.find((entry) => entry.id === parts[1]) ??
      (Number.isInteger(Number(parts[1])) ? section?.entries[Number(parts[1])] : undefined);
    if (!entry) return label;
    const identity = entryValue(entry, ITEM_IDENTITY[parts[0]] || "name");
    const subject = identity
      ? t("fieldPath.sectionWithIdentity", { section: label, identity })
      : label;
    if (parts.length === 2) return subject;
    const item = entry.items.find(
      (item) => item.id === parts[2] || (item.kind !== "text" && item.key === parts[2]),
    );
    const key = item?.kind === "text" ? "description" : item && "key" in item ? item.key : parts[2];
    const field =
      (item && "label" in item && item.label) ||
      spec?.fields.find((field) => field.key === key)?.label ||
      (LIST_FIELD_LABELS[key] ? t(LIST_FIELD_LABELS[key]) : key);
    return t("fieldPath.scalar", { section: subject, field });
  }
  const segments = parseResumeFieldPath(path);
  if (segments.length === 0) return t("fieldPath.unspecified");
  const head = String(segments[0]);
  if (segments.length === 1) {
    // 表里存的是 language-pack key（`editor.*` 词表），显示前必须过一遍 t()：
    // 漏了就会把 `editor.field.title` 这种 key 原样显示给用户。
    const scalarKey = SCALAR_FIELD_LABELS[head];
    return scalarKey ? t(scalarKey) : head;
  }
  const sectionKey = SECTION_LABELS[head];
  const sectionLabel = sectionKey ? t(sectionKey) : head;
  const index = typeof segments[1] === "number" ? segments[1] : -1;
  const identityField = ITEM_IDENTITY[head];
  const item =
    content && index >= 0 && identityField
      ? ((content as unknown as Record<string, { [key: string]: unknown }[]>)[head]?.[index] ??
        null)
      : null;
  const identity = item ? String(item[identityField] ?? "").trim() : "";
  const subject = identity
    ? t("fieldPath.sectionWithIdentity", { section: sectionLabel, identity })
    : sectionLabel;
  if (segments.length === 2) return subject;
  const field = String(segments[2]);
  if (segments.length === 3) {
    return t("fieldPath.scalar", {
      section: subject,
      field: ITEM_SCALAR_LABELS[field] ? t(ITEM_SCALAR_LABELS[field]) : field,
    });
  }
  const listIndex = typeof segments[3] === "number" ? segments[3] : -1;
  return t("fieldPath.listItem", {
    section: subject,
    index: listIndex + 1,
    field: LIST_FIELD_LABELS[field] ? t(LIST_FIELD_LABELS[field]) : field,
  });
}
