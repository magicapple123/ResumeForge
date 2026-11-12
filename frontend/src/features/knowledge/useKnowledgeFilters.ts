// SPDX-License-Identifier: Apache-2.0
/**
 * 知识库筛选项的 URL 状态（#29D/#29G）。
 *
 * 为什么住 URL：面试页/岗位详情会跳 `/knowledge?company=<公司名>`（#29D 反向入口），
 * 刷新、分享、后退都必须保持同一组筛选；页面内部状态做不到这一点。
 *
 * 口径：`q`（关键词）/ `category` / `tag` / `company`（精确公司名）/ `uncategorized=1`
 * / `page`（>1 才写进 URL，保持短链接）。任意筛选变化回第 1 页；`page` 单独变化不动筛选。
 */
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export interface KnowledgeFilters {
  keyword: string;
  category: string;
  tag: string;
  company: string;
  uncategorized: boolean;
  page: number;
}

const FILTER_KEYS = ["keyword", "category", "tag", "company", "uncategorized"] as const;

function parsePositiveInt(raw: string | null): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function parseKnowledgeFilters(params: URLSearchParams): KnowledgeFilters {
  return {
    keyword: params.get("q") ?? "",
    category: params.get("category") ?? "",
    tag: params.get("tag") ?? "",
    company: params.get("company") ?? "",
    uncategorized: params.get("uncategorized") === "1",
    page: parsePositiveInt(params.get("page")),
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | null): void {
  if (value === null || value === "") params.delete(key);
  else params.set(key, value);
}

export function useKnowledgeFilters(): {
  filters: KnowledgeFilters;
  update: (patch: Partial<KnowledgeFilters>) => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseKnowledgeFilters(searchParams), [searchParams]);

  const update = useCallback(
    (patch: Partial<KnowledgeFilters>) => {
      const next: KnowledgeFilters = { ...filters, ...patch };
      // 任意筛选条件变化都回第 1 页（显式翻页时不动筛选）。
      const filterChanged =
        patch.page === undefined &&
        FILTER_KEYS.some((key) => patch[key] !== undefined && patch[key] !== filters[key]);
      if (filterChanged) next.page = 1;
      const params = new URLSearchParams(searchParams);
      setOrDelete(params, "q", next.keyword);
      setOrDelete(params, "category", next.category);
      setOrDelete(params, "tag", next.tag);
      setOrDelete(params, "company", next.company);
      if (next.uncategorized) params.set("uncategorized", "1");
      else params.delete("uncategorized");
      setOrDelete(params, "page", next.page > 1 ? String(next.page) : null);
      // replace：筛选是同一页内的状态，不往浏览器历史里塞每一步输入。
      setSearchParams(params, { replace: true });
    },
    [filters, searchParams, setSearchParams],
  );

  return { filters, update };
}
