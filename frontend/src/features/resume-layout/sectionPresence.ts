// SPDX-License-Identifier: Apache-2.0
/**
 * 「板块顺序」浮层的可见集合（2026-10-28 用户反馈）：
 * 列表只应出现当前简历里**真的有内容**的板块，而不是把 12 个系统板块全列出来；
 * 自建板块渲染器固定排在系统板块之后，因此只作为只读行列出。
 *
 * 纯函数，便于单测；不读 React、不碰存储。
 */
import type { ResumeContent } from "../../types/resume";

export interface SectionOptionLike {
  key: string;
  label: string;
}

export interface CustomSectionRow {
  key: string;
  title: string;
}

/** 当前简历里真的有内容的系统板块；content 缺省时返回 null（调用方不做过滤）。 */
export function presentSectionKeys(
  content: ResumeContent | null | undefined,
  sectionOptions: readonly SectionOptionLike[],
): Set<string> | null {
  if (!content) return null;
  const record = content as unknown as Record<string, unknown>;
  const keys = new Set<string>();
  for (const option of sectionOptions) {
    const value = record[option.key];
    if (Array.isArray(value)) {
      if (value.length > 0) keys.add(option.key);
    } else if (typeof value === "string" && value.trim() !== "") {
      keys.add(option.key);
    }
  }
  return keys;
}

/** 有内容的自建板块（按正文顺序）；渲染器固定排在系统板块之后。 */
export function customSectionRows(content: ResumeContent | null | undefined): CustomSectionRow[] {
  if (!content) return [];
  return (content.custom_sections ?? [])
    .filter((section) =>
      section.entries.some(
        (entry) => entry.text.trim() !== "" || entry.lines.some((line) => line.value.trim() !== ""),
      ),
    )
    .map((section) => ({ key: section.key, title: section.title }));
}

/**
 * 在**可见列表**里移动一格：只交换两个可见板块在完整 section_order 里的位置，
 * 空板块的位置原样保留（它们不显示，但存储里仍是一份完整排列）。
 * 返回 null 表示越界/找不到，调用方不应写回。
 */
export function moveVisibleSection(
  fullOrder: readonly string[],
  visibleOrder: readonly string[],
  key: string,
  direction: -1 | 1,
): string[] | null {
  const index = visibleOrder.indexOf(key);
  const target = visibleOrder[index + direction];
  if (index < 0 || !target) return null;
  const next = [...fullOrder];
  const from = next.indexOf(key);
  const to = next.indexOf(target);
  if (from < 0 || to < 0) return null;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
