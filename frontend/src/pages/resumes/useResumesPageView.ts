// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的「视图状态」：筛选 / 排序 / 分页 / 折叠切片 / URL 写回。
 *
 * ## 为什么单独成 hook
 *
 * `ResumesPage.tsx` 同时管着 6 个弹窗、批量选择、收藏防连点与深链，页面本体已经顶到
 * 500 行预算（零豁免）。这里搬出去的是**只描述"列表长什么样"**的那一半：URL 里的
 * keyword / page / page_size / has_job / sort，以及由它们拉回来的分组数据与两组切片
 * （折叠视图按组切片、平铺视图按条切片）。搬家是纯搬迁，行为与搬迁前逐字一致。
 *
 * ## 两套排序状态并存（重要，别合并）
 *
 * - `sortState`（`utils/resumeSort`）：**服务端**排序，写 URL。平铺表格的列头用它，
 *   数据层 `useGroupedResumes` 的 fetch 也用它——平铺视图的 `flatPageItems` 与折叠
 *   视图的 `loadedItems` 是同一份数据，把 fetch 固定成 `updated_desc` 会顺手砍掉
 *   平铺表格的列头排序。
 * - `groupSortState`（`utils/groupSort`）：**本地**组级排序，只作用于折叠视图，不进 URL
 *   （刷新回默认）。它必须在已加载数据上再排一层：服务端只有"简历级"排序键，直接用
 *   服务端排在「最近更新升序」时会排成"组内最早版本"的顺序，与列上显示的组内最新
 *   时间自相矛盾。
 *
 * 两套状态的方向来源不同，界面各自表达：平铺表列头读 `sortState`，折叠表列头读
 * `groupSortState`。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useSearchParams } from "react-router-dom";
import type { ResumeBrief } from "../../types";
import { useGroupedResumes } from "../../features/resume/list/useGroupedResumes";
import type { GroupedResumeData } from "../../features/resume/list/useGroupedResumes";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import { useResumeListVersion } from "../../features/resume/resumeListEvents";
import {
  DEFAULT_GROUP_SORT_STATE,
  isDefaultGroupSort,
  sortGroups,
  type GroupSortState,
} from "../../utils/groupSort";
import {
  DEFAULT_RESUME_SORT_STATE,
  isDefaultResumeSort,
  parseResumeSort,
  toResumeSort,
  type ResumeSortState,
} from "../../utils/resumeSort";

/** 每页默认条数（组页与条页共用同一个数字，与搬迁前一致）。 */
const DEFAULT_PAGE_SIZE = 10;

export interface ResumesPageView {
  keyword: string;
  jobId: number | undefined;
  hasJobFilter: boolean | undefined;
  page: number;
  pageSize: number;
  /** 服务端排序（平铺表列头 + 数据层 fetch）。 */
  sortState: ResumeSortState;
  /** 本地组级排序（折叠表列头），不进 URL。 */
  groupSortState: GroupSortState;
  /** 「恢复默认排序」是否该出现：谁在屏幕上就复位谁。 */
  sortChanged: boolean;
  /** 库里有「同岗位多版本」→ 走折叠视图。 */
  folded: boolean;
  /** 当前页的组（已按 `groupSortState` 排序）。 */
  pageGroups: ResumeGroup[];
  totalGroups: number;
  /** 已加载的扁平记录（≤2000 条）：对比、交付归档等入口按 resume_id 工作。 */
  loadedItems: ResumeBrief[];
  /** 当前页的扁平记录（平铺表格用）。 */
  flatPageItems: ResumeBrief[];
  grouped: GroupedResumeData | undefined;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  setPage: Dispatch<SetStateAction<number>>;
  setPageSize: Dispatch<SetStateAction<number>>;
  applyKeyword: (value: string) => void;
  applyJobFilter: (jobId: number | undefined) => void;
  applyHasJobFilter: (value: boolean | undefined) => void;
  applySort: (next: ResumeSortState) => void;
  applyGroupSort: (next: GroupSortState) => void;
  resetSort: () => void;
}

export function useResumesPageView(): ResumesPageView {
  const [searchParams, setSearchParams] = useSearchParams();

  /** `1` / `0` / 缺省三态：缺省表示"不限"（不写进 URL）。 */
  const readBoolParam = (key: string): boolean | undefined => {
    const raw = searchParams.get(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return undefined;
  };

  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const [pageSize, setPageSize] = useState(
    Number(searchParams.get("page_size")) || DEFAULT_PAGE_SIZE,
  );
  const [hasJobFilter, setHasJobFilter] = useState<boolean | undefined>(() =>
    readBoolParam("has_job"),
  );
  /**
   * 排序初值从 URL 读一次（深链 / 刷新保持），之后 URL 只是**输出**——每次排序都回读
   * URL 会让状态有两个真相。非法值（含旧下拉框留下的 `company_asc`）由
   * `parseResumeSort` 回落到默认。
   */
  const [sortState, setSortState] = useState<ResumeSortState>(() =>
    parseResumeSort(searchParams.get("sort")),
  );
  /** 组级排序只存组件 state：刷新回默认（已拍板"不写 URL"）。 */
  const [groupSortState, setGroupSortState] = useState<GroupSortState>(
    DEFAULT_GROUP_SORT_STATE,
  );

  /** 排序变化：回到第 1 页（不然会停在一个"新排序下不存在的页"上）。 */
  const applySort = useCallback((next: ResumeSortState) => {
    setSortState(next);
    setPage(1);
  }, []);

  const applyGroupSort = useCallback((next: GroupSortState) => {
    setGroupSortState(next);
    setPage(1);
  }, []);

  const jobIdParam = searchParams.get("job_id");
  const jobId = jobIdParam && /^\d+$/.test(jobIdParam) ? Number(jobIdParam) : undefined;

  /**
   * 岗位筛选只改 `job_id`（选择时顺带回到第 1 页）。
   *
   * 刻意不用 `navigate("/resumes")`：那会把 keyword、has_job、page_size 一起清掉，
   * 而"按岗位筛选"与"有/无目标岗位""关键词"是互相独立的三维条件。清空同理，只删 job_id。
   *
   * `page` 由下面那个统一写回器维护（只在 page > 1 时保留参数），所以"回到第 1 页"
   * 表现为 URL 里没有 page、请求里的 page 是 1，与本页既有约定一致。
   */
  const applyJobFilter = useCallback(
    (nextJobId: number | undefined) => {
      setPage(1);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          if (nextJobId === undefined) {
            next.delete("job_id");
          } else {
            next.set("job_id", String(nextJobId));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  /** 关键词提交（Enter / 防抖 / 清空共用）：回到第 1 页，不动岗位、排序等其它筛选。 */
  const applyKeyword = useCallback((value: string) => {
    setKeyword(value);
    setPage(1);
  }, []);

  const applyHasJobFilter = useCallback((value: boolean | undefined) => {
    setHasJobFilter(value);
    setPage(1);
  }, []);

  // T12：手写简历保存成功后广播版本号，放进依赖里让列表自动重取。
  const resumeListVersion = useResumeListVersion();
  // CR-33：折叠视图按「组」分页。后端只能按简历条分页，所以 useGroupedResumes 先按
  // 100 条/页补齐（上限 2000 条）再本地分组；这里的 page/pageSize 都是**组页**。
  const { data: grouped, loading, reload, error } = useGroupedResumes(
    {
      keyword,
      jobId,
      hasJobFilter,
      // 服务端排序只由 `sortState` 决定（见文件头「两套排序状态并存」）。
      sort: toResumeSort(sortState),
    },
    [keyword, jobId, hasJobFilter, sortState, resumeListVersion],
  );

  const allGroups = useMemo(() => grouped?.groups ?? [], [grouped]);
  /** 有「同岗位多版本」才进入折叠视图（与 `ResumeResultList` 的判定同源）。 */
  const folded = allGroups.some((group) => group.versionCount > 1);
  /**
   * 折叠视图：先按组级排序整体重排，再切当前页的组。
   * 已知上限：排序只在当前加载窗口（≤2000 条）内成立，窗口外无从比较——
   * 这个上限本来就存在（`useGroupedResumes` 的分页补齐），页面底部的 Alert 负责解释。
   */
  const sortedGroups = useMemo(
    () => sortGroups(allGroups, groupSortState),
    [allGroups, groupSortState],
  );
  const totalGroups = sortedGroups.length;
  const pageGroups = useMemo(
    () => sortedGroups.slice((page - 1) * pageSize, page * pageSize),
    [sortedGroups, page, pageSize],
  );
  const loadedItems = useMemo(() => grouped?.items ?? [], [grouped]);
  /** 平铺视图仍按条切当前页（与折叠视图同一份数据、同一个页码状态）。 */
  const flatPageItems = useMemo(
    () => loadedItems.slice((page - 1) * pageSize, page * pageSize),
    [loadedItems, page, pageSize],
  );

  // 筛选 / 分页写回 URL（replace 语义）。effect 只依赖这些状态，不依赖 searchParams，
  // 因此写回不会触发循环重渲染；job_id 参数通过 functional 更新原样保留。
  useEffect(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        const values: [string, string][] = [
          ["keyword", keyword],
          ["has_job", hasJobFilter === undefined ? "" : hasJobFilter ? "1" : "0"],
          ["page", page > 1 ? String(page) : ""],
          ["page_size", pageSize !== DEFAULT_PAGE_SIZE ? String(pageSize) : ""],
          // 默认排序不写回 URL：干净的链接比"默认值也显式写出来"更好读。
          ["sort", sortState.explicit ? toResumeSort(sortState) : ""],
        ];
        for (const [key, value] of values) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }, [keyword, hasJobFilter, page, pageSize, sortState, setSearchParams]);

  const sortChanged = folded
    ? !isDefaultGroupSort(groupSortState)
    : !isDefaultResumeSort(sortState);

  const resetSort = useCallback(() => {
    if (folded) {
      setGroupSortState(DEFAULT_GROUP_SORT_STATE);
      setPage(1);
      return;
    }
    setSortState(DEFAULT_RESUME_SORT_STATE);
    setPage(1);
  }, [folded]);

  return {
    keyword,
    jobId,
    hasJobFilter,
    page,
    pageSize,
    sortState,
    groupSortState,
    sortChanged,
    folded,
    pageGroups,
    totalGroups,
    loadedItems,
    flatPageItems,
    grouped,
    loading,
    error,
    reload,
    setPage,
    setPageSize,
    applyKeyword,
    applyJobFilter,
    applyHasJobFilter,
    applySort,
    applyGroupSort,
    resetSort,
  };
}
