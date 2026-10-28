// SPDX-License-Identifier: Apache-2.0
/**
 * 来源核对的**内容选择数据**（纯函数）：把 `GET /provenance/resumes/{id}` 的 `objects`
 * 折成下拉可选项（同一块去重、按板块分组），并把选项还原成 `ProvenanceLocator`。
 *
 * ## 为什么需要这一层
 *
 * 面板原先只有"外部 locator"（文档大纲 / 纸面点击）一个入口。用户没在大纲里点东西时
 * `objectsForSelection` 返回空数组，来源面板只剩一句空态，**没有任何地方能挑"我要核对
 * 哪一条内容"**。选择器要的正是"对象 → 选项 → 定位"这条映射，把它放在纯函数里，
 * 组件只负责画下拉、hook 只负责存当前选择。
 *
 * ## 三条口径
 *
 * 1. **一个块一个选项**：value 由 (object_id, point_id, path) 拼成，同一条目的不同要点
 *    各自成项（用户要核对的是"那一条怎么写的"，不是"那一栏"）；
 * 2. **要点选择不带 object_id**：带上就会让 `objectsForSelection` 把同一条目的所有要点
 *    都算成"当前块"，来源链与事实锁会串到兄弟要点上；
 * 3. **字段名由 path 派生**：`experience.0.description.1` → `description`，与
 *    `data-resume-path` 同一口径，不另造一套字段表。
 */
import type { DocumentObjectOut, ResumeProvenanceOut } from "./types";
import type { ProvenanceLocator } from "./selection";
import type { ProvenanceMessageKey } from "./i18n";

/** 下拉里的一项：显示用（label/field/section）+ 取数用（locator）。 */
export interface SelectionOption {
  /** 选项值：块身份的稳定拼接（同一块不会出现两次）。 */
  value: string;
  /** 块自身的标签（条目名 / 要点文本），可能为空串。 */
  label: string;
  /** 由 path 派生的字段名（data-resume-path 口径，不是界面文案）。 */
  field: string;
  /** 板块（object 的 field，如 experience），用于分组标题。 */
  section: string;
  /** 该块是否已经关联了来源（只影响提示，不影响可选性）。 */
  linked: boolean;
  locator: ProvenanceLocator;
}

/** 一个分组成员（保持后端给的顺序，不额外排序）。 */
export interface SelectionGroup {
  section: string;
  options: SelectionOption[];
}

const NUMBER_SEGMENT = /^\d+$/;

/** 后端 `POINT_FIELDS` 的 key 集合：认识的板块才给专门的小标题。 */
const KNOWN_SECTIONS = [
  "education",
  "experience",
  "campus_experience",
  "projects",
  "publications",
  "research_projects",
  "patents",
  "credentials",
  "skills",
  "languages",
  "awards",
];

/** `experience.0.description.1` → `description`；`experience.0` → `experience`。 */
export function fieldNameOf(path: string): string {
  const segments = (path || "")
    .split(".")
    .filter((segment) => segment && !NUMBER_SEGMENT.test(segment));
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

/** 块的稳定身份：(object_id, point_id, path) 三元组拼串，用于去重与下拉取值。 */
export function selectionKey(object: DocumentObjectOut): string {
  return [object.object_id ?? "", object.point_id ?? "", object.path].join("|");
}

/** 选中块 → 定位。要点不带 object_id（见文件头第 2 条口径）。 */
export function locatorForObject(object: DocumentObjectOut): ProvenanceLocator {
  return {
    object_id: object.point_id ? null : object.object_id,
    point_id: object.point_id,
    path: object.path,
    label: object.label || undefined,
  };
}

/** 整份来源视图 → 下拉选项（去重；保持后端顺序）。 */
export function selectionOptions(provenance: ResumeProvenanceOut | null): SelectionOption[] {
  if (!provenance) return [];
  const seen = new Set<string>();
  const options: SelectionOption[] = [];
  for (const object of provenance.objects ?? []) {
    const value = selectionKey(object);
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: object.label ?? "",
      field: fieldNameOf(object.path),
      section: object.field || "other",
      linked: object.link !== null && object.link !== undefined,
      locator: locatorForObject(object),
    });
  }
  return options;
}

/** 选项值 → 定位（找不到返回 null，界面保持"未选中"而不是猜一块）。 */
export function locatorForSelectionKey(
  provenance: ResumeProvenanceOut | null,
  key: string | null,
): ProvenanceLocator | null {
  if (!key) return null;
  const option = selectionOptions(provenance).find((item) => item.value === key);
  return option ? { ...option.locator } : null;
}

/**
 * 定位 → 选项值（把外部选中回显到下拉里）。
 * 匹配优先级与 `objectsForSelection` 一致：point_id → object_id → path。
 */
export function selectionKeyForLocator(
  provenance: ResumeProvenanceOut | null,
  locator: ProvenanceLocator | null,
): string | null {
  if (!provenance || !locator) return null;
  const objects = provenance.objects ?? [];
  const pointId = locator.point_id ?? null;
  const objectId = locator.object_id ?? null;
  const path = locator.path ?? null;
  const match = pointId
    ? objects.find((item) => item.point_id === pointId)
    : objectId
      ? objects.find((item) => item.object_id === objectId)
      : path
        ? objects.find((item) => item.path === path)
        : undefined;
  return match ? selectionKey(match) : null;
}

/** 按板块折叠（分组的先后 = 该板块第一次出现的先后）。 */
export function groupSelectionOptions(options: readonly SelectionOption[]): SelectionGroup[] {
  const groups: SelectionGroup[] = [];
  for (const option of options) {
    const group = groups.find((item) => item.section === option.section);
    if (group) {
      group.options.push(option);
    } else {
      groups.push({ section: option.section, options: [option] });
    }
  }
  return groups;
}

/** 板块 → 小标题 key（未知板块归"其他内容"，不现编名字）。 */
export function sectionMessageKey(section: string): ProvenanceMessageKey {
  const value = KNOWN_SECTIONS.includes(section) ? section : "other";
  return ("provenance.section." + value) as ProvenanceMessageKey;
}
