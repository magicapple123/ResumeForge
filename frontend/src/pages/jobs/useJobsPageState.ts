// SPDX-License-Identifier: Apache-2.0
/** JobsPage 的状态层：筛选/分页/详情 job_id 的 URL 状态化，以及由它驱动的列表查询。 */
import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getJob, listJobs } from "../../api/jobs";
import { useApi } from "../../hooks/useApi";
import type { Job, JobList } from "../../types";
import { DEFAULT_JOB_SORT_STATE, type JobSortState } from "../../utils/jobSort";

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
  // 排序（E）：**只存在组件状态里**，不进 URL。离开岗位广场（组件卸载）即恢复默认，
  // 从简历中心回来不会停在上次的排序上；URL 里的 sort/order 也不再被读取。
  // 后端是分页排序的唯一权威——绝不能在前端对本页数据本地排序（分页会错）。
  const [sortState, setSortState] = useState<JobSortState>(DEFAULT_JOB_SORT_STATE);
  /** 换排序一定回到第 1 页：停在第 3 页看"按标题排"的第一批没有意义。 */
  const applySort = useCallback((next: JobSortState) => {
    setSortState(next);
    setPage(1);
  }, []);

  // 详情抽屉的岗位本体与 ?job_id= 的写入/移除绑在同一处；页面里其它逻辑（收藏、批量
  // 操作）通过返回的 setDetailJob 更新它。详情必须是 getJob 的**全量**那份——列表项
  // 已不带 JD 全文（JobList），直接复用会让抽屉空着一份岗位描述。
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  // 已发起过详情请求的 job_id：防止 jobs 重载时重复拉取。用 ref 而不是 state，是因为
  // 它只在 effect 内部被读写，变成 state 会让"清空锁存允许重试"和 effect 依赖互相触发。
  const openedLinkedJobId = useRef<number | null>(null);
  // 详情请求序号：只接受**最后一次**请求的结果。快速 A→B 时，A 的慢响应不能覆盖 B。
  const detailRequestSeq = useRef(0);
  // 显式重试信号：只有用户动作（打开详情）会递增它，effect 因此永远不会自我重触发。
  // 失败时锁存已被清空，这一次递增就是"再试一次"的唯一入口（R2）。
  const [detailRequestTick, setDetailRequestTick] = useState(0);

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
        sort: sortState.sort,
        order: sortState.order ?? undefined,
        page,
        page_size: pageSize,
      }),
    [keyword, jobType, status, sourceKind, sortState, page, pageSize],
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
          // 排序不进 URL（E）：显式删除，清掉旧链接里残留的 sort/order。
          ["sort", ""],
          ["order", ""],
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

  // 详情与 ?job_id= 同步：打开详情只写 URL（可分享/刷新后恢复），岗位本体由下面的
  // effect 统一经 getJob 拉全量——列表项已瘦身（JobList），这里不再直接复用。
  //
  // R2：**不能无条件清空 detailJob**。双击同一行（或重新点开刚看过的岗位）时，清空会
  // 让抽屉空着，而 effect 又因为 job_id 没变、锁存仍是该 id 而不重新拉取——于是详情永远
  // 不出现。只有换成**另一个**岗位时才清空（避免把上一个岗位的内容当成新的显示）。
  const openDetail = useCallback(
    (job: Pick<JobList, "id">) => {
      if (detailJob?.id !== job.id) setDetailJob(null);
      setDetailRequestTick((tick) => tick + 1);
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("job_id", String(job.id));
          return next;
        },
        { replace: true },
      );
    },
    [detailJob?.id, setSearchParams],
  );

  const closeDetail = useCallback(() => {
    // 作废所有在途请求：关闭之后它们的结果不该再写回抽屉。
    detailRequestSeq.current += 1;
    // 清空锁存，否则再次打开同一个岗位时 effect 会因为 id 相同而跳过拉取。
    openedLinkedJobId.current = null;
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

  // 从 ?job_id= 恢复详情：统一走 getJob 单取全量（列表项已瘦身，不带 JD 全文）。
  // openedLinkedJobId 标记防止重复拉取（jobs 每次重载都是新对象，没有这个锁存就会重复请求）。
  useEffect(() => {
    if (!linkedJobId || loading) return;
    if (openedLinkedJobId.current === linkedJobId) return;
    openedLinkedJobId.current = linkedJobId;
    const seq = (detailRequestSeq.current += 1);
    void getJob(linkedJobId)
      .then((job) => {
        if (seq !== detailRequestSeq.current) return;
        setDetailJob(job);
      })
      .catch((err) => {
        if (seq !== detailRequestSeq.current) return;
        // 失败不锁死：清空锁存，用户再点一次这一行（或重新点开）就会重新拉取。
        openedLinkedJobId.current = null;
        message.error(err instanceof Error ? err.message : "岗位不存在或已被删除");
      });
  }, [detailRequestTick, jobs, linkedJobId, loading, message]);

  return {
    keyword,
    setKeyword,
    jobType,
    setJobType,
    status,
    setStatus,
    sourceKind,
    setSourceKind,
    sortState,
    applySort,
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
