// SPDX-License-Identifier: Apache-2.0
/**
 * 从 `ResumeContent` 构建只读的大纲树（W06 / P1-01、D01）。
 *
 * ## 为什么是纯函数
 *
 * 面板要回答三类问题：①有哪些分组/条目/要点；②某个下标路径对应哪个对象；③选中的对象
 * 现在还指向什么。三者都只依赖内容本身，做成纯函数后可以在 jsdom 之外直接单测
 * （排序不换 id、隐藏恢复、路径解析这类性质不该只能靠"渲染一下看看"验证）。
 *
 * ## 不在这一层做的两件事
 *
 * - **不补 id**：id 的物化在面板边界调用 W01 的 `ensureIds`（读取旧记录不写库）。
 *   这里只读；条目缺 id 时 `objectId` 为空串，界面对它降级为只读（面板会先补齐）。
 * - **不改内容**：所有写操作在 `commands.ts`，这里连浅拷贝都不做。
 */
import type { MessageKey } from "../../i18n";
import type { ResumeContent } from "../../types/resume";
import { isObjectId } from "../resume-document/identity";
import { ENTRY_POINT_FIELDS, type EntryField } from "../resume-document/types";
import { readEntryFlags } from "./flags";
import { OUTLINE_SECTIONS, type OutlineSectionKey, type OutlineSelection } from "./types";

/** 旧记录允许字段缺失：读的时候一律按 `unknown` 收窄，不用 `any`。 */
type RawEntry = Record<string, unknown>;

/** 个人信息的标量字段（与后端模板 `data-resume-path` 的顶层字段同名）。 */
export const PERSONAL_FIELDS = [
  "name",
  "gender",
  "birth_year",
  "phone",
  "email",
  "city",
  "personal_website",
  "github",
  "job_intent",
  "summary",
] as const;

/** 条目标题取哪个字段（用户数据，不进 i18n 语言包）。 */
const TITLE_FIELD: Record<EntryField, string> = {
  education: "school",
  experience: "company",
  campus_experience: "organization",
  projects: "name",
  skills: "name",
  awards: "name",
};

export interface OutlinePoint {
  /** 要点所在数组字段（`description` / `highlights` / `courses` …）。 */
  pointField: string;
  /** 要点 id（稳定身份，W01）。排序后用 id 现算下标，选中位置不会串。 */
  pointId: string;
  /** 当前下标（仅展示用；命令里不准用它定位）。 */
  index: number;
  text: string;
}

export interface OutlineEntry {
  field: EntryField;
  objectId: string;
  index: number;
  /** 用户数据里的主体名（公司/项目名…）；空串由组件补「未命名条目」。 */
  title: string;
  /** 次行信息（角色、学历、日期区间）；全部为空时是空串。 */
  subtitle: string;
  hidden: boolean;
  lockContent: boolean;
  lockLayout: boolean;
  points: OutlinePoint[];
}

export interface OutlineSection {
  key: OutlineSectionKey;
  /** `null` = 个人信息（没有条目数组）。 */
  field: EntryField | null;
  titleKey: MessageKey;
  entries: OutlineEntry[];
}

export interface OutlineModel {
  sections: OutlineSection[];
  entryCount: number;
  pointCount: number;
}

/** 取某类条目的原始数组（旧记录/缺字段都返回空数组）。 */
export function entriesOf(
  content: ResumeContent | null | undefined,
  field: EntryField,
): RawEntry[] {
  const value = content?.[field];
  return Array.isArray(value) ? (value as unknown as RawEntry[]) : [];
}

/** 条目 id；非法/缺失返回空串（界面据此降级，而不是拿下标冒充身份）。 */
export function entryIdOf(entry: RawEntry | null | undefined): string {
  const id = entry?.id;
  return isObjectId(id) ? id : "";
}

/** 某个要点数组的 id 列表（与数组等长由 W01 校验；这里按实际存在的过滤）。 */
export function pointIdsOf(entry: RawEntry | null | undefined, pointField: string): string[] {
  const source = entry?.point_ids;
  if (!source || typeof source !== "object") return [];
  const ids = (source as Record<string, unknown>)[pointField];
  return Array.isArray(ids) ? ids.filter(isObjectId) : [];
}

export function findEntryIndex(
  content: ResumeContent | null | undefined,
  field: EntryField,
  objectId: string,
): number {
  if (!isObjectId(objectId)) return -1;
  return entriesOf(content, field).findIndex((entry) => entryIdOf(entry) === objectId);
}

export function findPointIndex(
  entry: RawEntry | null | undefined,
  pointField: string,
  pointId: string,
): number {
  if (!pointId) return -1;
  return pointIdsOf(entry, pointField).indexOf(pointId);
}

/** 该条目族声明的要点字段（顺序即展示顺序，来自 W00/W01 的唯一清单）。 */
export function pointFieldsFor(field: EntryField): readonly string[] {
  return ENTRY_POINT_FIELDS[field];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 日期区间：任一端缺失时只显示存在的那一端（不显示 "2020-01 - "）。 */
function dateRange(entry: RawEntry): string {
  const start = asText(entry.start_date);
  const end = asText(entry.end_date);
  if (!start || !end) return start || end;
  return `${start} - ${end}`;
}

function subtitleOf(entry: RawEntry, field: EntryField): string {
  const parts: string[] = [];
  if (field === "education") {
    parts.push(asText(entry.major), asText(entry.degree));
    parts.push(dateRange(entry));
  } else if (field === "experience" || field === "campus_experience" || field === "projects") {
    parts.push(asText(entry.role), dateRange(entry));
  } else if (field === "skills") {
    parts.push(asText(entry.level));
  } else {
    parts.push(asText(entry.date), asText(entry.description));
  }
  return parts.filter(Boolean).join(" · ");
}

function pointsOf(entry: RawEntry, field: EntryField): OutlinePoint[] {
  const points: OutlinePoint[] = [];
  for (const pointField of pointFieldsFor(field)) {
    const values = Array.isArray(entry[pointField]) ? (entry[pointField] as unknown[]) : [];
    if (values.length === 0) continue;
    const ids = pointIdsOf(entry, pointField);
    values.forEach((item, index) => {
      points.push({ pointField, pointId: ids[index] ?? "", index, text: asText(item) });
    });
  }
  return points;
}

/** 构建整棵树。`content=null`（还没加载）时返回空分组，不返回 null。 */
export function buildOutline(content: ResumeContent | null | undefined): OutlineModel {
  const sections: OutlineSection[] = OUTLINE_SECTIONS.map((meta) => {
    if (!meta.field) {
      return { key: meta.key, field: null, titleKey: meta.titleKey, entries: [] };
    }
    const field = meta.field;
    const entries: OutlineEntry[] = entriesOf(content, field).map((entry, index) => {
      const flags = readEntryFlags(entry);
      return {
        field,
        objectId: entryIdOf(entry),
        index,
        title: asText(entry[TITLE_FIELD[field]]),
        subtitle: subtitleOf(entry, field),
        hidden: flags.hidden,
        lockContent: flags.lockContent,
        lockLayout: flags.lockLayout,
        points: pointsOf(entry, field),
      };
    });
    return { key: meta.key, field, titleKey: meta.titleKey, entries };
  });
  return {
    sections,
    entryCount: sections.reduce((sum, section) => sum + section.entries.length, 0),
    pointCount: sections.reduce(
      (sum, section) =>
        sum + section.entries.reduce((inner, entry) => inner + entry.points.length, 0),
      0,
    ),
  };
}

/** 个人信息的次行摘要（姓名在标题位，次行放联系方式；只拼已有值）。 */
export function personalSubtitle(content: ResumeContent | null | undefined): string {
  if (!content) return "";
  return [asText(content.phone), asText(content.email), asText(content.city)]
    .filter(Boolean)
    .join(" · ");
}

// ── 选择 ─────────────────────────────────────────────────────────

/** 条目选择的键（多选集合用；同一对象只有一种写法）。 */
export function entryKey(field: EntryField, objectId: string): string {
  return `entry:${field}:${objectId}`;
}

/** 任意选择的键（React key / 多选去重 / 焦点映射共用）。 */
export function selectionKey(selection: OutlineSelection | null | undefined): string {
  if (!selection) return "";
  if (selection.kind === "personal") return "personal";
  if (selection.kind === "entry") return entryKey(selection.field, selection.objectId);
  return `point:${selection.field}:${selection.objectId}:${selection.pointField}:${selection.pointId}`;
}

/** 两个选择是否指向同一个对象（对象字段而非引用比较）。 */
export function isSameSelection(
  left: OutlineSelection | null | undefined,
  right: OutlineSelection | null | undefined,
): boolean {
  return selectionKey(left) === selectionKey(right);
}

const PERSONAL_FIELD_SET: ReadonlySet<string> = new Set(PERSONAL_FIELDS);

/**
 * 把纸面点击的 `data-resume-path` 反解成大纲选择（D01 双向定位）。
 *
 * - `summary` / `phone` … → 个人信息的标量字段；
 * - `experience.1.company` / `experience.1.description.0` → 条目/要点（按内容里的 id 现查，
 *   命中不了就退回条目级，路径解析失败返回 `null`）。
 */
export function selectionFromPath(
  content: ResumeContent | null | undefined,
  path: string | null | undefined,
): OutlineSelection | null {
  const parts = (path ?? "").split(".");
  if (parts.length < 1 || !parts[0]) return null;
  const head = parts[0];
  if (PERSONAL_FIELD_SET.has(head)) return { kind: "personal" };
  if (!(head in ENTRY_POINT_FIELDS)) return null;
  const field = head as EntryField;
  const index = Number(parts[1]);
  if (!Number.isInteger(index) || index < 0) return null;
  const entries = entriesOf(content, field);
  const entry = entries[index];
  const objectId = entryIdOf(entry);
  if (!objectId) return null;
  const pointField = parts[2];
  if (pointField && pointFieldsFor(field).includes(pointField)) {
    const pointIndex = Number(parts[3]);
    if (Number.isInteger(pointIndex) && pointIndex >= 0) {
      const pointId = pointIdsOf(entry, pointField)[pointIndex];
      if (pointId) return { kind: "point", field, objectId, pointField, pointId };
    }
  }
  return { kind: "entry", field, objectId };
}

/** 从当前模型里找到选择对应的条目（找不到 = 内容已变/已删除）。 */
export function findOutlineEntry(
  model: OutlineModel,
  selection: OutlineSelection | null | undefined,
): OutlineEntry | null {
  if (!selection || selection.kind === "personal") return null;
  const section = model.sections.find((item) => item.field === selection.field);
  return section?.entries.find((entry) => entry.objectId === selection.objectId) ?? null;
}

/** 从当前模型里找到选择对应的要点。 */
export function findOutlinePoint(
  model: OutlineModel,
  selection: OutlineSelection | null | undefined,
): OutlinePoint | null {
  if (!selection || selection.kind !== "point") return null;
  const entry = findOutlineEntry(model, selection);
  if (!entry) return null;
  const selectionPointId = selection.pointId;
  return (
    entry.points.find(
      (point) => point.pointField === selection.pointField && point.pointId === selectionPointId,
    ) ?? null
  );
}
