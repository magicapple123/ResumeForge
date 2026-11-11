// SPDX-License-Identifier: Apache-2.0
/**
 * 收藏夹岗位表（#28A/#28B/#28C/#28D）。
 *
 * 拆出成组件而不是塞进页面：FavoritesPage 还有简历页签与批量工具条，页面文件已接近
 * 500 行预算；表格本体又是"列定义 + 行内编辑 + 徽标"的密集代码，单独一份更好改。
 */
import { Button, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType, TablePaginationConfig } from "antd";
// antd 根导出没有 TableRowSelection（AGENTS §Ant Design 9 的既有深路径例外）。
import type { TableRowSelection } from "antd/es/table/interface";
import type { ReactNode } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { JOB_STATUS_CLOSED, type FavoriteJob, type Page } from "../../types";
import { formatDateTime } from "../../utils/format";
import "./favorites.css";

interface FavoriteJobsTableProps {
  page: Page<FavoriteJob> | undefined;
  loading: boolean;
  /** 行内操作进行中的 key（同一时刻只允许一个，避免双击重复提交）。 */
  busyKey: string;
  rowSelection: TableRowSelection<FavoriteJob>;
  pagination: TablePaginationConfig;
  emptyText: ReactNode;
  onOpenJob: (job: FavoriteJob) => void;
  onUnfavorite: (job: FavoriteJob) => void;
  onEnqueue: (job: FavoriteJob) => void;
  onApplyNow: (job: FavoriteJob) => void;
  onSaveNote: (job: FavoriteJob, note: string) => void;
}

/** 生命周期徽标：在招/已关闭 + 已投递/在队列（#28B）。 */
function LifecycleTags({ job }: { job: FavoriteJob }) {
  const closed = job.status === JOB_STATUS_CLOSED;
  return (
    <Space size={4} wrap>
      <Tag color={closed ? "default" : "green"}>
        {closed ? t("favorites.badge.closed") : t("favorites.badge.open")}
      </Tag>
      {job.applied && <Tag color="blue">{t("favorites.badge.applied")}</Tag>}
      {job.queued && <Tag color="orange">{t("favorites.badge.queued")}</Tag>}
    </Space>
  );
}

/** 收藏时间：回填的近似值必须标「时间不详」（#28E），不把近似值当精确时间展示。 */
function FavoritedAt({ job }: { job: FavoriteJob }) {
  if (!job.favorited_at) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }
  return (
    <Space size={4}>
      <span>{formatDateTime(job.favorited_at)}</span>
      {job.favorited_at_estimated && <Tag>{t("favorites.badge.estimated")}</Tag>}
    </Space>
  );
}

export default function FavoriteJobsTable(props: FavoriteJobsTableProps) {
  useLocale();
  const {
    page,
    loading,
    busyKey,
    rowSelection,
    pagination,
    emptyText,
    onOpenJob,
    onUnfavorite,
    onEnqueue,
    onApplyNow,
    onSaveNote,
  } = props;
  const items = page?.items ?? [];

  const columns: TableColumnsType<FavoriteJob> = [
    {
      title: t("favorites.column.job"),
      dataIndex: "title",
      render: (_, job) => (
        <div>
          <Tooltip
            title={t("favorites.tooltip.importedAt", { time: formatDateTime(job.created_at) })}
          >
            <Button type="link" className="table-text-link" onClick={() => onOpenJob(job)}>
              {job.title}
            </Button>
          </Tooltip>
          {job.keywords.length > 0 && (
            <div>
              <Space size={4} wrap>
                {job.keywords.slice(0, 3).map((tag) => (
                  <Tag key={tag.name}>{tag.name}</Tag>
                ))}
              </Space>
            </div>
          )}
        </div>
      ),
    },
    {
      title: t("favorites.column.company"),
      dataIndex: "company",
      width: 150,
      render: (value: string) => value || "-",
    },
    {
      title: t("favorites.column.status"),
      width: 190,
      render: (_, job) => <LifecycleTags job={job} />,
    },
    {
      title: t("favorites.column.favoritedAt"),
      width: 170,
      render: (_, job) => <FavoritedAt job={job} />,
    },
    {
      title: t("favorites.column.note"),
      width: 220,
      render: (_, job) => (
        <Typography.Text
          type={job.note ? undefined : "secondary"}
          editable={{
            maxLength: 2000,
            tooltip: t("favorites.column.note"),
            text: job.note || "",
            onChange: (value) => onSaveNote(job, value),
          }}
        >
          {job.note || t("favorites.note.placeholder")}
        </Typography.Text>
      ),
    },
    {
      title: t("favorites.column.actions"),
      width: 230,
      align: "center",
      render: (_, job) => (
        <Space size={4}>
          <Tooltip title={t("favorites.action.unfavorite")}>
            <Button
              type="text"
              aria-label={t("favorites.action.unfavorite")}
              loading={busyKey === String(job.id)}
              disabled={Boolean(busyKey)}
              onClick={() => onUnfavorite(job)}
            >
              ★
            </Button>
          </Tooltip>
          <Button
            size="small"
            disabled={Boolean(busyKey) || job.applied || job.queued}
            onClick={() => onEnqueue(job)}
          >
            {t("favorites.action.enqueue")}
          </Button>
          <Button
            size="small"
            type="primary"
            // 已投递之后「立即投递」必须禁用（#28B 验收）：再投一次等于重复投递。
            disabled={Boolean(busyKey) || job.applied}
            onClick={() => onApplyNow(job)}
          >
            {t("favorites.action.applyNow")}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Table<FavoriteJob>
      rowKey="id"
      columns={columns}
      dataSource={items}
      loading={loading}
      rowSelection={rowSelection}
      rowClassName={(job) => (job.status === JOB_STATUS_CLOSED ? "favorites-row-closed" : "")}
      locale={{ emptyText }}
      scroll={items.length ? { x: 1180 } : undefined}
      pagination={{
        ...pagination,
        total: page?.total ?? 0,
        showTotal: (total: number) => t("favorites.pagination.total", { total }),
      }}
    />
  );
}
