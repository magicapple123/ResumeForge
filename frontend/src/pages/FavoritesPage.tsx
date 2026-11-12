// SPDX-License-Identifier: Apache-2.0
/** 收藏夹：集中查看收藏的岗位与简历（#28 收藏夹改造成待投清单）。 */
import { FileTextOutlined, SearchOutlined, StarFilled } from "@ant-design/icons";
import { App, Button, Space, Table, Tabs, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { HTMLAttributes } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { addToQueue } from "../api/apply";
import {
  batchFavoriteJobs,
  downloadFavoritesExport,
  listFavoriteJobs,
  updateJob,
} from "../api/jobs";
import { listResumes, updateResumeFavorite } from "../api/resumes";
import { RowActions, RowContextMenu, type RowActionItem } from "../components/common/RowActions";
import EmptyState from "../components/common/EmptyState";
import ErrorState from "../components/common/ErrorState";
import FavoriteJobsTable from "../features/favorites/FavoriteJobsTable";
import FavoritesBatchBar from "../features/favorites/FavoritesBatchBar";
import FavoritesToolbar, { type StatusFilter } from "../features/favorites/FavoritesToolbar";
import ResumeDetailModal from "../features/resume/list/ResumeDetailModal";
import { useApi } from "../hooks/useApi";
import {
  JOB_STATUS_CLOSED,
  JOB_STATUS_OPEN,
  type FavoriteJob,
  type FavoriteSort,
  type JobList,
  type Page,
  type ResumeBrief,
} from "../types";
import { formatDateTime } from "../utils/format";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

type FavoriteKind = "jobs" | "resumes";
type FavoritePage =
  { kind: "jobs"; page: Page<FavoriteJob> } | { kind: "resumes"; page: Page<ResumeBrief> };

export default function FavoritesPage() {
  useLocale();
  const navigate = useNavigate();
  const { message } = App.useApp();
  // 页签 / 分页从 URL 读初值、改动后 replace 写回（模式同 WebFormPage / JobsPage）。
  const [searchParams, setSearchParams] = useSearchParams();
  const [kind, setKind] = useState<FavoriteKind>(
    searchParams.get("kind") === "resumes" ? "resumes" : "jobs",
  );
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const [pageSize, setPageSize] = useState(Number(searchParams.get("page_size")) || 10);
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<FavoriteSort>("favorited_desc");
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [updatingKey, setUpdatingKey] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const updatingKeyRef = useRef("");
  const busyKeyRef = useRef("");

  const { data, loading, error, reload } = useApi<FavoritePage>(async () => {
    if (kind === "jobs") {
      const applied =
        statusFilter === "applied" ? true : statusFilter === "unapplied" ? false : undefined;
      const status =
        statusFilter === "open"
          ? JOB_STATUS_OPEN
          : statusFilter === "closed"
            ? JOB_STATUS_CLOSED
            : undefined;
      return {
        kind,
        page: await listFavoriteJobs({
          keyword: keyword || undefined,
          status,
          applied,
          sort,
          page,
          page_size: pageSize,
        }),
      };
    }
    return { kind, page: await listResumes({ favorite: true, page, page_size: pageSize }) };
  }, [kind, page, pageSize, keyword, statusFilter, sort]);

  useEffect(() => {
    if (error) message.error(error);
  }, [error, message]);

  // 页签 / 分页写回 URL（replace 语义）；effect 不依赖 searchParams，不会循环重渲染。
  useEffect(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (kind !== "jobs") next.set("kind", kind);
        else next.delete("kind");
        if (page > 1) next.set("page", String(page));
        else next.delete("page");
        if (pageSize !== 10) next.set("page_size", String(pageSize));
        else next.delete("page_size");
        return next;
      },
      { replace: true },
    );
  }, [kind, page, pageSize, setSearchParams]);

  const removeJobFavorite = useCallback(
    async (job: JobList | FavoriteJob) => {
      const key = String(job.id);
      if (updatingKeyRef.current) return;
      updatingKeyRef.current = key;
      setUpdatingKey(key);
      try {
        await updateJob(job.id, { favorite: false });
        await reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : t("favorites.error.unfavoriteFailed"));
      } finally {
        updatingKeyRef.current = "";
        setUpdatingKey("");
      }
    },
    [message, reload],
  );

  const removeResumeFavorite = useCallback(
    async (resume: ResumeBrief) => {
      const key = String(resume.id);
      if (updatingKeyRef.current) return;
      updatingKeyRef.current = key;
      setUpdatingKey(key);
      try {
        await updateResumeFavorite(resume.id, false);
        await reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : t("favorites.error.unfavoriteFailed"));
      } finally {
        updatingKeyRef.current = "";
        setUpdatingKey("");
      }
    },
    [message, reload],
  );

  /** #28D 行内编辑备注：成功后刷新（保留当前筛选），失败提示且不改本地数据。 */
  const saveJobNote = useCallback(
    async (job: FavoriteJob, note: string) => {
      try {
        await updateJob(job.id, { note });
        message.success(t("favorites.message.noteSaved"));
        await reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : t("favorites.error.noteSaveFailed"));
      }
    },
    [message, reload],
  );

  /** #28C 行内入队；批量时复用同一个接口（逐个入队，单条失败不影响其余）。 */
  const enqueueJobs = useCallback(
    async (jobs: FavoriteJob[]) => {
      if (busyKeyRef.current || jobs.length === 0) return;
      busyKeyRef.current = "queue";
      setBusyKey("queue");
      try {
        for (const job of jobs) {
          await addToQueue([{ job_id: job.id }]);
        }
        message.success(t("favorites.message.enqueued", { count: jobs.length }));
        setSelectedKeys([]);
        await reload();
      } catch (err) {
        message.error(err instanceof Error ? err.message : t("favorites.error.enqueueFailed"));
      } finally {
        busyKeyRef.current = "";
        setBusyKey("");
      }
    },
    [message, reload],
  );

  const applyNow = useCallback(
    async (job: FavoriteJob) => {
      await enqueueJobs([job]);
      // 立即投递 = 先入队再跳到投递台（体检与执行都在那边，不在收藏夹里另写一条链路）。
      navigate("/apply");
    },
    [enqueueJobs, navigate],
  );

  const batchUnfavorite = useCallback(async () => {
    if (selectedKeys.length === 0) return;
    try {
      const result = await batchFavoriteJobs(selectedKeys, false);
      message.success(t("favorites.message.batchUnfavorited", { count: result.updated }));
      setSelectedKeys([]);
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("favorites.error.unfavoriteFailed"));
    }
  }, [message, reload, selectedKeys]);

  const exportFavorites = useCallback(
    async (format: "csv" | "md") => {
      try {
        const applied =
          statusFilter === "applied" ? true : statusFilter === "unapplied" ? false : undefined;
        const status =
          statusFilter === "open"
            ? JOB_STATUS_OPEN
            : statusFilter === "closed"
              ? JOB_STATUS_CLOSED
              : undefined;
        await downloadFavoritesExport(format, {
          keyword: keyword || undefined,
          status,
          applied,
          sort,
        });
        message.success(t("favorites.message.exported"));
      } catch (err) {
        message.error(err instanceof Error ? err.message : t("favorites.error.exportFailed"));
      }
    },
    [keyword, message, sort, statusFilter],
  );

  const favoriteButton = (key: string, onClick: () => void) => (
    <Tooltip title={t("favorites.action.unfavorite")}>
      <Button
        type="text"
        aria-label={t("favorites.action.unfavorite")}
        loading={updatingKey === key}
        disabled={Boolean(updatingKey)}
        icon={<StarFilled style={{ color: "var(--rf-favorite)" }} />}
        onClick={onClick}
      />
    </Tooltip>
  );

  const secondaryActions = (item: JobList | ResumeBrief): RowActionItem[] =>
    kind === "jobs"
      ? [
          {
            key: "open",
            label: t("favorites.action.openJob"),
            onClick: () => navigate("/jobs?job_id=" + item.id),
          },
        ]
      : [
          {
            key: "preview",
            label: t("favorites.action.previewExport"),
            onClick: () => setPreviewId(item.id),
          },
        ];

  const contextActions = (item: JobList | ResumeBrief): RowActionItem[] => [
    ...secondaryActions(item),
    {
      key: "unfavorite",
      label: t("favorites.action.unfavorite"),
      onClick: () =>
        kind === "jobs"
          ? void removeJobFavorite(item as JobList)
          : void removeResumeFavorite(item as ResumeBrief),
    },
  ];

  const resumeColumns: TableColumnsType<ResumeBrief> = [
    {
      title: t("favorites.column.resume"),
      dataIndex: "title",
      render: (_, resume) => (
        <Button type="link" className="table-text-link" onClick={() => setPreviewId(resume.id)}>
          {resume.title}
        </Button>
      ),
    },
    {
      title: t("favorites.column.targetJob"),
      width: 220,
      render: (_, resume) => (
        <Space size={4}>
          <Tag color="blue">{resume.job_title || "-"}</Tag>
          {resume.company && <Tag>{resume.company}</Tag>}
        </Space>
      ),
    },
    {
      title: t("favorites.column.source"),
      dataIndex: "source",
      width: 110,
      render: (value: ResumeBrief["source"]) =>
        value === "manual" ? t("favorites.source.manual") : t("favorites.source.ai"),
    },
    {
      title: t("favorites.column.createdAt"),
      dataIndex: "created_at",
      width: 160,
      render: (value) => formatDateTime(value),
    },
    {
      title: t("favorites.column.actions"),
      width: 130,
      align: "center",
      render: (_, resume) => {
        // key 前缀在 JSX 之外拼好：它是内部标识，不是界面文案（也不该进文案扫描语境）。
        const resumeKey = String(resume.id);
        return (
          <Space size={4}>
            {favoriteButton(resumeKey, () => void removeResumeFavorite(resume))}
            <RowActions more={secondaryActions(resume)} />
          </Space>
        );
      },
    },
  ];

  const jobPage = data?.kind === "jobs" ? data.page : undefined;
  const resumePage = data?.kind === "resumes" ? data.page : undefined;
  const currentPage = jobPage ?? resumePage;
  const items = currentPage?.items ?? [];
  const jobItems = jobPage?.items ?? [];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          {t("favorites.page.title")}
        </Typography.Title>
        <Typography.Text type="secondary">{t("favorites.page.subtitle")}</Typography.Text>
      </div>
      <Tabs
        activeKey={kind}
        onChange={(value) => {
          setKind(value as FavoriteKind);
          setPage(1);
          setSelectedKeys([]);
        }}
        items={[
          {
            key: "jobs",
            label: (
              <Space size={6}>
                <SearchOutlined />
                {t("favorites.tab.jobs")}
              </Space>
            ),
          },
          {
            key: "resumes",
            label: (
              <Space size={6}>
                <FileTextOutlined />
                {t("favorites.tab.resumes")}
              </Space>
            ),
          },
        ]}
      />
      {kind === "jobs" && (
        <>
          <FavoritesToolbar
            keywordInput={keywordInput}
            statusFilter={statusFilter}
            sort={sort}
            onKeywordInputChange={setKeywordInput}
            onSearch={(value) => {
              setKeyword(value.trim());
              setPage(1);
            }}
            onStatusChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            onSortChange={(value) => {
              setSort(value);
              setPage(1);
            }}
            onExport={(format) => void exportFavorites(format)}
          />
          <FavoritesBatchBar
            count={selectedKeys.length}
            onUnfavorite={() => void batchUnfavorite()}
            onEnqueue={() =>
              void enqueueJobs(jobItems.filter((job) => selectedKeys.includes(job.id)))
            }
          />
        </>
      )}
      {error ? (
        <ErrorState description={error} onRetry={() => void reload()} />
      ) : kind === "jobs" ? (
        <FavoriteJobsTable
          page={jobPage}
          loading={loading}
          busyKey={busyKey || updatingKey}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys as number[]),
          }}
          pagination={{
            current: page,
            pageSize,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
          emptyText={<EmptyState description={t("favorites.empty.jobs")} />}
          onOpenJob={(job) => navigate("/jobs?job_id=" + job.id)}
          onUnfavorite={(job) => void removeJobFavorite(job)}
          onEnqueue={(job) => void enqueueJobs([job])}
          onApplyNow={(job) => void applyNow(job)}
          onSaveNote={(job, note) => void saveJobNote(job, note)}
        />
      ) : (
        <Table<ResumeBrief>
          rowKey="id"
          columns={resumeColumns}
          dataSource={items as ResumeBrief[]}
          loading={loading}
          locale={{ emptyText: <EmptyState description={t("favorites.empty.resumes")} /> }}
          components={{
            body: {
              row: (props: HTMLAttributes<HTMLTableRowElement>) => {
                const rowKey = String((props as { "data-row-key"?: string })["data-row-key"] ?? "");
                const item = (items as ResumeBrief[]).find((entry) => String(entry.id) === rowKey);
                if (!item) return <tr {...props} />;
                return (
                  <RowContextMenu items={contextActions(item)}>
                    <tr {...props} />
                  </RowContextMenu>
                );
              },
            },
          }}
          pagination={{
            current: page,
            pageSize,
            total: currentPage?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => t("favorites.pagination.total", { total }),
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            },
          }}
        />
      )}
      <ResumeDetailModal recordId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}
