// SPDX-License-Identifier: Apache-2.0
/**
 * 分页面板「已设置断页」清单里**条目芯片的名字来源**。
 *
 * ## 为什么需要单独一份（不直接用 W4 的条目下拉清单）
 *
 * 分页的条目意图以稳定对象 id 为键，芯片要把 id 翻成用户看得懂的名字。原先宿主直接摊平
 * `entryFieldLayoutOptions` 交给面板——而那份按 `FIELD_LAYOUT_SECTIONS`（七个分区）准备，
 * **不含 skills**。但 `ENTRY_POINT_FIELDS` 里是有 skills 的：技能条目在大纲里可以选中、
 * 也就能设「从新页开始」，于是芯片查不到名字 → 落到 `pagination.breaks.unknownEntry`
 * 「已删除的条目」——内容明明还在，用户会以为自己把技能删了。
 *
 * 所以这里在 W4 清单之上**补一层 skills**：
 *
 * 1. `entryFieldLayoutOptions` + `flatEntryLayoutOptions` —— 七个分区拍平、跨分区按 id 去重；
 * 2. `content.skills` 里带合法 `id` 的条目 —— label 取 `name`，为空退回 `#序号`（与
 *    `entryOptions.ts` 的兜底风格一致）；
 * 3. 合并时按 id 去重，**先到的赢**（W4 的 label 更懂那条内容的主标题，skills 只是补漏）。
 *
 * 刻意**不动** `FIELD_LAYOUT_SECTIONS`：那是后端 W4 的字段排版契约，分页不该为了自己的
 * 显示名去扩一个别人的接口。同理也不在这里复用 `collectPaginationEntryIds`——那个函数的
 * 口径是"哪些 id 还活着"（偏宽，用于 prune），与"这些 id 叫什么"是两件事。
 *
 * `id` 形状与 `paginationDomain.ts` / `paginationEntryIds.ts` 逐字相同
 * （`/^[A-Za-z0-9_-]{8,32}$/`）：写进去、留得下来、显示得出来，三处必须同一把尺子。
 */
import type { ResumeContent } from "../../types";
import { entryFieldLayoutOptions, flatEntryLayoutOptions } from "../resume-layout/entryOptions";

/** 一个可设条目断页的对象：稳定 id + 纸面上的名字（与面板同名 prop 形状一致）。 */
export interface PaginationEntryOption {
  id: string;
  label: string;
}

/** 与 `paginationDomain.ts` 的 `OBJECT_ID` 逐字相等。 */
const OBJECT_ID = /^[A-Za-z0-9_-]{8,32}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 技能条目的显示名：`name` 为空时退回 `#序号`（1 起），不留空芯片。 */
function skillLabel(skill: Record<string, unknown>, index: number): string {
  const name = skill["name"];
  if (typeof name === "string" && name.trim()) return name.trim();
  return `#${index + 1}`;
}

/**
 * 正文里能设条目断页的对象及其显示名（W4 七个分区 + skills，按 id 去重、先到的赢）。
 *
 * `content` 为 `null`/非对象时返回空数组（没有可命名的条目，面板会退回兜底文案）。
 */
export function paginationEntryOptions(
  content: ResumeContent | null | undefined,
): PaginationEntryOption[] {
  const flat = flatEntryLayoutOptions(entryFieldLayoutOptions(content ?? null));
  const seen = new Set(flat.map((item) => item.id));
  const skills: unknown = content?.skills;
  if (!Array.isArray(skills)) return flat;
  const merged: PaginationEntryOption[] = [...flat];
  for (let index = 0; index < skills.length; index += 1) {
    const skill = asRecord(skills[index]);
    if (!skill) continue;
    const id = skill["id"];
    if (typeof id !== "string" || !OBJECT_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push({ id, label: skillLabel(skill, index) });
  }
  return merged;
}
