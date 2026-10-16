/** 岗位列表表格、列渲染和分页。 */

import { CheckSquareOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { HTMLAttributes } from "react";
import type { JobList, Page } from "../../types";
import { formatDateTime } from "../../utils/format";
import { RowActions, RowContextMenu, type RowActionItem } from "../common/RowActions";
import SkillTags from "../SkillTags";
import { jobSourceKind } from "../../utils/jobSource";

// 值域与 pages/jobs/jobFilterOptions.ts 的 BatchAction 保持一致（新增动作两处同步改）；
// 此处只判「有无批量操作进行中」，不区分具体动作。类型本地持有是因为 components
// 不反向依赖 pages。
type BatchAction = "status" | "delete" | "enqueue" | null;

interface Props {
  jobs: Page<JobList> | undefined;
  loading: boolean;
  selectionMode: boolean;
  rowSelection: TableRowSelection<JobList>;
  batchAction: BatchAction;
  favoriteJobId: number | null;
  page: number;
  pageSize: number;
  onToggleFavorite: (job: JobList) => void;
  onOpenDetail: (job: JobList) => void;
  onGenerate: (job: JobList) => void;
  onWrite: (job: JobList) => void;
  onViewResumes: (job: JobList) => void;
  onEdit: (job: JobList) => void;
  onDelete: (job: JobList) => void;
  /** 右键菜单「批量选择」的动作：进入选择模式（工具栏按钮已收进这里，R8）。 */
  onEnterSelecting: () => void;
  onPageChange: (page: number, pageSize: number) => void;
}

const STATUS_COLORS: Record<string, string> = {
  开放中: "green",
  active: "green",
  open: "green",
  已截止: "default",
  已投递: "blue",
};

const STATUS_LABELS: Record<string, string> = {
  active: "开放中",
  open: "开放中",
};

export default function JobTable({
  jobs,
  loading,
  selectionMode,
  rowSelection,
  batchAction,
  favoriteJobId,
  page,
  pageSize,
  onToggleFavorite,
  onOpenDetail,
  onGenerate,
  onWrite,
  onViewResumes,
  onEdit,
  onDelete,
  onEnterSelecting,
  onPageChange,
}: Props) {
  const columns: ColumnsType<JobList> = [
    {
      title: "收藏",
      key: "favorite",
      width: 64,
      align: "center",
      render: (_, job) => (
        <Tooltip title={job.favorite ? "取消收藏" : "收藏岗位"}>
          <Button
            type="text"
            size="small"
            aria-label={job.favorite ? "取消收藏" : "收藏岗位"}
            className={`job-favorite-button${job.favorite ? " is-favorite" : ""}`}
            icon={job.favorite ? <StarFilled /> : <StarOutlined />}
            loading={favoriteJobId === job.id}
            disabled={batchAction !== null || favoriteJobId !== null}
            onClick={() => onToggleFavorite(job)}
          />
        </Tooltip>
      ),
    },
    {
      title: "岗位",
      dataIndex: "title",
      width: 260,
      // 悬停整格都能看到导入时间：之前 Tooltip 只挂在岗位名那颗链接上，
      // 鼠标停在关键字标签或旁边空白处就没有提示，等于只有一半时候管用。
      render: (_, job) => (
        <Tooltip title={`导入于 ${formatDateTime(job.created_at)}`}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Button
                type="link"
                className="table-text-link"
                disabled={batchAction !== null}
                onClick={batchAction === null ? () => onOpenDetail(job) : undefined}
              >
                {job.title}
              </Button>
              {jobSourceKind(job) === "collected" ? (
                <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                  采集
                </Tag>
              ) : (
                <Tag style={{ marginInlineEnd: 0 }}>手动</Tag>
              )}
            </div>
            <div style={{ marginTop: 4 }}>
              <SkillTags tags={job.keywords} max={4} />
            </div>
          </div>
        </Tooltip>
      ),
    },
    { title: "公司", dataIndex: "company", width: 130, render: (value) => value || "-" },
    { title: "城市", dataIndex: "location", width: 90, render: (value) => value || "-" },
    { title: "薪资", dataIndex: "salary", width: 130, render: (value) => value || "-" },
    { title: "类型", dataIndex: "job_type", width: 80 },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: string) => (
        <Tag color={STATUS_COLORS[value] ?? "default"}>
          {STATUS_LABELS[value] ?? (value || "-")}
        </Tag>
      ),
    },
    {
      title: "备注",
      dataIndex: "note",
      width: 180,
      render: (_, job) => {
        const hasImages = (job.note_images?.length ?? 0) > 0;
        const text = job.note || "";
        return (
          <div className="job-note-cell">
            <Typography.Text
              type={text ? undefined : "secondary"}
              ellipsis={text ? { tooltip: text } : undefined}
              style={{ display: "block", maxWidth: 160 }}
            >
              {text || "-"}
            </Typography.Text>
            {hasImages && (
              <Tooltip title={`备注里有 ${job.note_images.length} 张图片，打开详情查看`}>
                <Tag color="blue" className="job-note-image-tag">
                  {job.note_images.length} 张图
                </Tag>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: "发布时间",
      dataIndex: "posted_at",
      width: 150,
      render: (value: string) => value || "-",
    },
    {
      title: "操作",
      key: "actions",
      width: 170,
      render: (_, job) => (
        // 三点「更多」下拉已移除：右键菜单（含同一份次级操作）是唯一入口，
        // 键盘用户可用 ContextMenu 键 / Shift+F10 打开（见 RowContextMenu）。
        <RowActions disabled={batchAction !== null} primary={primaryActions(job)} />
      ),
    },
  ];

  /** 主操作直接平铺在行上；其余操作（含删除）统一收进整行右键菜单。 */
  const primaryActions = (job: JobList): RowActionItem[] => [
    { key: "detail", label: "详情", onClick: () => onOpenDetail(job) },
    { key: "generate", label: "生成简历", onClick: () => onGenerate(job) },
  ];

  /** 次级操作：只出现在整行右键菜单（行内不再有三点下拉）。 */
  const secondaryActions = (job: JobList): RowActionItem[] => [
    { key: "write", label: "自行编写", onClick: () => onWrite(job) },
    { key: "resumes", label: "相关简历", onClick: () => onViewResumes(job) },
    { key: "edit", label: "编辑", onClick: () => onEdit(job) },
    {
      key: "delete",
      label: "删除",
      danger: true,
      confirm: "确定删除该岗位？",
      onClick: () => onDelete(job),
    },
  ];

  /** 整行右键：鼠标不在行内链接上，给完整清单更方便。
   * 非选择模式时顶部带「批量选择」（工具栏按钮已收进这里，R8）；选择模式下不重复给。 */
  const contextActions = (job: JobList): RowActionItem[] => [
    ...(selectionMode
      ? []
      : [
          {
            key: "batch_select",
            label: "批量选择",
            icon: <CheckSquareOutlined />,
            onClick: onEnterSelecting,
          } satisfies RowActionItem,
        ]),
    ...primaryActions(job),
    ...secondaryActions(job),
  ];

  return (
    <Table
      className="jobs-table"
      rowKey="id"
      rowSelection={selectionMode ? rowSelection : undefined}
      columns={columns}
      dataSource={jobs?.items ?? []}
      loading={loading}
      // 空表（无当前页行）时不启用横向滚动：否则 `.ant-table-content` 会变成
      // "可横滚、区域内却没有任何可聚焦元素"的容器，命中 axe 的
      // `scrollable-region-focusable`（serious）。有数据时照旧按列宽固定横滚。
      scroll={jobs?.items?.length ? { x: 1330 } : undefined}
      components={{
        body: {
          // 整行右键即可编辑/删除；批量模式下不拦截右键，避免和选择操作打架。
          row: (props: HTMLAttributes<HTMLTableRowElement>) => {
            const rowKey = String((props as { "data-row-key"?: string })["data-row-key"] ?? "");
            const job = (jobs?.items ?? []).find((item) => String(item.id) === rowKey);
            if (batchAction !== null || !job) return <tr {...props} />;
            return (
              <RowContextMenu items={contextActions(job)}>
                <tr {...props} />
              </RowContextMenu>
            );
          },
        },
      }}
      pagination={{
        current: page,
        pageSize,
        total: jobs?.total ?? 0,
        disabled: batchAction !== null,
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 个岗位`,
        onChange: onPageChange,
      }}
    />
  );
}
