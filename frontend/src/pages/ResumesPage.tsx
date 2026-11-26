// SPDX-License-Identifier: Apache-2.0
/** 简历中心：生成历史列表、收藏、预览与导出。 */
import { Alert, App } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  deleteResume,
  getResume,
  renameResume,
  updateResumeFavorite,
  updateResumeNote,
} from "../api/resumes";
import { diffResume } from "../api/resumeWriting";
import ResumeBatchToolbar from "./resumes/ResumeBatchToolbar";
import ErrorState from "../components/common/ErrorState";
import { useBatchSelection } from "../hooks/useBatchSelection";
import ManualResumeModal from "../features/resume/list/ManualResumeModal";
import ResumeDetailModal from "../features/resume/list/ResumeDetailModal";
import { registerNewResumeHandler } from "../features/shortcuts/runtimeTargets";
import { computeFieldDiff } from "../utils/resumeFieldDiff";
import type { DiffViewData } from "../types/resumeFieldDiff";
import type { ResumeBrief } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import ResumeResultList from "./resumes/ResumeResultList";
import {
  readExpandedGroupKeys,
  writeExpandedGroupKeys,
} from "../features/resume/list/expandedGroups";
import DeliveryArchiveModal from "../features/resume/delivery/DeliveryArchiveModal";
import ResumeRenameModal from "./resumes/ResumeRenameModal";
import ResumeNoteModal from "./resumes/ResumeNoteModal";
import ResumeDiffModal from "./resumes/ResumeDiffModal";
import { useSelectAllResumes } from "./resumes/useSelectAllResumes";
import { useResumeBatchActions } from "./resumes/useResumeBatchActions";
import { buildResumeBatchRowActions } from "./resumes/resumeBatchActions";
import BatchConfigModal from "../features/batch/BatchConfigModal";
import ResumeFilterBar from "./resumes/ResumeFilterBar";
import { useResumesPageView } from "./resumes/useResumesPageView";

export default function ResumesPage() {
  useLocale();
  const navigate = useNavigate();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const { message } = App.useApp();
  // 批量选择：勾选若干份简历后一次删除（全部进回收站，可恢复）。
  const batch = useBatchSelection<number>();
  /**
   * 筛选 / 分页 / 排序 / 折叠切片都在 `useResumesPageView` 里（页面本体守住 500 行预算）。
   * 两套排序状态并存的口径见该文件头：`sortState` 给服务端（平铺表列头），
   * `groupSortState` 给折叠视图的本地组级排序。
   */
  const view = useResumesPageView();
  const {
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
    reload,
    error,
    setPage,
    setPageSize,
    applyKeyword,
    applyJobFilter,
    applyHasJobFilter,
    applySort,
    applyGroupSort,
    resetSort,
  } = view;
  // 新建手写简历（R8）：以前只能从岗位页或「我的资料」进，简历中心自己没有入口。
  const [manualOpen, setManualOpen] = useState(false);

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
  // 岗位名由 JobFilterSelect 回传（它负责远程搜索与深链回查），Tag 与下拉共用同一份名称，
  // 避免两处各自解析出现"标签是 #3、下拉是岗位名"。
  const [jobLabel, setJobLabel] = useState("");

  /**
   * 展开的组持久化：沿用 `resumeforge.*.v1` 惯例，坏 JSON 由 expandedGroups 容错成
   * 「全部折叠」，不会让列表打不开。
   */
  const [expandedKeys, setExpandedKeysState] = useState<string[]>(() => readExpandedGroupKeys());
  const setExpandedKeys = useCallback((keys: string[]) => {
    setExpandedKeysState(keys);
    writeExpandedGroupKeys(keys);
  }, []);

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

  const batchActions = useResumeBatchActions({
    selectedIds: batch.selectedIds,
    exitSelecting: batch.exitSelecting,
    onDeleted: () => void reload(),
  });
  const batchRowActions = buildResumeBatchRowActions(
    batchActions.handleBatchAction,
    batch.selectedCount === 0 || batchActions.exporting,
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
          resumeOptions={loadedItems.map((item) => ({
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
      <ResumeFilterBar
        keyword={keyword}
        jobId={jobId}
        jobLabel={jobLabel}
        hasJobFilter={hasJobFilter}
        // 「恢复默认排序」只看"当前屏幕上那套排序"是否离开默认：折叠视图归组级排序，
        // 平铺视图归服务端排序。谁在屏幕上就复位谁（见 useResumesPageView 的 sortChanged）。
        sortChanged={sortChanged}
        onNewResume={() => setManualOpen(true)}
        onOpenArchive={() => setArchiveOpen(true)}
        onJobFilterChange={applyJobFilter}
        onJobLabelChange={setJobLabel}
        onKeywordCommit={applyKeyword}
        onHasJobFilterChange={applyHasJobFilter}
        onSortReset={resetSort}
      />
      {batch.selecting && (
        <ResumeBatchToolbar
          count={batch.selectedCount}
          total={totalGroups}
          selectAllLoading={selectAllPagesLoading}
          exporting={batchActions.exporting}
          onSelectAll={() => {
            // CR-33：折叠视图里的「全选所有简历」会选中看不见的版本，且它是唯一一个
            // 可能被误解为"对整组操作"的入口——明确拒绝，并告诉用户怎么继续。
            // 平铺视图（没有可折叠的多版本）保持原行为。
            if (!folded) {
              void selectAllPages();
              return;
            }
            message.info(t("resumes.list.selectAllFolded"));
          }}
          onAction={batchActions.handleBatchAction}
          onExit={batch.exitSelecting}
        />
      )}
      {/* 导出的「本次参数」弹窗：不随多选态卸载，确认后请求仍在跑时也能正常收起。 */}
      <BatchConfigModal mode="export" {...batchActions.configModal} />
      {error ? (
        <ErrorState description={error} onRetry={() => void reload()} />
      ) : (
        <ResumeResultList
          data={{ items: flatPageItems, total: loadedItems.length }}
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
          groups={pageGroups}
          totalGroups={totalGroups}
          resumeCount={loadedItems.length}
          groupSortState={groupSortState}
          onGroupSortChange={applyGroupSort}
          expandedKeys={expandedKeys}
          setExpandedKeys={setExpandedKeys}
        />
      )}
      {grouped?.truncated && (
        <Alert
          className="resume-group-capped"
          type="info"
          showIcon
          title={t("resumes.list.capped")}
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
        items={loadedItems}
        onSelect={(value) => void selectDiffAgainst(value)}
        onClose={() => {
          if (!diffLoading) setDiffBase(null);
        }}
      />
    </div>
  );
}
