/**
 * 求职进度：把投出去的岗位收到哪一步了集中在一页看。
 *
 * 页面的判断很少——状态怎么合并、这次识别会改变什么，全在后端算好随数据下发，
 * 前端只负责展示与把用户的选择送回去。漏斗条是纯 CSS 画的，没有引入图表库：
 * 这一页要表达的就是"每个阶段各有多少条"，用一个宽度成比例的横条已经说完了。
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
  Statistic,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import PageSkeleton from "../components/common/PageSkeleton";
import type { MenuProps } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getJob, listJobs } from "../api/jobs";
import { listResumes } from "../api/resumes";
import { deleteTrack, exportTracks, listTracks, listTracksPage } from "../api/tracker";
import ReminderPanel from "../components/ReminderPanel";
import TrackCard from "../components/tracker/TrackCard";
import TrackFormModal from "../components/tracker/TrackFormModal";
import TrackImportModal from "../components/tracker/TrackImportModal";
import { useApi } from "../hooks/useApi";
import { downloadBlob } from "../utils/download";
import type { Track, TrackList } from "../types";
import { FUNNEL_STATUSES, TRACK_STATUSES, TRACK_STATUS_LABELS } from "../types";

/** 每页条数：与后端分页端点默认值一致（page_size 1–100）。 */
const TRACK_PAGE_SIZE = 20;

/** 深链 ?job_id= 的解析：正整数才认，其余（缺省/非数字/≤0）一律按"没有筛选"处理。 */
function parseLinkedJobId(raw: string | null): number | null {
  const parsed = Number(raw);
  return raw && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function TrackerPage() {
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
  const [jobOptions, setJobOptions] = useState<{ value: number; label: string }[]>([]);
  const [resumeOptions, setResumeOptions] = useState<{ value: number; label: string }[]>([]);

  // 岗位详情深链带来的过滤（RF-11）：只看这个岗位的进度。非法值在解析处就被忽略。
  const jobId = parseLinkedJobId(searchParams.get("job_id"));
  // 筛选标签上的岗位名：单独取一次；岗位可能已被删除，失败时仍显示可清除的标签。
  const [linkedJobLabel, setLinkedJobLabel] = useState<string | null>(null);

  // 列表走分页端点（RF-08）：翻页/筛选变化都重新拉取，历史记录超过旧端点 500 条上限后仍可达。
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi(
    () => listTracksPage({ status, keyword, jobId: jobId ?? undefined }, page, TRACK_PAGE_SIZE),
    [status, keyword, page, jobId],
  );
  // 漏斗与统计字段不在分页端点里，仍走旧列表端点（同一套筛选，响应里的 items 顺便
  // 供提醒面板的可选进度下拉用——那是它此前就有的一条取数路径）。
  const { data: stats } = useApi<TrackList>(
    () => listTracks({ status, keyword }),
    [status, keyword],
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
          job.title ? `${job.title}${job.company ? ` · ${job.company}` : ""}` : `岗位 #${jobId}`,
        );
      })
      .catch(() => {
        if (!cancelled) setLinkedJobLabel("该岗位可能已删除");
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
  // 提醒面板的进度下拉沿用统计调用带回的列表（与旧行为同源，覆盖同样的范围）。
  const statItems = useMemo(() => stats?.items ?? [], [stats]);
  const trackOptions = useMemo(
    () =>
      statItems.map((track) => ({
        value: track.id,
        label: `${track.company} · ${track.title}`,
      })),
    [statItems],
  );
  const counts = stats?.status_counts ?? {};
  const totalCount = data?.total ?? 0;
  // 漏斗条的宽度按"这条占最大那条的比例"算，这样条目少时也不会全是一小截。
  const funnelMax = Math.max(1, ...FUNNEL_STATUSES.map((key) => counts[key] ?? 0));

  // 提醒面板需要绑定岗位 / 简历，这里只负责把可选项拉下来；失败静默，不影响进度页本身。
  useEffect(() => {
    listJobs({ page_size: 100 })
      .then((page) =>
        setJobOptions(
          page.items.map((job) => ({
            value: job.id,
            label: `${job.title}${job.company ? ` · ${job.company}` : ""}`,
          })),
        ),
      )
      .catch(() => setJobOptions([]));
    listResumes({ page_size: 100 })
      .then((page) =>
        setResumeOptions(
          page.items.map((resume) => ({
            value: resume.id,
            label: resume.title || `简历 #${resume.id}`,
          })),
        ),
      )
      .catch(() => setResumeOptions([]));
  }, []);

  const remove = async (track: Track) => {
    try {
      await deleteTrack(track.id);
      message.success("已移入回收站，可在「回收站」里恢复");
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const doExport = async (format: "csv" | "json") => {
    try {
      const { blob, filename } = await exportTracks(format, { status, keyword });
      downloadBlob(blob, filename);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导出失败");
    }
  };

  const exportMenu: MenuProps["items"] = [
    { key: "csv", label: "导出 CSV（可直接用 Excel 打开）" },
    { key: "json", label: "导出 JSON" },
  ];

  return (
    <div className="tracker-page">
      <div className="tracker-page-head">
        <Space orientation="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            求职进度
          </Typography.Title>
          <Typography.Text type="secondary">
            一家公司一个岗位一条记录，随对方发来的通知往前推进。投递台投出去的岗位会自动记一条
            「已投递」，之后的进展把通知粘进来即可。
          </Typography.Text>
        </Space>
        <Space>
          <Button icon={<BellOutlined />} onClick={() => setReminderOpen(true)}>
            提醒
          </Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
            从通知导入
          </Button>
          <Dropdown
            menu={{
              items: exportMenu,
              onClick: ({ key }) => void doExport(key as "csv" | "json"),
            }}
            disabled={totalCount === 0}
          >
            <Button icon={<DownloadOutlined />}>导出</Button>
          </Dropdown>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            添加进度
          </Button>
        </Space>
      </div>

      <div className="tracker-summary">
        <Statistic title="总数" value={totalCount} />
        <Statistic
          title="进行中"
          value={stats?.active_count ?? 0}
          prefix={<FunnelPlotOutlined />}
        />
        <Statistic title="本月投递" value={stats?.month_count ?? 0} />
        <Statistic
          title="Offer"
          value={stats?.offer_count ?? 0}
          styles={{ content: { color: "#389e0d" } }}
        />
        <Statistic title="已结束" value={stats?.rejected_count ?? 0} />
      </div>

      {totalCount > 0 && (
        <div className="tracker-funnel">
          {FUNNEL_STATUSES.map((key) => {
            const value = counts[key] ?? 0;
            const stageIndex = FUNNEL_STATUSES.indexOf(key);
            const percentage = funnelMax > 0 ? Math.round((value / funnelMax) * 100) : 0;
            return (
              <Tooltip key={key} title={`${TRACK_STATUS_LABELS[key]}：${value} 条`}>
                <button
                  type="button"
                  className={`tracker-funnel-step${status === key ? " is-selected" : ""}`}
                  data-stage-index={stageIndex}
                  onClick={() => setStatus(status === key ? "" : key)}
                >
                  <span className="tracker-funnel-index" aria-hidden="true">
                    {String(stageIndex + 1).padStart(2, "0")}
                  </span>
                  <span className="tracker-funnel-label">{TRACK_STATUS_LABELS[key]}</span>
                  <span className="tracker-funnel-count">{value}</span>
                  <span className="tracker-funnel-meter" aria-hidden="true">
                    <span className="tracker-funnel-bar" style={{ width: `${percentage}%` }} />
                  </span>
                  <span className="tracker-funnel-percent">{percentage}%</span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}

      <Space size={12} wrap className="tracker-filters">
        <Select
          value={status}
          onChange={setStatus}
          style={{ width: 160 }}
          options={[
            { value: "", label: "全部状态" },
            ...TRACK_STATUSES.map((value) => ({
              value,
              label: TRACK_STATUS_LABELS[value],
            })),
          ]}
        />
        <Input.Search
          allowClear
          placeholder="搜索公司、岗位、备注或下一步"
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
            只看该岗位的投递：{linkedJobLabel ?? "…"}
            <Button
              type="text"
              size="small"
              aria-label="清除岗位筛选"
              icon={<CloseOutlined />}
              onClick={clearJobFilter}
            />
          </Tag>
        )}
      </Space>

      {loading && <PageSkeleton rows={6} />}
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
      {!loading && !error && items.length === 0 && (
        <Empty
          description={
            keyword || status
              ? "没有符合条件的记录"
              : "还没有进度记录。投递台投出的岗位会自动出现在这里，也可以点「从通知导入」把邮箱里的进展整理进来。"
          }
        />
      )}

      <div className="tracker-list">
        {items.map((track) => (
          <TrackCard
            key={track.id}
            track={track}
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
          showTotal={(count) => `共 ${count} 条`}
        />
      </div>

      <TrackFormModal
        open={formOpen}
        track={editing}
        resumeOptions={resumeOptions}
        jobOptions={jobOptions}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={() => void reload()}
      />
      <TrackImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void reload()}
      />

      <Modal
        title="日历提醒"
        open={reminderOpen}
        onCancel={() => setReminderOpen(false)}
        footer={null}
        width={720}
      >
        <ReminderPanel
          trackOptions={trackOptions}
          jobOptions={jobOptions}
          resumeOptions={resumeOptions}
        />
      </Modal>
    </div>
  );
}
