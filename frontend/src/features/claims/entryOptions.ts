// SPDX-License-Identifier: Apache-2.0
/**
 * 台账侧的「关联资料条目」与「从资料选择」共用选项（问题清单 §20 P0-3 / P3）。
 *
 * 数据来源是资料库既有的工作区接口（GET /api/profile/workspace）：板块顺序、板块名与
 * 条目值都由服务端给，台账页不另起一套资料读取逻辑。台账只存 entry_id（24 位十六进制），
 * 这里负责把它变成「板块 → 条目名」的可选项，以及把一条资料拼成台账草稿的原文。
 */
import { t } from "../../i18n";
import type { ClaimCategory } from "../../types";
import { CLAIM_CATEGORIES } from "../../types";
import type { EntryOut, SectionOut, WorkspaceOut } from "../profile/library/types";

// 台账分类是提交后端的协议值（中文），从 types 里取唯一真源，本文件不重复写一份中文——
// 复制一份既会漂移，也会让"新文件里出现界面中文"的棘轮守卫误报。
const [
  CATEGORY_EDUCATION,
  CATEGORY_EXPERIENCE,
  CATEGORY_PROJECT,
  CATEGORY_CAMPUS,
  CATEGORY_SKILLS,
  CATEGORY_AWARDS,
  CATEGORY_OTHER,
] = CLAIM_CATEGORIES;

export interface ClaimEntryOption {
  value: string;
  label: string;
}

export interface ClaimEntryOptionGroup {
  label: string;
  options: ClaimEntryOption[];
}

/** 内置板块里"这条记录是关于谁的"字段：与资料库条目标题同一口径（公司 / 学校 / 项目名…）。 */
const ENTRY_TITLE_FIELD_KEYS: Record<string, string> = {
  educations: "school",
  experiences: "company",
  projects: "name",
  campus_experiences: "organization",
  awards: "title",
  publications: "title",
  research_projects: "name",
  patents: "title",
  credentials: "title",
  languages: "language",
  skills: "name",
};

/** 板块 → 台账分类（协议值，直接提交后端）；自建板块没有对应分类，归「其他」。 */
const CLAIM_CATEGORY_BY_SECTION: Record<string, ClaimCategory> = {
  educations: CATEGORY_EDUCATION,
  experiences: CATEGORY_EXPERIENCE,
  projects: CATEGORY_PROJECT,
  campus_experiences: CATEGORY_CAMPUS,
  skills: CATEGORY_SKILLS,
  awards: CATEGORY_AWARDS,
  credentials: CATEGORY_OTHER,
  publications: CATEGORY_OTHER,
  research_projects: CATEGORY_OTHER,
  patents: CATEGORY_OTHER,
  languages: CATEGORY_OTHER,
};

/** 按服务端给的全局顺序排板块；section_order 里没有的（异常数据）接在后面。 */
function orderedSections(workspace: WorkspaceOut): SectionOut[] {
  const byKey = new Map(workspace.sections.map((section) => [section.key, section]));
  const ordered: SectionOut[] = [];
  for (const key of workspace.section_order ?? []) {
    const section = byKey.get(key);
    if (!section) continue;
    ordered.push(section);
    byKey.delete(key);
  }
  return [...ordered, ...workspace.sections.filter((section) => byKey.has(section.key))];
}

function fieldText(entry: EntryOut, fieldId: string): string {
  return String(entry.values?.[fieldId] ?? "").trim();
}

/** 条目显示名：主字段（公司/学校/项目名）→ 第一个有值的单行字段 → 板块名 + 序号。 */
export function claimEntryLabel(section: SectionOut, entry: EntryOut, index: number): string {
  const titleKey = ENTRY_TITLE_FIELD_KEYS[section.key];
  if (titleKey) {
    const title = fieldText(entry, section.key + "." + titleKey);
    if (title) return title;
  }
  const firstFilled = section.fields.find(
    (field) => field.field_type === "single_line" && fieldText(entry, field.field_id),
  );
  if (firstFilled) return fieldText(entry, firstFilled.field_id);
  return section.name + " " + String(index + 1);
}

/**
 * 资料选项（分组多选下拉用）。单例板块（基本信息 / 个人总结）不参与：台账主张描述的是
 * 一段具体经历或项目，把「基本信息」当成一条可关联资料只会让用户选错。
 */
export function buildClaimEntryGroups(
  workspace: WorkspaceOut | null | undefined,
): ClaimEntryOptionGroup[] {
  if (!workspace) return [];
  const entriesBySection = new Map<string, EntryOut[]>();
  for (const entry of workspace.entries) {
    const list = entriesBySection.get(entry.section_key) ?? [];
    list.push(entry);
    entriesBySection.set(entry.section_key, list);
  }
  const groups: ClaimEntryOptionGroup[] = [];
  for (const section of orderedSections(workspace)) {
    if (section.form !== "multi") continue;
    const entries = entriesBySection.get(section.key) ?? [];
    if (entries.length === 0) continue;
    groups.push({
      label: section.name,
      options: entries.map((entry, index) => ({
        value: entry.entry_id,
        label: claimEntryLabel(section, entry, index),
      })),
    });
  }
  return groups;
}

/** 在选项分组里按 entry_id 反查资料条目（「从资料选择」需要原文与板块）。 */
export function findClaimEntry(
  workspace: WorkspaceOut | null | undefined,
  entryId: string | undefined,
): { section: SectionOut; entry: EntryOut } | null {
  if (!workspace || !entryId) return null;
  const entry = workspace.entries.find((item) => item.entry_id === entryId);
  if (!entry) return null;
  const section = workspace.sections.find((item) => item.key === entry.section_key);
  if (!section) return null;
  return { section, entry };
}

/** 一条资料 → 台账草稿的原文：按板块字段拼「标签：值」，跳过空值与照片。 */
export function entryToClaimText(section: SectionOut, entry: EntryOut): string {
  const lines: string[] = [];
  for (const field of section.fields) {
    if (field.field_type === "photo") continue;
    const value = fieldText(entry, field.field_id);
    if (!value) continue;
    // 「标签：值」是拼给用户看（再作为草稿原文喂给模型）的行格式：分隔符随界面语言走，
    // 不在代码里写死中文全角冒号（那样英文界面会冒出中文标点）。
    lines.push(t("claimDraftModal.entryFieldLine", { label: field.label, value }));
  }
  if (lines.length === 0) {
    // 字段定义缺失（历史数据/自建字段被删）时退到原始值，别让用户选了个空。
    for (const value of Object.values(entry.values ?? {})) {
      const text = String(value ?? "").trim();
      if (text) lines.push(text);
    }
  }
  return lines.join("\n");
}

/** 一条资料的"主体"预填值：主字段；自建板块退到第一个有值的单行字段。 */
export function claimSubjectForEntry(section: SectionOut, entry: EntryOut): string {
  const titleKey = ENTRY_TITLE_FIELD_KEYS[section.key];
  if (titleKey) {
    const title = fieldText(entry, section.key + "." + titleKey);
    if (title) return title;
  }
  const firstFilled = section.fields.find(
    (field) => field.field_type === "single_line" && fieldText(entry, field.field_id),
  );
  return firstFilled ? fieldText(entry, firstFilled.field_id) : "";
}

/** 板块 → 台账分类的默认值（用户仍可改）。 */
export function claimCategoryForSection(sectionKey: string): ClaimCategory {
  return CLAIM_CATEGORY_BY_SECTION[sectionKey] ?? CATEGORY_OTHER;
}
