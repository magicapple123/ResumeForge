/** 简历中心：生成历史列表、收藏、预览与导出。 */
import { App, Button, Input, Select, Space, Tag } from "antd";
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
import BatchActionBar from "../components/common/BatchActionBar";
import { useBatchSelection } from "../hooks/useBatchSelection";
import ResumeDetailModal from "../components/ResumeDetailModal";
import { computeFieldDiff } from "../utils/resumeFieldDiff";
import type { DiffViewData } from "../types/resumeFieldDiff";
import { useApi } from "../hooks/useApi";
import type { ResumeBrief } from "../types";
import ResumeTable from "./resumes/ResumeTable";
import ResumeRenameModal from "./resumes/ResumeRenameModal";
import ResumeNoteModal from "./resumes/ResumeNoteModal";
import ResumeDiffModal from "./resumes/ResumeDiffModal";

export default function ResumesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message, modal } = App.useApp();
  // 批量选择：勾选若干份简历后一次删除（全部进回收站，可恢复）。
  const batch = useBatchSelection<number>();
  // 筛选 / 分页初值从 URL 读，改动后用 replace 写回（模式同 WebFormPage / JobsPage）。
  const boolParam = (key: string): boolean | undefined => {
    const raw = searchParams.get(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return undefined;
  };
  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  // 搜索框受控镜像（同 JobFilterBar 的处理）：点 × 清空时立即清筛选。
  // Compiler 规范：镜像同步用渲染期守卫式调整。
  const [searchText, setSearchText] = useState(keyword);
  const [prevKeyword, setPrevKeyword] = useState(keyword);
  if (prevKeyword !== keyword) {
    setPrevKeyword(keyword);
    setSearchText(keyword);
  }
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const [pageSize, setPageSize] = useState(Number(searchParams.get("page_size")) || 10);
  const [favoriteFilter, setFavoriteFilter] = useState<boolean | undefined>(() =>
    boolParam("favorite"),
  );
  const [hasJobFilter, setHasJobFilter] = useState<boolean | undefined>(() => boolParam("has_job"));
  const [previewId, setPreviewId] = useState<number | null>(null);
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

  const { data, loading, reload, error } = useApi(
    () =>
      listResumes({
        keyword,
        page,
        page_size: pageSize,
        job_id: jobId,
        favorite: favoriteFilter,
        has_job: hasJobFilter,
      }),
    [keyword, page, pageSize, jobId, favoriteFilter, hasJobFilter],
  );

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  // 筛选 / 分页写回 URL（replace 语义）。effect 只依赖这些状态，不依赖 searchParams，
  // 因此写回不会触发循环重渲染；job_id 参数通过 functional 更新原样保留。
  useEffect(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        const values: [string, string][] = [
          ["keyword", keyword],
          ["favorite", favoriteFilter === undefined ? "" : favoriteFilter ? "1" : "0"],
          ["has_job", hasJobFilter === undefined ? "" : hasJobFilter ? "1" : "0"],
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
  }, [keyword, favoriteFilter, hasJobFilter, page, pageSize, setSearchParams]);

  const remove = useCallback(
    async (id: number) => {
      try {
        await deleteResume(id);
        message.success("已移入回收站，可在「回收站」里恢复");
        void reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "删除失败");
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
        message.error(err instanceof Error ? err.message : "更新收藏状态失败");
      } finally {
        favoriteResumeIdRef.current = null;
        setFavoriteResumeId(null);
      }
    },
    [message, reload],
  );

  /** 批量删除：逐条走同一个软删除接口（全部进回收站），全部完成后一次性刷新。 */
  const removeSelected = useCallback(() => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    modal.confirm({
      title: `删除选中的 ${ids.length} 份简历？`,
      content: "会移入回收站，之后可以在「回收站」里恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(ids.map((id) => deleteResume(id)));
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0) {
          message.success(`已删除 ${ids.length} 份简历，可在「回收站」里恢复`);
        } else {
          message.warning(`已删除 ${ids.length - failed} 份，${failed} 份删除失败，请重试`);
        }
        batch.exitSelecting();
        void reload();
      },
    });
  }, [batch, message, modal, reload]);

  const confirmRename = async () => {
    if (!renameTarget || renaming) return;
    const title = renameValue.trim();
    if (!title) {
      message.warning("简历名称不能为空");
      return;
    }
    setRenaming(true);
    try {
      await renameResume(renameTarget.id, title);
      message.success("已重命名");
      setRenameTarget(null);
      void reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "重命名失败");
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
      message.error(err instanceof Error ? err.message : "版本对比失败");
    } finally {
      setDiffLoading(false);
    }
  };

  const confirmNote = async () => {
    if (!noteTarget || savingNote) return;
    setSavingNote(true);
    try {
      await updateResumeNote(noteTarget.id, noteValue);
      message.success("备注已保存");
      setNoteTarget(null);
      void reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存备注失败");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div>
      {jobId && (
        <Space style={{ marginBottom: 12 }}>
          <Tag color="blue">按岗位筛选：#{jobId}</Tag>
          <Button type="link" size="small" onClick={() => navigate("/resumes")}>
            清除筛选
          </Button>
        </Space>
      )}
      <Input.Search
        placeholder="搜索简历记录"
        allowClear
        style={{ width: 300, marginBottom: 16 }}
        // 受控镜像：URL 恢复的关键词能回填输入框；点 × 清空时立即把筛选也清掉。
        value={searchText}
        onChange={(event) => {
          const value = event.target.value;
          setSearchText(value);
          if (value === "" && keyword !== "") {
            setKeyword("");
            setPage(1);
          }
        }}
        onSearch={(value) => {
          setSearchText(value);
          setKeyword(value);
          setPage(1);
        }}
      />
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="收藏状态"
          style={{ width: 130 }}
          value={favoriteFilter}
          onChange={(value) => {
            setFavoriteFilter(value);
            setPage(1);
          }}
          options={[
            { value: true, label: "已收藏" },
            { value: false, label: "未收藏" },
          ]}
        />
        <Select
          allowClear
          placeholder="岗位关联"
          style={{ width: 140 }}
          value={hasJobFilter}
          onChange={(value) => {
            setHasJobFilter(value);
            setPage(1);
          }}
          options={[
            { value: true, label: "有目标岗位" },
            { value: false, label: "通用简历" },
          ]}
        />
      </Space>
      {batch.selecting && (
        <BatchActionBar count={batch.selectedCount} onExit={batch.exitSelecting}>
          <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
            删除所选
          </Button>
        </BatchActionBar>
      )}
      <ResumeTable
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
        navigate={navigate}
      />
      <ResumeDetailModal recordId={previewId} onClose={() => setPreviewId(null)} />
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
