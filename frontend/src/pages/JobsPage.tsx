/** 岗位广场：搜索筛选、手动添加、详情与生成简历入口。 */
import { App } from "antd";
import type { TableRowSelection } from "antd/es/table/interface";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { markCandidateJobImported } from "../api/candidateJob";
import { openWebFormUrl } from "../api/webform";
import { addToQueue, QueueConflictError, startBackfill } from "../api/apply";
import {
  batchDeleteJobs,
  batchUpdateJobStatus,
  deleteJob,
  getJob,
  listJobs,
  updateJob,
} from "../api/jobs";
import GenerateResumeModal from "../components/GenerateResumeModal";
import JobAnalysisModal from "../components/JobAnalysisModal";
import JobDetailDrawer from "../components/JobDetailDrawer";
import JobFormModal from "../components/JobFormModal";
import JobMatchModal from "../components/JobMatchModal";
import JobMatchBatchPanel from "../components/JobMatchBatchPanel";
import ManualResumeModal from "../components/ManualResumeModal";
import { candidateImportSource } from "../utils/jobSource";
import CandidateJobsDrawer from "../components/jobs/CandidateJobsDrawer";
import { candidateToJobPayload } from "../components/jobs/candidate/candidatePayload";
import JobTable from "../components/jobs/JobTable";
import { useApi } from "../hooks/useApi";
import type { CandidateJobDetail, Job } from "../types";
import { BatchToolbar } from "./jobs/BatchToolbar";
import { JobFilterBar } from "./jobs/JobFilterBar";
import type { BatchAction, MatchBatchRunMode } from "./jobs/jobFilterOptions";

export default function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();

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

  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [generateJob, setGenerateJob] = useState<Job | null>(null);
  const [manualResumeJob, setManualResumeJob] = useState<Job | null>(null);
  const [analysisJob, setAnalysisJob] = useState<Job | null>(null);
  const [matchJob, setMatchJob] = useState<Job | null>(null);
  const [matchBatchOpen, setMatchBatchOpen] = useState(false);
  const [matchBatchAutoRun, setMatchBatchAutoRun] = useState(false);
  const [matchBatchRunMode, setMatchBatchRunMode] = useState<MatchBatchRunMode>("immediate");
  const [queueJobId, setQueueJobId] = useState<number | null>(null);
  const [webFormJobId, setWebFormJobId] = useState<number | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([]);
  const [batchStatus, setBatchStatus] = useState<string>();
  const [batchAction, setBatchAction] = useState<BatchAction>(null);
  const [favoriteJobId, setFavoriteJobId] = useState<number | null>(null);
  // 「补齐详情」触发中：防止连点，也让按钮有个加载态。
  const [backfilling, setBackfilling] = useState(false);
  // 备选岗位：抽屉里暂存未核对的招聘信息，导入时走正式岗位表单。
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  // 导入用**详情**那一份：列表不带 JD，用它预填表单会得到一个没有职位描述的空表单。
  const [importCandidate, setImportCandidate] = useState<CandidateJobDetail | null>(null);
  const [importedCandidateId, setImportedCandidateId] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
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
  const [openedCollectTaskIdsKey, setOpenedCollectTaskIdsKey] = useState("");
  const [openedLinkedJobId, setOpenedLinkedJobId] = useState<number | null>(null);

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

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  useEffect(() => {
    if (!collectTaskIdsKey || openedCollectTaskIdsKey === collectTaskIdsKey) return;
    setCandidatesOpen(true);
    setOpenedCollectTaskIdsKey(collectTaskIdsKey);
  }, [collectTaskIdsKey, openedCollectTaskIdsKey]);

  // 只有"职位描述为空"的岗位才值得补详情（补详情要逐个打开页面，很慢），按钮据此出现/消失，
  // 而不是常驻一个点了没反应的按钮。当前只统计这一页已加载的岗位：补的就这一页里空的那些。
  const emptyDescriptionJobIds = (jobs?.items ?? [])
    .filter((job) => !job.description.trim())
    .map((job) => job.id);

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

  const removeJob = useCallback(
    async (id: number) => {
      try {
        await deleteJob(id);
        setSelectedJobIds((current) => current.filter((jobId) => jobId !== id));
        message.success("已移入回收站，可在「回收站」里恢复");
        void reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "删除失败");
      }
    },
    [message, reload],
  );

  const toggleFavorite = useCallback(
    async (job: Job) => {
      if (batchAction !== null || favoriteJobId !== null) return;
      setFavoriteJobId(job.id);
      try {
        const updated = await updateJob(job.id, { favorite: !job.favorite });
        setDetailJob((current) => (current?.id === job.id ? updated : current));
        await reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "更新收藏状态失败");
      } finally {
        setFavoriteJobId(null);
      }
    },
    [batchAction, favoriteJobId, message, reload],
  );

  const addJobToQueue = useCallback(
    async (job: Job, confirm: { unanalyzed?: boolean; realGap?: boolean } = {}) => {
      setQueueJobId(job.id);
      try {
        await addToQueue([
          {
            job_id: job.id,
            confirm_unanalyzed: confirm.unanalyzed,
            confirm_real_gap: confirm.realGap,
          },
        ]);
        message.success("已加入投递台队列");
      } catch (err) {
        if (err instanceof QueueConflictError) {
          const detail = err.detail;
          if (detail.site_unsupported) {
            // 这一类**没有"仍然加入"的选项**：确认也放行不了（投递时定位不到站点），
            // 所以只给一个必须点掉的提示，而不是给个按钮让人以为可以强行通过。
            modal.warning({
              title: "这个岗位不能自动投递",
              content: detail.message,
              okText: "知道了",
            });
          } else if (detail.unanalyzed) {
            modal.confirm({
              title: "该岗位还没做过匹配分析",
              content: "建议先做「匹配度分析」。也可以直接加入队列，投递前仍会再核对一次。",
              okText: "仍然加入队列",
              cancelText: "取消",
              onOk: () => addJobToQueue(job, { unanalyzed: true }),
            });
          } else if (detail.gaps && detail.gaps.length > 0) {
            modal.confirm({
              title: "该岗位存在真实缺口，默认不投",
              content: `匹配分析判定你确实不具备这些要求：${detail.gaps.join("、")}。确认仍要投递该岗位吗？`,
              okText: "确认仍然投递",
              okButtonProps: { danger: true },
              cancelText: "取消",
              onOk: () => addJobToQueue(job, { realGap: true }),
            });
          } else {
            message.warning(detail.message);
          }
        } else {
          message.error(err instanceof Error ? err.message : "加入投递台失败");
        }
      } finally {
        setQueueJobId(null);
      }
    },
    [message, modal],
  );

  const openJobWebForm = useCallback(
    async (job: Job) => {
      if (!job.source_url || webFormJobId !== null) return;
      setWebFormJobId(job.id);
      try {
        await openWebFormUrl(job.source_url);
        message.success("已在网申专用浏览器中打开投递页面");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "打开网申页面失败");
      } finally {
        setWebFormJobId(null);
      }
    },
    [message, webFormJobId],
  );

  const backfillDetails = async () => {
    // 批量优先：选择模式下有勾选就补勾选的，否则补当前这页所有 JD 为空的岗位。
    const target =
      selectionMode && selectedJobIds.length > 0 ? selectedJobIds : emptyDescriptionJobIds;
    if (target.length === 0) {
      message.warning("当前页没有需要补齐详情的岗位");
      return;
    }
    setBackfilling(true);
    try {
      await startBackfill(target);
      // 它是 kind=collect 的批次，界面入口在投递台：不告诉用户去哪儿看，他会以为点了没反应。
      message.success(`已开始为 ${target.length} 个岗位补齐详情，进度见「投递台 → 自动采集」`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "补齐详情失败");
    } finally {
      setBackfilling(false);
    }
  };

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

  const exitSelectionMode = () => {
    if (batchAction !== null) return;
    setSelectionMode(false);
    setSelectedJobIds([]);
    setBatchStatus(undefined);
  };

  const openMatchBatch = (autoRun: boolean, runMode: MatchBatchRunMode = "immediate") => {
    if (autoRun && !selectionMode) {
      // 「AI 分析适配度」分析的是勾选的岗位：没进选择模式说明用户还没机会勾选——
      // 直接带他进选择模式，而不是丢一句「请先选择岗位」的死路提示。
      setSelectionMode(true);
      message.info("已进入选择模式，勾选岗位后点分析");
      return;
    }
    if (autoRun && selectedJobIds.length === 0) {
      message.warning("请先选择岗位");
      return;
    }
    if (autoRun && selectedJobIds.length > 50) {
      message.warning("一次最多分析 50 个岗位");
      return;
    }
    setMatchBatchAutoRun(autoRun);
    setMatchBatchRunMode(runMode);
    setMatchBatchOpen(true);
  };

  const rowSelection: TableRowSelection<Job> = {
    selectedRowKeys: selectedJobIds,
    preserveSelectedRowKeys: true,
    onChange: (keys) => {
      const jobIds = keys.map(Number);
      if (jobIds.length > 500) {
        message.warning("一次最多选择 500 个岗位");
        return;
      }
      setSelectedJobIds(jobIds);
    },
    getCheckboxProps: () => ({ disabled: batchAction !== null }),
  };

  return (
    <div>
      <JobFilterBar
        keyword={keyword}
        setKeyword={setKeyword}
        setPage={setPage}
        jobType={jobType}
        setJobType={setJobType}
        status={status}
        setStatus={setStatus}
        sourceKind={sourceKind}
        setSourceKind={setSourceKind}
        batchAction={batchAction}
        selectionMode={selectionMode}
        setSelectionMode={setSelectionMode}
        exitSelectionMode={exitSelectionMode}
        openMatchBatch={openMatchBatch}
        emptyDescriptionJobIds={emptyDescriptionJobIds}
        backfilling={backfilling}
        backfillDetails={backfillDetails}
        setCandidatesOpen={setCandidatesOpen}
        setFormOpen={setFormOpen}
      />

      <BatchToolbar
        selectionMode={selectionMode}
        selectedJobIds={selectedJobIds}
        setSelectedJobIds={setSelectedJobIds}
        batchAction={batchAction}
        batchStatus={batchStatus}
        setBatchStatus={setBatchStatus}
        applyBatchStatus={applyBatchStatus}
        removeSelectedJobs={removeSelectedJobs}
      />

      <JobTable
        jobs={jobs}
        loading={loading}
        selectionMode={selectionMode}
        rowSelection={rowSelection}
        batchAction={batchAction}
        favoriteJobId={favoriteJobId}
        page={page}
        pageSize={pageSize}
        onToggleFavorite={(job) => void toggleFavorite(job)}
        onOpenDetail={openDetail}
        onGenerate={setGenerateJob}
        onWrite={setManualResumeJob}
        onViewResumes={(job) => navigate("/resumes?job_id=" + job.id)}
        onEdit={(job) => {
          setEditingJob(job);
          setFormOpen(true);
        }}
        onDelete={(job) => void removeJob(job.id)}
        onPageChange={(nextPage, nextPageSize) => {
          setPage(nextPage);
          setPageSize(nextPageSize);
        }}
      />

      <JobDetailDrawer
        job={detailJob}
        onClose={closeDetail}
        onGenerate={(job) => setGenerateJob(job)}
        onWrite={(job) => setManualResumeJob(job)}
        onViewResumes={(job) => navigate(`/resumes?job_id=${job.id}`)}
        onAnalyze={setAnalysisJob}
        onMatch={setMatchJob}
        onAddToQueue={(job) => void addJobToQueue(job)}
        onAskAssistant={(job) => navigate(`/assistant?job_id=${job.id}`)}
        onFavorite={(job) => void toggleFavorite(job)}
        onOpenWebForm={(job) => void openJobWebForm(job)}
        favoriteLoading={favoriteJobId === detailJob?.id}
        queueLoading={queueJobId === detailJob?.id}
        webFormLoading={webFormJobId === detailJob?.id}
      />
      <JobFormModal
        open={formOpen}
        initial={editingJob}
        // 从备选岗位导入时，把原文预填进表单并标注来源。
        presetRawText={importCandidate?.raw_text ?? ""}
        // 采集来的候选没有 raw_text，内容在结构化字段里——只给原文那一路会让表单整个空着。
        presetJob={importCandidate ? candidateToJobPayload(importCandidate) : undefined}
        // 来源要**继承候选自己的来路**：写死「备选岗位导入」会让采集回来的岗位在列表里
        // 挂上「手动」角标（用户明明是从投递台采集回来的）。
        presetSource={importCandidate ? candidateImportSource(importCandidate) : undefined}
        onClose={() => {
          setFormOpen(false);
          setEditingJob(null);
          setImportCandidate(null);
        }}
        onSaved={(jobId) => {
          void reload();
          const candidate = importCandidate;
          if (!candidate || !jobId) return;
          setImportCandidate(null);
          setImportedCandidateId(candidate.id);
          void markCandidateJobImported(candidate.id, jobId)
            .then(() => message.success("备选岗位已导入正式岗位"))
            .catch((err) => message.error(err instanceof Error ? err.message : "标记导入状态失败"));
        }}
      />
      <CandidateJobsDrawer
        open={candidatesOpen}
        importedCandidateId={importedCandidateId}
        collectTaskIds={collectTaskIds}
        onClose={() => setCandidatesOpen(false)}
        onImport={(candidate) => {
          setImportCandidate(candidate);
          setEditingJob(null);
          setFormOpen(true);
          setCandidatesOpen(false);
        }}
      />
      <GenerateResumeModal
        job={generateJob}
        open={!!generateJob}
        onClose={() => setGenerateJob(null)}
      />
      <ManualResumeModal
        job={manualResumeJob}
        open={!!manualResumeJob}
        onClose={() => setManualResumeJob(null)}
      />
      <JobAnalysisModal job={analysisJob} onClose={() => setAnalysisJob(null)} />
      <JobMatchModal job={matchJob} onClose={() => setMatchJob(null)} />
      <JobMatchBatchPanel
        open={matchBatchOpen}
        jobIds={matchBatchAutoRun ? selectedJobIds : []}
        autoRun={matchBatchAutoRun}
        runMode={matchBatchRunMode}
        onClose={() => setMatchBatchOpen(false)}
      />
    </div>
  );
}
