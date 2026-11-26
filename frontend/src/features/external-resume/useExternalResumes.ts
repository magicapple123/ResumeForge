// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历面板的取数与动作（第 21 条）：列表 / 上传 / 删除。
 *
 * 为什么单独一个 feature hook：面板（列表 + 空态 + 操作）与上传弹窗都要"上传成功后
 * 刷新列表"，把这份状态留在两个组件里会出现两份 loading、两次刷新和两种失败提示。
 * 这里只做**取数与动作**，Toast 文案与跳转由组件决定（同一动作在不同入口措辞不同）。
 *
 * 删除是软删（进回收站），所以这里只负责调 delete 接口；"撤销"由面板用
 * `restoreTrashItem` 提供——恢复是回收站的语义，不属于本 hook。
 *
 * **分页与排序（T09）都在服务端**：列表一次只取 `PAGE_SIZE` 条，排序下推 SQL。
 * 之前的 `PAGE_SIZE = 100` + `pagination={false}` 是"外部简历只有几份"的假设，一旦
 * 用户攒到 100 份以上，第 101 份起就永远看不见（也不会报错，只是"少了几份"）；
 * 而前端排序只能排到当页，翻页就露馅。页码/排序都进请求参数，翻页只换数据。
 */
import { useCallback, useEffect, useState } from "react";
import {
  deleteExternalResume,
  listExternalResumes,
  uploadExternalResume,
} from "../../api/externalResumes";
import type {
  ExternalResumeDetail,
  ExternalResumeItem,
  ExternalResumeSortKey,
  ExternalResumeSortOrder,
} from "../../api/externalResumes";
import { useApi } from "../../hooks/useApi";

/**
 * 每页条数。
 *
 * 20 与简历中心内部列表、岗位广场同口径：外部简历是"用户手动上传的几份"，20 条一屏
 * 已经够看；超过 20 份时给分页器（而不是"一次取 100 条然后什么都看不到"）。
 */
export const PAGE_SIZE = 20;

/** 默认排序：最近上传在前（与后端缺省值 `created_at desc` 一致）。 */
export const DEFAULT_SORT_KEY: ExternalResumeSortKey = "created_at";
export const DEFAULT_SORT_ORDER: ExternalResumeSortOrder = "desc";

export interface ExternalResumeUploadOptions {
  name?: string;
  jobId?: number | null;
}

export interface ExternalResumeFilters {
  keyword?: string;
  jobId?: number;
  /** 服务端排序字段；缺省 `created_at`（不传即后端默认）。 */
  sort?: ExternalResumeSortKey;
  /** 服务端排序方向；缺省 `desc`。 */
  order?: ExternalResumeSortOrder;
}

export interface ExternalResumesApi {
  items: ExternalResumeItem[];
  total: number;
  loading: boolean;
  error: string;
  /** 当前页（1 基）。删到当前页空了由调用方夹取，见面板的 `useEffect`。 */
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  reload: () => Promise<void>;
  uploading: boolean;
  upload: (file: File, options?: ExternalResumeUploadOptions) => Promise<ExternalResumeDetail>;
  remove: (id: number) => Promise<void>;
  /** 批量软删：没有批量端点，逐条 `allSettled` 后只刷新一次列表。 */
  removeMany: (ids: number[]) => Promise<{ deleted: number; failed: number }>;
}

export function useExternalResumes({
  keyword = "",
  jobId,
  sort = DEFAULT_SORT_KEY,
  order = DEFAULT_SORT_ORDER,
}: ExternalResumeFilters = {}): ExternalResumesApi {
  const [page, setPage] = useState(1);

  /**
   * 筛选或排序一变就回第一页。
   *
   * 不回第一页的后果是"搜出 0 条"：用户在别处翻到第 3 页，再改关键词，服务端返回的
   * 是"第 3 页的空集"，界面看起来像搜索没结果。`setPage` 传函数形式，已经是 1 时
   * 不产生新状态（否则每次改筛选都会多一次空刷新）。
   */
  useEffect(() => {
    setPage(1);
  }, [keyword, jobId, sort, order]);

  const listing = useApi(
    () =>
      listExternalResumes({
        keyword: keyword.trim() || undefined,
        job_id: jobId,
        page,
        page_size: PAGE_SIZE,
        sort,
        order,
      }),
    [keyword, jobId, page, sort, order],
  );
  const { reload } = listing;
  const [uploading, setUploading] = useState(false);

  const total = listing.data?.total ?? 0;
  const loaded = listing.data?.items.length ?? 0;

  /**
   * 页码夹取：把当前页删空之后停在「第 3 页 · 0 条」是最难解释的空态——用户会以为
   * 简历全没了。这里在"当页 0 条、但总数不为 0"时退回最后一页。
   *
   * 三个守卫都必要：`loading` 期间 `items` 一定是空的（会把正常翻页打回上一页）；
   * `total === 0` 是真的删光了（该走空态，不该翻页）；`page > lastPage` 才动手
   * （否则平局时会无限 setState）。
   */
  useEffect(() => {
    if (listing.loading || loaded > 0 || total === 0 || page === 1) return;
    const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > lastPage) setPage(lastPage);
  }, [listing.loading, loaded, total, page]);

  const upload = useCallback(
    async (file: File, options: ExternalResumeUploadOptions = {}) => {
      setUploading(true);
      try {
        const record = await uploadExternalResume(file, {
          name: options.name,
          jobId: options.jobId ?? null,
        });
        await reload();
        return record;
      } finally {
        setUploading(false);
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (id: number) => {
      await deleteExternalResume(id);
      await reload();
    },
    [reload],
  );

  /**
   * 批量软删：后端**没有**批量端点（外部简历是一次传一份的私人文件），所以逐条删。
   *
   * 用 `allSettled` 而不是 `all`：一份失败不该让已经删掉的那些"看起来没删"
   * （列表里它们真的没了），返回值把成功/失败分开报，调用方据此给出不同提示。
   * 列表只刷新一次——每条都刷会把整页翻十遍。
   */
  const removeMany = useCallback(
    async (ids: number[]) => {
      const results = await Promise.allSettled(ids.map((id) => deleteExternalResume(id)));
      const deleted = results.filter((result) => result.status === "fulfilled").length;
      await reload();
      return { deleted, failed: results.length - deleted };
    },
    [reload],
  );

  return {
    items: listing.data?.items ?? [],
    total,
    loading: listing.loading,
    error: listing.error,
    page,
    pageSize: PAGE_SIZE,
    setPage,
    reload,
    uploading,
    upload,
    remove,
    removeMany,
  };
}
