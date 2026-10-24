// SPDX-License-Identifier: Apache-2.0
/**
 * W14 科研字段的真实内容规则（纯函数）。
 *
 * ## 空列表不序列化
 *
 * 后端 `OptionalEmptyListMixin` 对空列表**不输出键**（`publications: []` 读出来是"没有这个键"）；
 * 前端按"无键 = 空"读取，保存时也尽量不把三个空数组塞进 payload，让旧客户端/旧版本比对时
 * 不会因为多出三个空键就认为内容变了（内容指纹逐字节稳定）。
 */
import type { ResumeContent } from "../../types/resume";

type ResearchFieldKey = "publications" | "research_projects" | "patents";

export const RESEARCH_FIELD_KEYS: readonly ResearchFieldKey[] = [
  "publications",
  "research_projects",
  "patents",
];

/** 读一个科研列表：缺键 / null / 非数组都按空数组（后端空列表不序列化）。 */
export function readResearchList(
  content: Partial<ResumeContent> | null,
  key: ResearchFieldKey,
): unknown[] {
  const value = (content as unknown as Record<string, unknown> | null)?.[key];
  return Array.isArray(value) ? value : [];
}

/**
 * 保存前清理：只删**空数组**的科研键，其它字段原样保留。
 * 返回新对象（不改入参），可直接进 `onSave`。
 */
export function stripEmptyResearch(content: ResumeContent): ResumeContent {
  const record = { ...(content as unknown as Record<string, unknown>) };
  let touched = false;
  for (const key of RESEARCH_FIELD_KEYS) {
    const value = record[key];
    if (Array.isArray(value) && value.length === 0) {
      delete record[key];
      touched = true;
    }
  }
  return touched ? (record as unknown as ResumeContent) : content;
}

/** 科研三栏是否有任何内容（决定纸面块与页签徽标显不显示）。 */
export function hasResearchEntries(content: Partial<ResumeContent> | null): boolean {
  return RESEARCH_FIELD_KEYS.some((key) => readResearchList(content, key).length > 0);
}
