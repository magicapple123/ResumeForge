// SPDX-License-Identifier: Apache-2.0
/** 岗位列表表格、列渲染和分页。 */

import { CheckSquareOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { SortOrder, TableRowSelection } from "antd/es/table/interface";
import type { HTMLAttributes } from "react";
import { JOB_STATUS_META, type JobList, type Page } from "../../types";
import { formatDateTime } from "../../utils/format";
import { RowActions, RowContextMenu, type RowActionItem } from "../common/RowActions";
import SkillTags from "../SkillTags";
import { jobSourceKind } from "../../utils/jobSource";
import { nextSortState, sortOrderFor, type JobSortState } from "../../utils/jobSort";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

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
  /** 当前排序（受控）：列头箭头由它决定，点击列头经 onSortChange 回到 URL 状态里。 */
  sortState: JobSortState;
  onSortChange: (state: JobSortState) => void;
}

/**
 * `active` / `open` 是历史落库值：显示前先归一到「开放中」，再查 JOB_STATUS_META（兼容层，别删）。
 *
 * 值这一侧**不是界面文案**，是 JOB_STATUS_META 的查找键：换成语言包 key 会让状态 Tag
 * 查不到颜色与显示名（静默掉成 default）。状态名的本地化要先把 `types/job.ts` 的
 * JOB_STATUS_META 改成 labelKey，属于另一批。
 */
const STATUS_LABELS: Record<string, string> = {
  active: "开放中", // i18n-ok: 归一化目标是落库的数据值（JOB_STATUS_META 的键），不是界面文案
  open: "开放中", // i18n-ok: 同上，历史落库值共用同一个归一化目标
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
  sortState,
  onSortChange,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后列头与菜单不重渲染。
  useLocale();
  const columns: TableColumnsType<JobList> = [
    {
      title: t("jobTable.column.favorite"),
      key: "favorite",
      width: 64,
      align: "center",
      render: (_, job) => (
        <Tooltip
          title={job.favorite ? t("jobTable.action.unfavorite") : t("jobTable.action.favorite")}
        >
          <Button
            type="text"
            size="small"
            aria-label={
              job.favorite ? t("jobTable.action.unfavorite") : t("jobTable.action.favorite")
            }
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
      title: t("jobTable.column.title"),
      dataIndex: "title",
      key: "title",
      width: 260,
      // 排序走服务端（R14）：本页数据本地排序在分页下必错。
      sorter: true,
      sortOrder: sortOrderFor("title", sortState),
      showSorterTooltip: { title: t("jobTable.sort.title") },
      // 悬停整格都能看到导入时间：之前 Tooltip 只挂在岗位名那颗链接上，
      // 鼠标停在关键字标签或旁边空白处就没有提示，等于只有一半时候管用。
      render: (_, job) => (
        <Tooltip title={t("jobTable.tooltip.importedAt", { time: formatDateTime(job.created_at) })}>
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
                  {t("jobTable.source.collected")}
                </Tag>
              ) : (
                <Tag style={{ marginInlineEnd: 0 }}>{t("jobTable.source.manual")}</Tag>
              )}
            </div>
            <div style={{ marginTop: 4 }}>
              <SkillTags tags={job.keywords} max={4} />
            </div>
          </div>
        </Tooltip>
      ),
    },
    {
      title: t("jobTable.column.company"),
      dataIndex: "company",
      key: "company",
      width: 130,
      sorter: true,
      sortOrder: sortOrderFor("company", sortState),
      showSorterTooltip: { title: t("jobTable.sort.company") },
      render: (value) => value || "-",
    },
    {
      title: t("jobTable.column.location"),
      dataIndex: "location",
      width: 90,
      render: (value) => value || "-",
    },
    {
      title: t("jobTable.column.salary"),
      dataIndex: "salary",
      width: 130,
      render: (value) => value || "-",
    },
    { title: t("jobTable.column.jobType"), dataIndex: "job_type", width: 80 },
    {
      title: t("jobTable.column.status"),
      dataIndex: "status",
      width: 90,
      render: (value: string) => {
        // 先归一再查 META：`active` / `open` 是历史落库值（见上面的 STATUS_LABELS），
        // 归一后与 META 的键对齐。标签与颜色都来自 `types/job.ts` 的 JOB_STATUS_META
        // （唯一来源），不再在这里写一份「中文值当查找键」的颜色表。
        const meta = JOB_STATUS_META[STATUS_LABELS[value] ?? value];
        return <Tag color={meta?.color ?? "default"}>{meta?.label ?? (value || "-")}</Tag>;
      },
    },
    {
      title: t("jobTable.column.note"),
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
              <Tooltip title={t("jobTable.note.imageHint", { count: job.note_images.length })}>
                <Tag color="blue" className="job-note-image-tag">
                  {t("jobTable.note.imageCount", { count: job.note_images.length })}
                </Tag>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: t("jobTable.column.postedAt"),
      dataIndex: "posted_at",
      // 列里展示招聘信息自己写的 posted_at；排序键 `posted_desc` 也按它排——
      // 解析不出日期（空串 / "3 天前"）时后端回落到导入日期，不会把这类岗位甩到两端。
      key: "posted_at",
      width: 150,
      sorter: true,
      sortOrder: sortOrderFor("posted_at", sortState),
      // 默认就是倒序：把方向序列反过来，第一下点击才会真的变成升序。
      // 用默认的 ["ascend","descend"] 时，第一次点击是"取消排序"，而取消后又回到默认
      // 倒序——用户看到的是"点了没反应"。
      sortDirections: ["descend", "ascend"],
      showSorterTooltip: { title: t("jobTable.sort.postedAt") },
      render: (value: string) => value || "-",
    },
    {
      title: t("jobTable.column.actions"),
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
    { key: "detail", label: t("jobTable.action.detail"), onClick: () => onOpenDetail(job) },
    { key: "generate", label: t("jobTable.action.generate"), onClick: () => onGenerate(job) },
  ];

  /** 次级操作：只出现在整行右键菜单（行内不再有三点下拉）。 */
  const secondaryActions = (job: JobList): RowActionItem[] => [
    { key: "write", label: t("jobTable.action.write"), onClick: () => onWrite(job) },
    { key: "resumes", label: t("jobTable.action.resumes"), onClick: () => onViewResumes(job) },
    { key: "edit", label: t("jobTable.action.edit"), onClick: () => onEdit(job) },
    {
      key: "delete",
      label: t("common.action.delete"),
      danger: true,
      // 软删可撤销：不弹确认，5 秒撤销在 Toast 上。
      undo: true,
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
            label: t("common.action.batchSelect"),
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
        showTotal: (total) => t("jobTable.pagination.total", { total }),
        onChange: onPageChange,
      }}
      // 排序交给服务端：只把"排序动作"翻译成 API 参数，分页/筛选的动作各走各的。
      onChange={(_pagination, _filters, sorter, extra) => {
        if (extra.action !== "sort") return;
        const active = Array.isArray(sorter) ? sorter[0] : sorter;
        const columnKey = String(active?.columnKey ?? active?.field ?? "");
        onSortChange(nextSortState(columnKey, active?.order as SortOrder | null | undefined));
      }}
    />
  );
}
