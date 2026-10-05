/** JobsPage 的状态层：筛选/分页/详情 job_id 的 URL 状态化，以及由它驱动的列表查询。 */
import { App } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getJob, listJobs } from "../../api/jobs";
import { useApi } from "../../hooks/useApi";
import type { Job } from "../../types";

export function useJobsPageState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { message } = App.useApp();

  // 筛选 / 分页 / 详情的初值从 URL 读：链接可分享、刷新后状态不丢（与 WebFormPage 的
  // URL 化同一模式）。用户改动后由下面的 effect 用 replace 语义写回，不堆历史栈。
  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  const [jobType, setJobType] = useState(searchParams.get("job_type") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [sourceKind, setSourceKind] = useState<"" | "collected" | "manual">(() => {
    const raw = searchParams.get("source_kind");
    return raw === "collected" || raw === "manual" ? raw : "";
  });
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const [pageSize, setPageSize] = useState(Number(searchParams.get("page_size")) || 10);

  // 详情抽屉的岗位本体与 ?job_id= 的写入/移除绑在同一处；页面里其它逻辑（收藏、批量
  // 操作）通过返回的 setDetailJob 更新它。
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [openedLinkedJobId, setOpenedLinkedJobId] = useState<number | null>(null);

  const linkedJobId = Number(searchParams.get("job_id")) || null;
  const collectTaskIdsKey = searchParams.get("collect_task_ids") ?? "";
  const collectTaskIds = useMemo(
    () => [
      ...new Set(
        collectTaskIdsKey
          .split(",")
          .map(Number)
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ],
    [collectTaskIdsKey],
  );

  const {
    data: jobs,
    loading,
    reload,
    error,
  } = useApi(
    () =>
      listJobs({
        keyword,
        job_type: jobType,
        status,
        source_kind: sourceKind || undefined,
        page,
        page_size: pageSize,
      }),
    [keyword, jobType, status, sourceKind, page, pageSize],
  );

  // 筛选 / 分页写回 URL（replace 语义）。effect 只依赖这些状态本身，不依赖 searchParams：
  // 写回触发的重渲染里 deps 没变、不会再写，因此不会形成循环重渲染。
  // 其余参数（job_id、collect_task_ids）通过 functional 更新原样保留。
  useEffect(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        const values: [string, string][] = [
          ["keyword", keyword],
          ["job_type", jobType],
          ["status", status],
          ["source_kind", sourceKind],
          ["page", page > 1 ? String(page) : ""],
          ["page_size", pageSize !== 10 ? String(pageSize) : ""],
        ];
        for (const [key, value] of values) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }, [keyword, jobType, status, sourceKind, page, pageSize, setSearchParams]);

  // 详情与 ?job_id= 同步：打开详情写进 URL（可分享/刷新后恢复），关闭就移除。
  const openDetail = useCallback(
    (job: Job) => {
      setDetailJob(job);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("job_id", String(job.id));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const closeDetail = useCallback(() => {
    setDetailJob(null);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("job_id");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  // 从 ?job_id= 恢复详情：岗位在当前页就直接用，不在就单独拉一次。
  useEffect(() => {
    if (!linkedJobId || openedLinkedJobId === linkedJobId || loading) return;
    const listedJob = jobs?.items.find((item) => item.id === linkedJobId);
    if (listedJob) {
      setDetailJob(listedJob);
      setOpenedLinkedJobId(linkedJobId);
      return;
    }
    setOpenedLinkedJobId(linkedJobId);
    void getJob(linkedJobId)
      .then(setDetailJob)
      .catch((err) => message.error(err instanceof Error ? err.message : "岗位不存在或已被删除"));
  }, [jobs, linkedJobId, loading, message, openedLinkedJobId]);

  return {
    keyword,
    setKeyword,
    jobType,
    setJobType,
    status,
    setStatus,
    sourceKind,
    setSourceKind,
    page,
    setPage,
    pageSize,
    setPageSize,
    detailJob,
    setDetailJob,
    openDetail,
    closeDetail,
    collectTaskIdsKey,
    collectTaskIds,
    jobs,
    loading,
    reload,
    error,
  };
}
