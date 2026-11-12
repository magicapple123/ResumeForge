// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产库的**纯规则**：筛选、排序、标签聚合、空筛选判定。
 *
 * 为什么放在前端而不是全靠服务端查询：资产库是"边打字边筛"的场景（搜索框输入即过滤），
 * 每次敲键发一次请求既慢又不稳；服务端接口仍接受同样的参数（用于深分页），
 * 两处共用同一组语义（本文件是前端侧唯一实现，组件不许自己写 `includes`）。
 */
import type { PhraseFilterState, PhraseSort, ResumePhrase } from "./types";

/** 默认筛选：全部 + 最近使用。 */
export const DEFAULT_PHRASE_FILTER: PhraseFilterState = {
  keyword: "",
  kind: "all",
  language: "all",
  tag: "all",
  sort: "recent",
};

const SORT_ORDER: readonly PhraseSort[] = ["recent", "usage", "created"];

/** 归一化筛选状态：未知值落回默认，关键词去首尾空白（后端/前端同一口径）。 */
export function normalizeFilter(
  raw: Partial<PhraseFilterState> | null | undefined,
): PhraseFilterState {
  const source = raw ?? {};
  return {
    keyword: typeof source.keyword === "string" ? source.keyword.trim() : "",
    kind: source.kind ?? "all",
    language: source.language ?? "all",
    tag: source.tag ?? "all",
    sort: source.sort && SORT_ORDER.includes(source.sort) ? source.sort : "recent",
  };
}

/** 是否处于"默认筛选"（用于空态按钮与"已启用 N 个筛选"提示）。 */
export function isDefaultFilter(filter: PhraseFilterState): boolean {
  return activeFilterCount(filter) === 0;
}

/** 生效的筛选维度数（不含排序：排序不算"筛选"）。 */
export function activeFilterCount(filter: PhraseFilterState): number {
  let count = 0;
  if (filter.keyword.trim()) count += 1;
  if (filter.kind !== "all") count += 1;
  if (filter.language !== "all") count += 1;
  if (filter.tag !== "all") count += 1;
  return count;
}

/** 关键词命中：表达正文 **或** 岗位标签包含关键词（大小写不敏感）。 */
export function matchesKeyword(phrase: ResumePhrase, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  if (phrase.text.toLowerCase().includes(needle)) return true;
  return phrase.job_tags.some((tag) => tag.toLowerCase().includes(needle));
}

/** 主筛选：一次遍历应用全部维度。 */
export function filterPhrases(
  phrases: readonly ResumePhrase[],
  filter: PhraseFilterState,
): ResumePhrase[] {
  const active = normalizeFilter(filter);
  return phrases.filter((phrase) => {
    if (active.kind !== "all" && phrase.kind !== active.kind) return false;
    if (active.language !== "all" && (phrase.language || "") !== active.language) return false;
    if (active.tag !== "all" && !phrase.job_tags.includes(active.tag)) return false;
    return matchesKeyword(phrase, active.keyword);
  });
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 排序：全部为**降序**（最近/最多在前）；同分时按 id 降序保证稳定。 */
export function sortPhrases(phrases: readonly ResumePhrase[], sort: PhraseSort): ResumePhrase[] {
  const next = phrases.slice();
  next.sort((left, right) => {
    if (sort === "usage") {
      if (right.usage_count !== left.usage_count) return right.usage_count - left.usage_count;
    } else if (sort === "created") {
      const diff = timestamp(right.created_at) - timestamp(left.created_at);
      if (diff !== 0) return diff;
    } else {
      const diff = timestamp(right.last_used_at) - timestamp(left.last_used_at);
      if (diff !== 0) return diff;
    }
    return right.id - left.id;
  });
  return next;
}

/** 筛选 + 排序的单一出口（组件只调这一个函数）。 */
export function visiblePhrases(
  phrases: readonly ResumePhrase[],
  filter: PhraseFilterState,
): ResumePhrase[] {
  const active = normalizeFilter(filter);
  return sortPhrases(filterPhrases(phrases, active), active.sort);
}

/** 全部标签（去重、按出现次数降序、同频按字典序），用于标签下拉。 */
export function collectTags(phrases: readonly ResumePhrase[]): string[] {
  const counts = new Map<string, number>();
  for (const phrase of phrases) {
    for (const tag of phrase.job_tags) {
      const key = tag.trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([tag]) => tag);
}

/** 语言下拉的取值：数据里实际出现的语言 + 未标注（空串）。 */
export function collectLanguages(phrases: readonly ResumePhrase[]): string[] {
  const languages = new Set<string>();
  for (const phrase of phrases) languages.add(phrase.language || "");
  return [...languages].sort((left, right) => left.localeCompare(right));
}
