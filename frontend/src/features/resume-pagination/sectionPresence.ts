// SPDX-License-Identifier: Apache-2.0
/**
 * 「有内容的板块」判定：分页面板的全局「每板块新页」**派生判定**只看这些板块。
 *
 * 为什么不在组件里读 content：判定是纯函数、要能单测；而且空板块写断页虽然无害
 * （后端只在真正渲染该板块时统计），但会让"自然填充 / 每板块新页"的选中态被一个
 * 空板块带偏。写入/清除仍由调用方按 sections 全量执行（见 paginationDomain）。
 */
import type { ResumeContent } from "../../types";

/** 列表型板块键（与后端 SECTION_KEYS 的列表部分一致）。 */
const LIST_SECTION_KEYS = new Set([
  "education",
  "experience",
  "projects",
  "publications",
  "research_projects",
  "patents",
  "credentials",
  "skills",
  "campus_experience",
  "awards",
]);

/**
 * 从 sections 里挑出**有内容**的键（保持传入顺序）；没有 content 时退回全部键。
 *
 * 只认已知板块字段：未知键不因"取不到值"被误判成有内容。
 */
export function nonEmptySectionKeys(
  content: ResumeContent | null | undefined,
  keys: readonly string[],
): string[] {
  if (!content) return [...keys];
  const record = content as unknown as Record<string, unknown>;
  return keys.filter((key) => {
    if (key === "summary") {
      const value = record[key];
      return typeof value === "string" && value.trim().length > 0;
    }
    if (!LIST_SECTION_KEYS.has(key)) return false;
    const value = record[key];
    return Array.isArray(value) && value.length > 0;
  });
}
