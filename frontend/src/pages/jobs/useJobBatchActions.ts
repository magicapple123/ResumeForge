/** 岗位广场的批量动作（改状态 / 删除 / 加入投递队列）。
 *
 *  从 JobsPage 拆出：这三个动作共约 90 行，页面组合层继续变大会撞 500 行预算
 *  （`backend/tests/test_file_size_budget.py`）。拆分只搬代码不改行为：
 *  勾选状态、批次忙态、详情抽屉仍由页面持有，这里只负责"发请求 + 逐条说清结果"。
 */
import { App } from "antd";
import type { Dispatch, SetStateAction } from "react";
import { batchDeleteJobs, batchUpdateJobStatus } from "../../api/jobs";
import { bulkEnqueueJobs, bulkEnqueueSummary } from "../../components/apply/queue/bulkEnqueue";
import type { Job, JobList, Page } from "../../types";

/** 批量动作的类型与 `pages/jobs/jobFilterOptions.ts` 的 `BatchAction` 一致。 */
type BatchAction = "status" | "delete" | "enqueue" | null;

export function useJobBatchActions({
  jobs,
  page,
  selectedJobIds,
  batchStatus,
  setPage,
  setSelectedJobIds,
  setBatchStatus,
  setBatchAction,
  setDetailJob,
  reload,
}: {
  jobs: Page<JobList> | undefined;
  page: number;
  selectedJobIds: number[];
  batchStatus: string | undefined;
  setPage: (page: number) => void;
  setSelectedJobIds: Dispatch<SetStateAction<number[]>>;
  setBatchStatus: (status: string | undefined) => void;
  setBatchAction: (action: BatchAction) => void;
  setDetailJob: Dispatch<SetStateAction<Job | null>>;
  reload: () => void | Promise<void>;
}) {
  const { message } = App.useApp();

  const applyBatchStatus = async () => {
    if (selectedJobIds.length === 0) {
      message.warning("请先选择岗位");
      return;
    }
    if (!batchStatus) {
      message.warning("请选择要设置的状态");
      return;
    }

    const jobIds = [...selectedJobIds];
    const nextStatus = batchStatus;
    setBatchAction("status");
    try {
      const result = await batchUpdateJobStatus({ job_ids: jobIds, status: nextStatus });
      setSelectedJobIds([]);
      setBatchStatus(undefined);
      // 抽屉可能正开着其中一条：状态改了就地同步，别让用户看着旧状态。
      setDetailJob((current) =>
        current && jobIds.includes(current.id) ? { ...current, status: nextStatus } : current,
      );
      await reload();
      message.success(`已更新 ${result.updated} 个岗位的状态`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "批量更新状态失败");
    } finally {
      setBatchAction(null);
    }
  };

  const removeSelectedJobs = async () => {
    if (selectedJobIds.length === 0) {
      message.warning("请先选择岗位");
      return;
    }

    const jobIds = [...selectedJobIds];
    setBatchAction("delete");
    try {
      const result = await batchDeleteJobs({ job_ids: jobIds });
      setSelectedJobIds([]);
      setBatchStatus(undefined);
      setDetailJob((current) => (current && jobIds.includes(current.id) ? null : current));
      // 当前页因此变空且还有上一页时回退一页，避免停在一页空白上；其余情况原地刷新，
      // 不无脑跳回首页。
      const listedJobs = jobs?.items ?? [];
      if (listedJobs.length > 0 && listedJobs.every((job) => jobIds.includes(job.id)) && page > 1) {
        setPage(page - 1);
      }
      await reload();
      const failed = jobIds.length - result.deleted;
      if (failed > 0) {
        message.warning(`成功 ${result.deleted} 个，${failed} 个未能删除；已删除的可在回收站恢复`);
      } else {
        message.success(`已删除 ${result.deleted} 个岗位，可在回收站恢复`);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "批量删除失败");
    } finally {
      setBatchAction(null);
    }
  };

  const enqueueSelectedJobs = async () => {
    if (selectedJobIds.length === 0) {
      message.warning("请先选择岗位");
      return;
    }

    // 与「导入并加入投递队列」同一条海投路径（bulkEnqueueJobs）：逐条入队、逐条容错，
    // 双确认直接带上，最后给聚合账目——bulkEnqueueJobs 正常不会 throw，catch 只兜意外。
    const jobIds = [...selectedJobIds];
    setBatchAction("enqueue");
    try {
      const outcome = await bulkEnqueueJobs(jobIds);
      setSelectedJobIds([]);
      await reload();
      if (outcome.enqueued > 0) {
        message.success(bulkEnqueueSummary(outcome));
      } else {
        message.warning(bulkEnqueueSummary(outcome));
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "批量加入投递队列失败");
    } finally {
      setBatchAction(null);
    }
  };

  return { applyBatchStatus, removeSelectedJobs, enqueueSelectedJobs };
}
