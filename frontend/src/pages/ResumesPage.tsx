// SPDX-License-Identifier: Apache-2.0
/** 简历中心：生成历史列表、收藏、预览与导出。 */
import { UndoOutlined } from "@ant-design/icons";
import { App, Button, Select, Space, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  deleteResume,
  getResume,
  listResumes,
  renameResume,
  updateResumeFavorite,
  updateResumeNote,
} from "../api/resumes";
import { diffResume } from "../api/resumeWriting";
import ResumeBatchToolbar from "./resumes/ResumeBatchToolbar";
import ErrorState from "../components/common/ErrorState";
import { useBatchSelection } from "../hooks/useBatchSelection";
import ManualResumeModal from "../components/ManualResumeModal";
import ResumeDetailModal from "../components/ResumeDetailModal";
import ResumeCenterAiEntry from "../features/career-scenarios/ResumeCenterAiEntry";
import ResumeScenarioSuggestion from "../features/career-scenarios/ResumeScenarioSuggestion";
import { registerNewResumeHandler } from "../features/shortcuts/runtimeTargets";
import { computeFieldDiff } from "../utils/resumeFieldDiff";
import { useResumeListVersion } from "../features/resume/resumeListEvents";
import type { DiffViewData } from "../types/resumeFieldDiff";
import { useApi } from "../hooks/useApi";
import type { ResumeBrief } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import {
  DEFAULT_RESUME_SORT_STATE,
  isDefaultResumeSort,
  parseResumeSort,
  resumeSortResetHint,
  toResumeSort,
  type ResumeSortState,
} from "../utils/resumeSort";
import ResumeResultList from "./resumes/ResumeResultList";
import DeliveryArchiveModal from "../components/resume/DeliveryArchiveModal";
import ResumeRenameModal from "./resumes/ResumeRenameModal";
import ResumeNoteModal from "./resumes/ResumeNoteModal";
import ResumeDiffModal from "./resumes/ResumeDiffModal";
import JobFilterSelect from "./resumes/JobFilterSelect";
import ResumeSearchInput from "./resumes/ResumeSearchInput";
import { useSelectAllResumes } from "./resumes/useSelectAllResumes";
import { useResumeBatchActions } from "./resumes/useResumeBatchActions";
import { buildResumeBatchRowActions } from "./resumes/resumeBatchActions";
import { useBatchOperationGuard } from "../features/settings/useBatchOperationConfig";

export default function ResumesPage() {
  useLocale();
  const navigate = useNavigate();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { message } = App.useApp();
  // 批量选择：勾选若干份简历后一次删除（全部进回收站，可恢复）。
  const batch = useBatchSelection<number>();
  // 批量导出前必须先有「设置 → 批量操作」保存过的一套参数（版式 + 导出格式）。
  const batchOp = useBatchOperationGuard("export");
  // 筛选 / 分页初值从 URL 读，改动后用 replace 写回（模式同 WebFormPage / JobsPage）。
  const boolParam = (key: string): boolean | undefined => {
    const raw = searchParams.get(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return undefined;
  };
  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const [pageSize, setPageSize] = useState(Number(searchParams.get("page_size")) || 10);
  const [hasJobFilter, setHasJobFilter] = useState<boolean | undefined>(() => boolParam("has_job"));
  // 新建手写简历（R8）：以前只能从岗位页或「我的资料」进，简历中心自己没有入口。
  const [manualOpen, setManualOpen] = useState(false);
  /**
   * 排序（T2）：列头三态 + 「恢复默认排序」。初值从 URL 读一次（深链/刷新保持），
   * 之后 URL 只是**输出**——每次排序都回读 URL 会让状态有两个真相。
   * 非法值（含旧下拉框留下的 company_asc）由 parseResumeSort 回落到默认。
   */
  const [sortState, setSortState] = useState<ResumeSortState>(() =>
    parseResumeSort(searchParams.get("sort")),
  );
  /** 排序变化：回到第 1 页（不然会停在一个"新排序下不存在的页"上）。 */
  const applySort = useCallback((next: ResumeSortState) => {
    setSortState(next);
    setPage(1);
  }, []);

  // 深链 ?resume_id=（RF-11 搜索直开）：挂载时读一次，数字有效才打开详情；
  // 关闭详情时把参数从 URL 移除（replace，不打历史）。镜像 JobsPage 的 job_id 模式。
  const [previewId, setPreviewId] = useState<number | null>(() => {
    const raw = searchParams.get("resume_id");
    return raw && /^\d+$/.test(raw) ? Number(raw) : null;
  });
  // 新建 → 前往制作台：只作用于**这一次**打开（关掉详情就复位，见 onClose）。
  const [autoWorkbench, setAutoWorkbench] = useState(false);
  const [favoriteResumeId, setFavoriteResumeId] = useState<number | null>(null);
  const favoriteResumeIdRef = useRef<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<ResumeBrief | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [noteTarget, setNoteTarget] = useState<ResumeBrief | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [diffBase, setDiffBase] = useState<ResumeBrief | null>(null);
  const [diffAgainstId, setDiffAgainstId] = useState<number | null>(null);
  const [diffResult, setDiffResult] = useState<DiffViewData | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const jobIdParam = searchParams.get("job_id");
  const jobId = jobIdParam && /^\d+$/.test(jobIdParam) ? Number(jobIdParam) : undefined;
  // 岗位名由 JobFilterSelect 回传（它负责远程搜索与深链回查），Tag 与下拉共用同一份名称，
  // 避免两处各自解析出现"标签是 #3、下拉是岗位名"。
  const [jobLabel, setJobLabel] = useState("");

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

  // T12：手写简历保存成功后广播版本号，放进 useApi 依赖里让列表自动重取。
  const resumeListVersion = useResumeListVersion();
  const { data, loading, reload, error } = useApi(
    () =>
      listResumes({
        keyword,
        page,
        page_size: pageSize,
        job_id: jobId,
        has_job: hasJobFilter,
        sort: toResumeSort(sortState),
      }),
    [keyword, page, pageSize, jobId, hasJobFilter, sortState, resumeListVersion],
  );

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  // 跨页全选（对齐岗位广场）：按当前筛选拉全部 id，批量删除仍受后端 5000 上限裁决。
  // R8：把「新建简历」与「翻页」登记给快捷键系统（离开页面即注销）。
  useEffect(() => {
    registerNewResumeHandler(() => setManualOpen(true));
    return () => registerNewResumeHandler(null);
  }, []);

  const { selectAllPages, selectAllPagesLoading } = useSelectAllResumes({
    keyword,
    jobId,
    hasJobFilter,
    setSelectedIds: batch.setSelected,
  });

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
          ["page_size", pageSize !== 10 ? String(pageSize) : ""],
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

  const remove = useCallback(
    async (id: number) => {
      try {
        await deleteResume(id);
        message.success(t("resumesPage.toast.movedToTrash"));
        void reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : t("resumesPage.error.deleteFailed"));
      }
    },
    [message, reload],
  );

  const toggleFavorite = useCallback(
    async (record: ResumeBrief) => {
      if (favoriteResumeIdRef.current !== null) return;
      favoriteResumeIdRef.current = record.id;
      setFavoriteResumeId(record.id);
      try {
        await updateResumeFavorite(record.id, !record.favorite);
        await reload();
      } catch (err) {
        message.error(
          err instanceof Error ? err.message : t("resumesPage.error.favoriteUpdateFailed"),
        );
      } finally {
        favoriteResumeIdRef.current = null;
        setFavoriteResumeId(null);
      }
    },
    [message, reload],
  );

  const { exporting, handleBatchAction } = useResumeBatchActions({
    selectedIds: batch.selectedIds,
    exitSelecting: batch.exitSelecting,
    onDeleted: () => void reload(),
    ensureBatchConfig: batchOp.ensure,
  });
  const batchRowActions = buildResumeBatchRowActions(
    handleBatchAction,
    batch.selectedCount === 0 || exporting,
  );

  const confirmRename = async () => {
    if (!renameTarget || renaming) return;
    const title = renameValue.trim();
    if (!title) {
      message.warning(t("resumesPage.rename.required"));
      return;
    }
    setRenaming(true);
    try {
      await renameResume(renameTarget.id, title);
      message.success(t("resumesPage.rename.done"));
      setRenameTarget(null);
      void reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("resumesPage.rename.failed"));
    } finally {
      setRenaming(false);
    }
  };

  const selectDiffAgainst = async (againstId: number) => {
    setDiffAgainstId(againstId);
    if (!diffBase) return;
    setDiffLoading(true);
    try {
      // 同时取两份完整 content 在前端做字段级对比；后端源码 diff 仍保留，用于统计与「查看原始差异」兜底。
      const [base, against, raw] = await Promise.all([
        getResume(diffBase.id),
        getResume(againstId),
        diffResume(diffBase.id, againstId),
      ]);
      const field = computeFieldDiff(base.content, against.content, base.title, against.title);
      setDiffResult({ raw, field });
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("resumesPage.diff.failed"));
    } finally {
      setDiffLoading(false);
    }
  };

  const confirmNote = async () => {
    if (!noteTarget || savingNote) return;
    setSavingNote(true);
    try {
      await updateResumeNote(noteTarget.id, noteValue);
      message.success(t("resumesPage.note.saved"));
      setNoteTarget(null);
      void reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("resumesPage.note.saveFailed"));
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div>
      {archiveOpen && (
        <DeliveryArchiveModal
          onClose={() => setArchiveOpen(false)}
          // 深链 ?resume_id= / 刚打开的详情：直接展示这份简历的交付原件。
          resumeId={previewId}
          // 全局入口没有"当前简历"上下文：把当前页列表交给弹层，用户可在这里选任意
          // 一份简历查看/删除归档的原件（W19 真实入口，不再只靠测试传 resumeId）。
          resumeOptions={(data?.items ?? []).map((item) => ({
            value: item.id,
            label: item.title,
          }))}
        />
      )}
      <ManualResumeModal
        job={null}
        open={manualOpen}
        // T12：保存成功后 `resumeListEvents` 广播会让下面 useApi 重取；
        // 关闭弹窗（含取消）不再无条件 reload——那是白跑一次请求。
        onClose={() => setManualOpen(false)}
        // 「前往简历制作台」：先建一份空白简历，再直接把详情弹窗打开到制作台那一屏。
        // 没有这一步的话，用户建完还要经过"打开列表项 → 点放大 → 进制作台"三次点击。
        onOpenWorkbench={(resumeId) => {
          setManualOpen(false);
          setAutoWorkbench(true);
          setPreviewId(resumeId);
        }}
      />
      {/* 筛选栏整体收进一个 Space（gap 12px，wrap 换行时同样吃 gap）：
          之前「交付存档」按钮、搜索框、两个筛选 Select 各写各的 marginBottom，
          行内元素水平方向零间距——按钮和搜索框几乎贴死，视觉节奏也不一致。 */}
      <Space wrap size={16} align="center" className="rf-filter-bar">
        <Button type="primary" onClick={() => setManualOpen(true)}>
          {t("resumesPage.page.newResume")}
        </Button>
        <ResumeCenterAiEntry />
        <Button onClick={() => setArchiveOpen(true)}>
          {t("resumesPage.page.deliveryArchive")}
        </Button>
        {jobId && (
          <Space size={4} align="center">
            <Tag color="blue">
              {t("resumesPage.page.jobFilterTag", { job: jobLabel || `#${jobId}` })}
            </Tag>
            <Button type="link" size="small" onClick={() => applyJobFilter(undefined)}>
              {t("resumesPage.page.clearFilter")}
            </Button>
          </Space>
        )}
        <JobFilterSelect value={jobId} onChange={applyJobFilter} onLabelChange={setJobLabel} />
        <ResumeSearchInput keyword={keyword} onCommit={applyKeyword} />
        <Select
          allowClear
          placeholder={t("resumesPage.filter.jobRelation")}
          aria-label={t("resumesPage.filter.jobRelationAria")}
          style={{ width: 140 }}
          value={hasJobFilter}
          onChange={(value) => {
            setHasJobFilter(value);
            setPage(1);
          }}
          options={[
            { value: true, label: t("resumesPage.filter.hasJob") },
            { value: false, label: t("resumesPage.filter.general") },
          ]}
        />
        {/* T2：排序改到列头（三态），这里只留「恢复默认排序」——默认态禁用，
            文案说清"点了会发生什么"，与岗位广场同一套交互。 */}
        <Tooltip title={resumeSortResetHint(sortState)}>
          <Button
            icon={<UndoOutlined />}
            aria-label={t("resumesPage.sort.reset")}
            disabled={isDefaultResumeSort(sortState)}
            onClick={() => applySort(DEFAULT_RESUME_SORT_STATE)}
          >
            {t("resumesPage.sort.reset")}
          </Button>
        </Tooltip>
      </Space>
      {/* A2 场景建议卡：只提供入口，不调用模型、不按场景过滤任何已有简历。 */}
      <ResumeScenarioSuggestion />
      {batch.selecting && (
        <ResumeBatchToolbar
          count={batch.selectedCount}
          total={data?.total ?? 0}
          selectAllLoading={selectAllPagesLoading}
          exporting={exporting}
          onSelectAll={() => void selectAllPages()}
          onAction={handleBatchAction}
          onExit={batch.exitSelecting}
        />
      )}
      {error ? (
        <ErrorState description={error} onRetry={() => void reload()} />
      ) : (
        <ResumeResultList
          data={data}
          loading={loading}
          batch={batch}
          favoriteResumeId={favoriteResumeId}
          page={page}
          setPage={setPage}
          pageSize={pageSize}
          setPageSize={setPageSize}
          toggleFavorite={toggleFavorite}
          remove={remove}
          setPreviewId={setPreviewId}
          setRenameTarget={setRenameTarget}
          setRenameValue={setRenameValue}
          setNoteTarget={setNoteTarget}
          setNoteValue={setNoteValue}
          setDiffBase={setDiffBase}
          setDiffAgainstId={setDiffAgainstId}
          setDiffResult={setDiffResult}
          sortState={sortState}
          onSortChange={applySort}
          navigate={navigate}
          batchActions={batchRowActions}
        />
      )}
      <ResumeDetailModal
        recordId={previewId}
        // 只在"新建 → 前往制作台"那一次为 true；关掉详情就复位，下次从列表点开
        // 仍然停在预览（用户要看的是这一份长什么样）。
        autoOpenWorkbench={autoWorkbench}
        onClose={() => {
          setPreviewId(null);
          setAutoWorkbench(false);
          // 深链参数随关闭一起清掉（replace，不打历史）；列表页点击打开的不带参数，
          // 删除一个不存在的键是无操作。
          setSearchParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.delete("resume_id");
              return next;
            },
            { replace: true },
          );
        }}
      />
      <ResumeRenameModal
        open={renameTarget !== null}
        value={renameValue}
        confirmLoading={renaming}
        onChange={setRenameValue}
        onCancel={() => {
          if (!renaming) setRenameTarget(null);
        }}
        onOk={() => void confirmRename()}
      />
      <ResumeNoteModal
        open={noteTarget !== null}
        value={noteValue}
        confirmLoading={savingNote}
        onChange={setNoteValue}
        onCancel={() => {
          if (!savingNote) setNoteTarget(null);
        }}
        onOk={() => void confirmNote()}
      />
      <ResumeDiffModal
        diffBase={diffBase}
        diffAgainstId={diffAgainstId}
        diffResult={diffResult}
        diffLoading={diffLoading}
        items={data?.items ?? []}
        onSelect={(value) => void selectDiffAgainst(value)}
        onClose={() => {
          if (!diffLoading) setDiffBase(null);
        }}
      />
    </div>
  );
}
