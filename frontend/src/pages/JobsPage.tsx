// SPDX-License-Identifier: Apache-2.0
/** 岗位广场：搜索筛选、手动添加、详情与生成简历入口。 */
import { App } from "antd";
import type { TableRowSelection } from "antd/es/table/interface";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { markCandidateJobImported } from "../api/candidateJob";
import { openWebFormUrl } from "../api/webform";
import { startBackfill } from "../api/apply";
import { deleteJob, getJob, updateJob } from "../api/jobs";
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
import { JobImportModal } from "../components/jobs/JobImportModal";
import JobTable from "../components/jobs/JobTable";
import ErrorState from "../components/common/ErrorState";
import type { CandidateJobDetail, Job, JobList } from "../types";
import { BatchToolbar } from "./jobs/BatchToolbar";
import { JobFilterBar } from "./jobs/JobFilterBar";
import type { BatchAction } from "./jobs/jobFilterOptions";
import { useJobQueue } from "./jobs/useJobQueue";
import { useJobsPageState } from "./jobs/useJobsPageState";
import { useSelectAllJobs } from "./jobs/useSelectAllJobs";
import { useJobBatchActions } from "./jobs/useJobBatchActions";
import { useDeleteUndo } from "../features/trash/useDeleteUndo";
import { registerJobCreateHandler } from "../features/shortcuts/runtimeTargets";

export default function JobsPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();

  // 筛选 / 分页 / 详情 job_id 的 URL 状态化与由它驱动的列表查询都收在 hook 里：
  // 初值从 URL 读、改动写回，链接可分享、刷新后状态不丢。
  const {
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
  } = useJobsPageState();

  const [formOpen, setFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [generateJob, setGenerateJob] = useState<Job | null>(null);
  const [manualResumeJob, setManualResumeJob] = useState<Job | null>(null);
  const [analysisJob, setAnalysisJob] = useState<Job | null>(null);
  const [matchJob, setMatchJob] = useState<Job | null>(null);
  const [matchBatchOpen, setMatchBatchOpen] = useState(false);
  const [matchBatchView, setMatchBatchView] = useState<"setup" | "history">("setup");
  const [webFormJobId, setWebFormJobId] = useState<number | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([]);
  const [batchStatus, setBatchStatus] = useState<string>();
  const [batchAction, setBatchAction] = useState<BatchAction>(null);
  const [favoriteJobId, setFavoriteJobId] = useState<number | null>(null);
  // 「补齐详情」触发中：防止连点，也让按钮有个加载态。
  const [backfilling, setBackfilling] = useState(false);
  // 备选岗位：抽屉里暂存未核对的招聘信息，导入时走正式岗位表单。
  const [candidatesOpen, setCandidatesOpen] = useState(false);
  // CSV 导入弹窗。
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  // 导入用**详情**那一份：列表不带 JD，用它预填表单会得到一个没有岗位描述的空表单。
  const [importCandidate, setImportCandidate] = useState<CandidateJobDetail | null>(null);
  const [importedCandidateId, setImportedCandidateId] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);

  // R5 快捷键「新建岗位」：App 侧只在 /jobs 派发，这里把它接到既有的新建弹窗上
  // （与点「手动添加」同一条路径：清掉编辑态与导入预填，再打开表单）。
  useEffect(() => {
    registerJobCreateHandler(() => {
      setEditingJob(null);
      setImportCandidate(null);
      setFormOpen(true);
    });
    return () => registerJobCreateHandler(null);
  }, []);

  // 完成通知的「查看结果」深链（/jobs?match_batch=history）：打开分析记录后清掉参数，
  // 让刷新/返回不会再弹。useJobsPageState 管它自己的筛选参数，这里只动 match_batch。
  // URL → state 的镜像同步属"派生事件"，规则按书面理由豁免（与 useJobsPageState 同模式）。
  /* eslint-disable react-hooks/set-state-in-effect */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("match_batch") !== "history") return;
    setMatchBatchView("history");
    setMatchBatchOpen(true);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("match_batch");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // 完成通知的「查看」深链（/jobs?job_id=<id>&analysis=1）：等详情拉全之后自动打开解读弹窗，
  // 再把参数清掉。boolean 锁存保证"清参数触发的这一轮"不会再把弹窗重开一次；参数彻底
  // 消失后复位，这样从任务条再点一次「查看」（同一个岗位）仍然能打开。
  const analysisLinkHandled = useRef(false);
  useEffect(() => {
    if (searchParams.get("analysis") !== "1") {
      analysisLinkHandled.current = false;
      return;
    }
    if (!detailJob || analysisLinkHandled.current) return;
    analysisLinkHandled.current = true;
    setAnalysisJob(detailJob);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("analysis");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, detailJob, setSearchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  // 新采集批次到达时自动打开抽屉（一次性锁存：同一批 key 不重复弹）。
  // Compiler 规范：渲染期守卫式调整。
  const [prevCollectKey, setPrevCollectKey] = useState<string | null>(null);
  if (prevCollectKey !== collectTaskIdsKey && collectTaskIdsKey) {
    setPrevCollectKey(collectTaskIdsKey);
    setCandidatesOpen(true);
  }

  // 只有"岗位描述为空"的岗位才值得补详情（补详情要逐个打开页面，很慢），按钮据此出现/消失，
  // 而不是常驻一个点了没反应的按钮。当前只统计这一页已加载的岗位：补的就这一页里空的那些。
  const emptyDescriptionJobIds = (jobs?.items ?? [])
    .filter((job) => !job.has_description)
    .map((job) => job.id);

  // 软删可撤销：删除不再前置确认，Toast 里给 5 秒「撤销」（见 useDeleteUndo）。
  const deleteUndo = useDeleteUndo();
  const removeJob = useCallback(
    async (id: number) => {
      try {
        await deleteUndo.run({ type: "job", ids: [id] }, () => deleteJob(id), {
          onRestored: () => void reload(),
        });
        setSelectedJobIds((current) => current.filter((jobId) => jobId !== id));
        void reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "删除失败");
      }
    },
    [deleteUndo, message, reload],
  );

  const toggleFavorite = useCallback(
    async (job: { id: number; favorite: boolean }) => {
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
    [batchAction, favoriteJobId, message, reload, setDetailJob],
  );

  const { addJobToQueue, queueJobId } = useJobQueue();

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

  // 批量动作（改状态 / 删除 / 加入投递队列）在独立 hook 里：页面组合层只负责接线，
  // 勾选与忙态仍由本页持有（BatchToolbar 的按钮据此禁用）。
  const batch = useJobBatchActions({
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
  });

  const applyBatchStatus = batch.applyBatchStatus;

  const removeSelectedJobs = batch.removeSelectedJobs;

  const enqueueSelectedJobs = batch.enqueueSelectedJobs;

  const exitSelectionMode = () => {
    if (batchAction !== null) return;
    setSelectionMode(false);
    setSelectedJobIds([]);
    setBatchStatus(undefined);
  };

  /** 勾选的岗位导出 CSV 由 BatchToolbar 就地处理（纯前端动作）。 */

  const { selectAllPages, selectAllPagesLoading } = useSelectAllJobs({
    keyword,
    jobType,
    status,
    sourceKind,
    sortState,
    setSelectedJobIds,
  });

  /** 右键菜单「批量选择」的动作：进入选择模式（批量操作进行中时不给进）。 */
  const enterSelectionMode = useCallback(() => {
    if (batchAction !== null) return;
    setSelectionMode(true);
  }, [batchAction]);

  const openMatchBatch = (view: "setup" | "history" = "setup") => {
    if (view === "setup") {
      if (!selectionMode) {
        // 「AI 分析适配度」分析的是勾选的岗位：没进选择模式说明用户还没机会勾选——
        // 直接带他进选择模式，而不是丢一句「请先选择岗位」的死路提示。
        setSelectionMode(true);
        message.info("已进入选择模式，勾选岗位后点分析");
        return;
      }
      if (selectedJobIds.length === 0) {
        message.warning("请先选择岗位");
        return;
      }
      if (selectedJobIds.length > 50) {
        message.warning("一次最多分析 50 个岗位");
        return;
      }
    }
    setMatchBatchView(view);
    setMatchBatchOpen(true);
  };

  const rowSelection: TableRowSelection<JobList> = {
    selectedRowKeys: selectedJobIds,
    preserveSelectedRowKeys: true,
    // 选择不设条数上限：批量端点已放宽到 5000，勾选时不再拦（超出由动作时报错兜底）。
    onChange: (keys) => setSelectedJobIds(keys.map(Number)),
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
        openMatchBatch={openMatchBatch}
        emptyDescriptionJobIds={emptyDescriptionJobIds}
        backfilling={backfilling}
        backfillDetails={backfillDetails}
        setCandidatesOpen={setCandidatesOpen}
        setFormOpen={setFormOpen}
        onImportCsv={() => setImportCsvOpen(true)}
        sortState={sortState}
        applySort={applySort}
      />

      <BatchToolbar
        selectionMode={selectionMode}
        selectedJobIds={selectedJobIds}
        setSelectedJobIds={setSelectedJobIds}
        batchAction={batchAction}
        batchStatus={batchStatus}
        setBatchStatus={setBatchStatus}
        applyBatchStatus={applyBatchStatus}
        enqueueSelectedJobs={enqueueSelectedJobs}
        removeSelectedJobs={removeSelectedJobs}
        exitSelectionMode={exitSelectionMode}
        totalCount={jobs?.total ?? 0}
        selectAllPagesLoading={selectAllPagesLoading}
        onSelectAllPages={() => void selectAllPages()}
      />

      {error ? (
        <ErrorState description={error} onRetry={() => void reload()} />
      ) : (
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
          onGenerate={(job) => void getJob(job.id).then(setGenerateJob)}
          onWrite={(job) => void getJob(job.id).then(setManualResumeJob)}
          onViewResumes={(job) => navigate("/resumes?job_id=" + job.id)}
          onEdit={(job) => {
            // 列表项已瘦身（无 JD 全文），编辑前先取全量。
            void getJob(job.id).then((full) => {
              setEditingJob(full);
              setFormOpen(true);
            });
          }}
          onDelete={(job) => void removeJob(job.id)}
          onEnterSelecting={enterSelectionMode}
          sortState={sortState}
          onSortChange={applySort}
          onPageChange={(nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          }}
        />
      )}

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
      <JobImportModal
        open={importCsvOpen}
        onClose={() => setImportCsvOpen(false)}
        onImported={() => void reload()}
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
        jobIds={selectedJobIds}
        initialView={matchBatchView}
        onClose={() => setMatchBatchOpen(false)}
      />
    </div>
  );
}
