// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度：把投出去的岗位收到哪一步了集中在一页看。
 *
 * 页面的判断很少——状态怎么合并、这次识别会改变什么，全在后端算好随数据下发，
 * 前端只负责展示与把用户的选择送回去。顶部「指标带 + 阶段构成条」在
 * features/tracker/TrackerSummary.tsx（12.2/13）：构成条是纯 CSS 画的，没有引入
 * 图表库；本页只保留筛选、列表与弹窗编排。
 */
import {
  BellOutlined,
  CloseOutlined,
  DownloadOutlined,
  FunnelPlotOutlined,
  ImportOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import PageSkeleton from "../components/common/PageSkeleton";
import TrackerSummary from "../features/tracker/TrackerSummary";
import ErrorState from "../components/common/ErrorState";
import type { MenuProps } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getJob } from "../api/jobs";
import { deleteTrack, exportTracks, listTrackStats, listTracksPage } from "../api/tracker";
import ReminderPanel from "../features/tracker/ReminderPanel";
import TrackCard from "../features/tracker/TrackCard";
import TrackFormModal from "../features/tracker/TrackFormModal";
import TrackImportModal from "../features/tracker/TrackImportModal";
import { useApi } from "../hooks/useApi";
import { useDeleteUndo } from "../features/trash/useDeleteUndo";
import { downloadBlob } from "../utils/download";
import type { Track } from "../types";
import { TRACK_STATUSES } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import { TRACK_STATUS_LABEL_KEYS } from "../i18n/enum/tracker";

/** 每页条数：与后端分页端点默认值一致（page_size 1–100）。 */
const TRACK_PAGE_SIZE = 20;

/** 深链 ?job_id= 的解析：正整数才认，其余（缺省/非数字/≤0）一律按"没有筛选"处理。 */
function parseLinkedJobId(raw: string | null): number | null {
  const parsed = Number(raw);
  return raw && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function TrackerPage() {
  // 本页用模块级 t()：必须订阅语言变化，否则切语言后整页文案不重渲染。
  useLocale();
  const { message } = App.useApp();
  // 状态筛选与关键词从 URL 读初值、改动后 replace 写回（模式同 WebFormPage / JobsPage）。
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  // 搜索框受控镜像（同 JobFilterBar 的处理）：URL 恢复的关键词能回填输入框。
  // Compiler 规范：镜像同步用渲染期守卫式调整。
  const [searchText, setSearchText] = useState(keyword);
  const [prevKeyword, setPrevKeyword] = useState(keyword);
  if (prevKeyword !== keyword) {
    setPrevKeyword(keyword);
    setSearchText(keyword);
  }
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Track | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);

  // 岗位详情深链带来的过滤（RF-11）：只看这个岗位的进度。非法值在解析处就被忽略。
  const jobId = parseLinkedJobId(searchParams.get("job_id"));
  // 筛选标签上的岗位名：单独取一次；岗位可能已被删除，失败时仍显示可清除的标签。
  const [linkedJobLabel, setLinkedJobLabel] = useState<string | null>(null);

  // 列表走分页端点（RF-08）：翻页/筛选变化都重新拉取，历史记录超过旧端点 500 条上限后仍可达。
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi(
    () => listTracksPage({ status, keyword, jobId: jobId ?? undefined }, page, TRACK_PAGE_SIZE),
    [status, keyword, page, jobId],
    // 回到前台静默重拉（问题 27a）：投递队列与岗位/简历列表同一批开启。
    { refetchOnFocus: {} },
  );
  // 漏斗与统计字段走专用统计端点（P1-2）：不再为拉统计整表取回，
  // 记录数上万后页面开销从"全量 items"降到"几十个数字"。
  // jobId（PR-13）：与列表同一份筛选——岗位深链时漏斗/导出不再"看得到的全是别的岗位"。
  // reload 一并暴露：新增/导入/删除之后列表与统计要一起失效刷新，否则卡片变了
  // 漏斗数字还停在旧值，直到下次筛选变化才追上。
  const {
    data: stats,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
  } = useApi(
    () => listTrackStats({ status, keyword, jobId: jobId ?? undefined }),
    [status, keyword, jobId],
  );
  // 一次 mutation 后两边一起刷新；Promise.all 让两个请求并发跑。
  const reloadAll = useCallback(
    () => Promise.all([reload(), reloadStats()]),
    [reload, reloadStats],
  );

  // 筛选条件变化时回第 1 页（渲染期守卫式调整，Compiler 规范）；深链 job_id 也算筛选。
  const filterKey = `${status}|${keyword}|${jobId ?? ""}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  // 筛选写回 URL（replace 语义）；effect 不依赖 searchParams，不会循环重渲染。
  // 只写 status/keyword：job_id 通过 functional 更新原样保留，清除走 clearJobFilter。
  useEffect(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (status) next.set("status", status);
        else next.delete("status");
        if (keyword) next.set("keyword", keyword);
        else next.delete("keyword");
        return next;
      },
      { replace: true },
    );
  }, [status, keyword, setSearchParams]);

  // 筛选标签的岗位名：单取一次（JobsPage 深链同款做法）。jobId 变化即重取；
  // 岗位已删除时给出一句实话，标签本身仍可清除。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (jobId === null) {
      setLinkedJobLabel(null);
      return;
    }
    let cancelled = false;
    setLinkedJobLabel(null);
    void getJob(jobId)
      .then((job) => {
        if (cancelled) return;
        setLinkedJobLabel(
          job.title
            ? `${job.title}${job.company ? ` · ${job.company}` : ""}`
            : t("trackerPage.linkedJob.unknownName", { id: jobId }),
        );
      })
      .catch(() => {
        if (!cancelled) setLinkedJobLabel(t("trackerPage.linkedJob.deleted"));
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 清除岗位筛选 = 从 URL 移除参数：jobId 随之变 null，列表自动重拉、回第 1 页。
  const clearJobFilter = useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("job_id");
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const totalCount = data?.total ?? 0;

  // 软删可撤销：单条删除不再前置确认，Toast 里给 5 秒「撤销」（见 useDeleteUndo）。
  // 批量走的是本页之外的路径，不受这里影响。
  const deleteUndo = useDeleteUndo();
  const remove = async (track: Track) => {
    try {
      await deleteUndo.run({ type: "track", ids: [track.id] }, () => deleteTrack(track.id), {
        // 恢复回一条记录，列表与漏斗统计要一起追上（否则数字停在删除后的值）。
        onRestored: () => void reloadAll(),
      });
      await reloadAll();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("trackerPage.error.deleteFailed"));
    }
  };

  const doExport = async (format: "csv" | "json") => {
    try {
      // 深链岗位时导出同一份口径（PR-13）：只导出该岗位的进度。
      const { blob, filename } = await exportTracks(format, {
        status,
        keyword,
        jobId: jobId ?? undefined,
      });
      downloadBlob(blob, filename);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("trackerPage.error.exportFailed"));
    }
  };

  const exportMenu: MenuProps["items"] = [
    { key: "csv", label: t("trackerPage.export.csv") },
    { key: "json", label: t("trackerPage.export.json") },
  ];

  return (
    <div className="tracker-page">
      <div className="tracker-page-head">
        <Space orientation="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("trackerPage.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("trackerPage.subtitle")}</Typography.Text>
        </Space>
        <Space>
          <Button icon={<BellOutlined />} onClick={() => setReminderOpen(true)}>
            {t("trackerPage.action.reminders")}
          </Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
            {t("trackerPage.action.import")}
          </Button>
          <Dropdown
            menu={{
              items: exportMenu,
              onClick: ({ key }) => void doExport(key as "csv" | "json"),
            }}
            disabled={totalCount === 0}
          >
            <Button icon={<DownloadOutlined />}>{t("trackerPage.action.export")}</Button>
          </Dropdown>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("trackerPage.action.create")}
          </Button>
        </Space>
      </div>

      <TrackerSummary
        stats={stats}
        statsLoading={statsLoading}
        statsError={statsError}
        totalCount={totalCount}
        status={status}
        onSelectStatus={setStatus}
      />

      <Space size={16} wrap className="tracker-filters rf-filter-bar">
        <Select
          aria-label={t("trackerPage.filter.statusAria")}
          value={status}
          onChange={setStatus}
          style={{ width: 160 }}
          options={[
            { value: "", label: t("trackerPage.filter.allStatuses") },
            ...TRACK_STATUSES.map((value) => ({
              value,
              label: t(TRACK_STATUS_LABEL_KEYS[value]),
            })),
          ]}
        />
        <Input.Search
          allowClear
          placeholder={t("trackerPage.filter.searchPlaceholder")}
          style={{ width: 280 }}
          value={searchText}
          onChange={(event) => {
            const value = event.target.value;
            setSearchText(value);
            if (value === "" && keyword !== "") setKeyword("");
          }}
          onSearch={(value) => {
            setSearchText(value);
            setKeyword(value);
          }}
        />
        {jobId !== null && (
          <Tag
            color="blue"
            icon={<FunnelPlotOutlined />}
            style={{ marginInlineEnd: 0 }}
            className="tracker-job-filter-tag"
          >
            {t("trackerPage.linkedJob.prefix", { label: linkedJobLabel ?? "…" })}
            <Button
              type="text"
              size="small"
              aria-label={t("trackerPage.action.clearJobFilter")}
              icon={<CloseOutlined />}
              onClick={clearJobFilter}
            />
          </Tag>
        )}
      </Space>

      {loading && <PageSkeleton rows={6} />}
      {error && <ErrorState description={error} onRetry={() => void reload()} />}
      {!loading && !error && items.length === 0 && (
        <Empty
          description={
            keyword || status ? t("trackerPage.empty.filtered") : t("trackerPage.empty.initial")
          }
        />
      )}

      <div className="tracker-list">
        {items.map((track, index) => (
          <TrackCard
            key={track.id}
            track={track}
            // 长列表每 10 行加一条 2px 细分隔（13.5 风险），不重新加回卡片。
            groupStart={index > 0 && index % 10 === 0}
            onEdit={() => {
              setEditing(track);
              setFormOpen(true);
            }}
            onDelete={() => void remove(track)}
          />
        ))}
      </div>

      {/* 服务端分页（RF-08）：页码/总数来自分页端点响应；一页以内不显示翻页条。 */}
      <div style={{ textAlign: "right", marginTop: 12 }}>
        <Pagination
          current={page}
          pageSize={TRACK_PAGE_SIZE}
          total={totalCount}
          onChange={setPage}
          hideOnSinglePage
          showSizeChanger={false}
          showTotal={(count) => t("trackerPage.pagination.total", { count })}
        />
      </div>

      <TrackFormModal
        open={formOpen}
        track={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={() => void reloadAll()}
      />
      <TrackImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void reloadAll()}
      />

      <Modal
        title={t("trackerPage.modal.reminderTitle")}
        open={reminderOpen}
        onCancel={() => setReminderOpen(false)}
        footer={null}
        width={720}
      >
        {/* 绑定目标下拉由 ReminderPanel 内部远程搜索（P0-1），页面不再预拉选项。 */}
        <ReminderPanel />
      </Modal>
    </div>
  );
}
