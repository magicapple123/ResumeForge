// SPDX-License-Identifier: Apache-2.0
/**
 * 从简历正文提取「可单独设置排版的条目」（条目级字段排版的下拉数据源）。
 *
 * 纯函数、无 React：`WorkbenchParamsColumn` 只 useMemo 调一次，单测直接测这里
 * （那个文件贴着 500 行预算，不适合再塞"每个分区的主标题字段是哪几个"这种表）。
 *
 * **只收带稳定 id 的条目**：条目级覆盖按 `entries.<分区>.<id>` 存，没有 id 的旧记录无法
 * 定位，不能出现在下拉里（后端渲染时同样"取不到就继承分区默认"）。
 * label 取该分区的主标题字段（学校 / 公司 / 机构 / 项目名 / 奖项名 / 论文标题…）；
 * 全空时退回 `#序号`（1 起），避免下拉里出现一片空白项。
 */
import type { ResumeContent } from "../../types";
import { FIELD_LAYOUT_SECTIONS } from "./fieldLayout";
import type { FieldLayoutSection } from "./fieldLayout";

/** 条目下拉的一个选项：`id` 是 W01 稳定身份，`label` 是纸面上的主标题。 */
export interface EntryFieldLayoutOption {
  id: string;
  label: string;
}

/** 各分区的主标题字段（按优先级；第一个非空的就是 label）。 */
const PRIMARY_FIELDS: Record<FieldLayoutSection, readonly string[]> = {
  education: ["school", "major"],
  experience: ["company", "role"],
  campus_experience: ["organization", "role"],
  projects: ["name", "role"],
  awards: ["name"],
  publications: ["title"],
  research_projects: ["name", "organization"],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 该条目第一个非空的主标题文本（去首尾空白）；都没有返回空串。 */
function primaryText(entry: Record<string, unknown>, fields: readonly string[]): string {
  for (const field of fields) {
    const value = entry[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * `{分区: [{id, label}]}`（没有条目的分区缺键 —— 面板据此禁用条目下拉）。
 *
 * `content` 传**草稿**那一版（`draftContent ?? content`）：下拉显示的是用户眼前这一版
 * 简历里的条目，与预览一致。
 */
export function entryFieldLayoutOptions(
  content: ResumeContent | null | undefined,
): Partial<Record<FieldLayoutSection, EntryFieldLayoutOption[]>> {
  const result: Partial<Record<FieldLayoutSection, EntryFieldLayoutOption[]>> = {};
  const source = asRecord(content);
  if (!source) return result;
  for (const section of FIELD_LAYOUT_SECTIONS) {
    const items = source[section];
    if (!Array.isArray(items)) continue;
    const options: EntryFieldLayoutOption[] = [];
    const seen = new Set<string>();
    items.forEach((item, index) => {
      const entry = asRecord(item);
      if (!entry) return;
      const id = entry["id"];
      // 只收非空字符串 id；同一分区内重复 id 只留第一次（与后端"同一数组内唯一"一致）。
      if (typeof id !== "string" || id.length === 0 || seen.has(id)) return;
      seen.add(id);
      const title = primaryText(entry, PRIMARY_FIELDS[section]);
      options.push({ id, label: title || `#${index + 1}` });
    });
    if (options.length > 0) result[section] = options;
  }
  return result;
}

/**
 * 把 `entryFieldLayoutOptions` 的结果拍平成一维 `{id, label}` 清单（跨分区按 id 去重）。
 *
 * 分页面板（W08）只需要"这份正文里有哪些带 id 的条目 + 一个显示名"，不关心分区；但同一
 * 个对象可能同时出现在两个清单里（`entryOptions` 按分区组织），所以按 id 去重、保留首次
 * 出现的那个。拍平逻辑住在这里（纯函数、可单测），宿主那一栏只留一行调用——它贴着 500
 * 行预算，不适合再摊开一段两重循环。
 */
export function flatEntryLayoutOptions(
  options: Partial<Record<FieldLayoutSection, EntryFieldLayoutOption[]>> | null | undefined,
): EntryFieldLayoutOption[] {
  const seen = new Set<string>();
  const flat: EntryFieldLayoutOption[] = [];
  for (const items of Object.values(options ?? {})) {
    for (const item of items ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      flat.push({ id: item.id, label: item.label });
    }
  }
  return flat;
}
