// SPDX-License-Identifier: Apache-2.0
/** 收藏夹：集中查看收藏的岗位与简历（#28 收藏夹改造成待投清单）。 */
import { FileTextOutlined, SearchOutlined } from "@ant-design/icons";
import { App, Space, Tabs, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { addToQueue } from "../api/apply";
import { listFavoriteResumes, type FavoriteResumeItem } from "../api/favorites";
import {
  batchFavoriteJobs,
  downloadFavoritesExport,
  listFavoriteJobs,
  updateJob,
} from "../api/jobs";
import { setExternalResumeFavorite } from "../api/externalResumes";
import { updateResumeFavorite } from "../api/resumes";
import EmptyState, { EmptyWatermark } from "../components/common/EmptyState";
import ErrorState from "../components/common/ErrorState";
import FavoriteJobsTable from "../features/favorites/FavoriteJobsTable";
import FavoriteResumeTable from "../features/favorites/FavoriteResumeTable";
import FavoritesBatchBar from "../features/favorites/FavoritesBatchBar";
import FavoritesToolbar, { type StatusFilter } from "../features/favorites/FavoritesToolbar";
import ExternalResumeDetailDrawer from "../features/resume/list/ExternalResumeDetailDrawer";
import ResumeDetailModal from "../features/resume/list/ResumeDetailModal";
import { useApi } from "../hooks/useApi";
import {
  JOB_STATUS_CLOSED,
  JOB_STATUS_OPEN,
  type FavoriteJob,
  type FavoriteSort,
  type JobList,
  type Page,
} from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

type FavoriteKind = "jobs" | "resumes";
type FavoritePage =
  { kind: "jobs"; page: Page<FavoriteJob> } | { kind: "resumes"; page: Page<FavoriteResumeItem> };

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
  // 内部简历详情（标题弹层）与外部简历详情（原件/历史版本弹层）各自一个 id：
  // 两种 kind 的 id 会撞号，合成一个 id 状态会让"点外部那行"打开内部同号的详情。
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [externalDetailId, setExternalDetailId] = useState<number | null>(null);
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
    // T31：简历页签走 `GET /api/favorites`——它一次返回**内部 + 外部**两种 kind
    // （合并后按收藏时间倒序分页）。原先的 `listResumes({favorite:true})` 只认识
    // 内部简历，外部简历收藏后在这里看不到。
    return { kind, page: await listFavoriteResumes({ page, page_size: pageSize }) };
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

  /**
   * 取消简历收藏：按行的 `kind` 分派到各自端点。
   *
   * 两条写入口都不在收藏页里"顺手刷新 updated_at"——内部走 T15、外部走 T28，最终都落到
   * `services/favorites.update_favorite`（Core UPDATE + 抑制 `onupdate`）。收藏页只负责
   * 调对那一个端点，取消成功后重新拉列表，这一行因此立刻消失（服务端口径是 `favorite=1`）。
   */
  const removeResumeFavorite = useCallback(
    async (item: FavoriteResumeItem) => {
      const key = item.ref || `${item.kind}:${item.id}`;
      if (updatingKeyRef.current) return;
      updatingKeyRef.current = key;
      setUpdatingKey(key);
      try {
        if (item.kind === "external") await setExternalResumeFavorite(item.id, false);
        else await updateResumeFavorite(item.id, false);
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

  /** 点行 → 打开**对应那张表**的详情；两条路径不共用 id 状态（会撞号）。 */
  const openResumeDetail = useCallback((item: FavoriteResumeItem) => {
    if (item.kind === "external") {
      setExternalDetailId(item.id);
      return;
    }
    setPreviewId(item.id);
  }, []);

  /**
   * 「在简历中心打开」：跳该 kind 的既有深链，**不新造路由**。
   *
   * - 内部：`/resumes?resume_id=<id>`（`ResumesPage` 挂载即读它并打开详情，RF-11）；
   * - 外部：`/resumes/external?resume=<id>`——与 T13「提醒 → 关联简历」同一个路径
   *   （`features/tracker/reminderResumeLink.ts`）。该参数目前**还没有人消费**（外部页
   *   只读 `job_id` / `keyword` / `sort`），所以这一跳至少落在外部简历列表上；
   *   要让详情自动展开，得由 `ExternalResumePanel` 补读 `?resume=`（B 的文件）。
   *   收藏页自身的"点进去看详情"因此走就地弹层，两条路互不依赖。
   */
  const openResumeInHub = useCallback(
    (item: FavoriteResumeItem) => {
      if (item.kind === "external") {
        navigate("/resumes/external?resume=" + item.id);
        return;
      }
      navigate("/resumes?resume_id=" + item.id);
    },
    [navigate],
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

  const jobPage = data?.kind === "jobs" ? data.page : undefined;
  const resumePage = data?.kind === "resumes" ? data.page : undefined;
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
          emptyText={
            <EmptyState image={<EmptyWatermark />} description={t("favorites.empty.jobs")} />
          }
          onOpenJob={(job) => navigate("/jobs?job_id=" + job.id)}
          onUnfavorite={(job) => void removeJobFavorite(job)}
          onEnqueue={(job) => void enqueueJobs([job])}
          onApplyNow={(job) => void applyNow(job)}
          onSaveNote={(job, note) => void saveJobNote(job, note)}
        />
      ) : (
        <FavoriteResumeTable
          page={resumePage}
          loading={loading}
          busyKey={updatingKey}
          pageIndex={page}
          pageSize={pageSize}
          onPageChange={(nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          }}
          onOpen={openResumeDetail}
          onOpenInHub={openResumeInHub}
          onUnfavorite={(item) => void removeResumeFavorite(item)}
          emptyText={<EmptyState description={t("favorites.empty.resumes")} />}
        />
      )}
      <ResumeDetailModal recordId={previewId} onClose={() => setPreviewId(null)} />
      {/*
        外部简历的详情（原件 / 提取文本 / 文本检查 / 编辑 / 历史版本）直接复用简历中心的
        弹层：收藏页只是"入口"，不重画一份只读详情——两处各写一份必然漂移，用户在外壳
        和收藏页会看到两种"这份简历长什么样"。
      */}
      <ExternalResumeDetailDrawer
        resumeId={externalDetailId}
        onClose={() => setExternalDetailId(null)}
        onChanged={() => void reload()}
      />
    </div>
  );
}
