// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心「按岗位折叠」的数据层（CR-33）。
 *
 * 折叠要按**组**分页，而后端只能按简历条分页。所以这里先把当前筛选/排序下的记录
 * 按 100 条一页循环补齐（最多 20 页 = 2000 条），再在本地分组；页面用组数做分页，
 * 与「22 条折成 7 组」的验收口径一致。
 *
 * 为什么设上限：一个 5 万条的工作区每翻一页都全量拉一遍是不现实的。2000 条是
 * "够用且可解释"的折中——超出时页面底部如实提示，让用户用搜索/岗位筛选收窄，
 * 而不是悄悄只显示一部分。
 *
 * 纯函数 `loadResumesForGrouping` 单独导出：上限行为（total 很大时只请求 20 次）
 * 用一个假 fetcher 就能测，不需要渲染组件。
 */
import { useApi } from "../../../hooks/useApi";
import { listResumes } from "../../../api/resumes";
import type { Page, ResumeBrief, ResumeSort } from "../../../types";
import { groupResumes, type ResumeGroup } from "./resumeGroups";

/** 每页抓取条数（与后端 page_size 上限一致）。 */
export const GROUP_FETCH_PAGE_SIZE = 100;
/** 最多抓多少页：100 × 20 = 2000 条，超出即停。 */
export const GROUP_FETCH_MAX_PAGES = 20;
/** 折叠视图一次最多加载的简历条数。 */
export const GROUP_FETCH_LIMIT = GROUP_FETCH_PAGE_SIZE * GROUP_FETCH_MAX_PAGES;

export type PageFetcher = (page: number, pageSize: number) => Promise<Page<ResumeBrief>>;

/**
 * 循环补页直到取完 / 到达上限。
 *
 * 返回值里的 `truncated` 只在**确实还有没取到的记录**时为 true——刚好 2000 条的工作区
 * 不该被提示"已截断"。
 */
export async function loadResumesForGrouping(
  fetchPage: PageFetcher,
  options: { maxPages?: number } = {},
): Promise<{ items: ResumeBrief[]; truncated: boolean }> {
  const maxPages = options.maxPages ?? GROUP_FETCH_MAX_PAGES;
  const items: ResumeBrief[] = [];
  let truncated = false;
  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const result = await fetchPage(pageNo, GROUP_FETCH_PAGE_SIZE);
    items.push(...result.items);
    if (items.length >= result.total) break;
    if (result.items.length === 0) break;
    if (pageNo === maxPages) truncated = true;
  }
  return { items, truncated };
}

export interface GroupedResumeData {
  groups: ResumeGroup[];
  /** 本次真正拉到的扁平记录（≤2000），供对比/归档等仍按 resume_id 工作的入口。 */
  items: ResumeBrief[];
  truncated: boolean;
}

export interface GroupedResumeFilters {
  keyword?: string;
  jobId?: number;
  hasJobFilter?: boolean;
  sort?: ResumeSort;
}

/**
 * 折叠视图的数据源：筛选/排序变化才重新拉，翻组页只切本地切片（页面负责）。
 */
export function useGroupedResumes(filters: GroupedResumeFilters, deps: unknown[]) {
  const { keyword, jobId, hasJobFilter, sort } = filters;
  return useApi<GroupedResumeData>(
    async () => {
      const { items, truncated } = await loadResumesForGrouping((page, pageSize) =>
        listResumes({
          keyword,
          page,
          page_size: pageSize,
          job_id: jobId,
          has_job: hasJobFilter,
          sort,
        }),
      );
      return { groups: groupResumes(items), items, truncated };
    },
    deps,
    { refetchOnFocus: {} },
  );
}
