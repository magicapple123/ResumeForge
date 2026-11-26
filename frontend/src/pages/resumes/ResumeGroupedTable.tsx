// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的「按岗位折叠」视图（CR-33）。
 *
 * 一行 = 一个岗位（或一份通用简历）。行上给出用户判断"要不要展开"的三个事实：
 * 岗位名 · 版本数、最近更新时间、这个岗位投递过几次。版本本身仍然是一等公民：
 * 展开后的收藏/预览/重命名/备注/对比/删除全都带各自的 `resume_id`。
 *
 * 刻意**不提供**任何"作用于整组"的动作（组级收藏 / 组级删除）：折叠只是呈现方式，
 * 一旦让"整组"成为操作对象，用户就会在一行里删掉 N 份简历。多版本组因此也不可勾选
 * （见 `isGroupBatchSelectable`）。
 */
import { StarFilled } from "@ant-design/icons";
import { Button, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { HTMLAttributes } from "react";
import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { RowActions, RowContextMenu, type RowActionItem } from "../../components/common/RowActions";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeBrief } from "../../types";
import type { DiffViewData } from "../../types/resumeFieldDiff";
import { formatDateTime } from "../../utils/format";
import type { ResumeSortField, ResumeSortState } from "../../utils/resumeSort";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import { isGroupBatchSelectable } from "../../features/resume/list/resumeGroups";
import ResumeVersionList from "./ResumeVersionList";
import { copyMenuFor } from "./resumeRowCopyActions";
import {
  groupRowActions,
  groupSecondaryActions,
  groupToggleAction,
  singleRowActions,
  type GroupMenuContext,
} from "./resumeGroupMenu";
import {
  batchSelectAction,
  primaryActionsFor,
  secondaryActionsFor,
  type RowActionDeps,
} from "./resumeTableActions";

const SORT_OPTIONS: {
  value: ResumeSortField;
  labelKey:
    | "responsive.resumes.sort.updated"
    | "responsive.resumes.sort.created"
    | "responsive.resumes.sort.title"
    | "responsive.resumes.sort.job";
}[] = [
  { value: "updated", labelKey: "responsive.resumes.sort.updated" },
  { value: "created", labelKey: "responsive.resumes.sort.created" },
  { value: "title", labelKey: "responsive.resumes.sort.title" },
  { value: "job_title", labelKey: "responsive.resumes.sort.job" },
];

interface Props {
  /** 平铺视图的入参，由 ResumeResultList 原样透传；折叠视图按组渲染，用不到。 */
  data?: unknown;
  /** 多选态右键菜单的批量动作（批量删除 / 批量导出），与平铺表同一份。 */
  batchActions?: RowActionItem[];
  groups: ResumeGroup[];
  /** 组总数（折叠后的分页 total）。 */
  totalGroups: number;
  loading: boolean;
  batch: BatchSelection<number>;
  favoriteResumeId: number | null;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  pageSize: number;
  setPageSize: Dispatch<SetStateAction<number>>;
  toggleFavorite: (record: ResumeBrief) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setPreviewId: (id: number | null) => void;
  setRenameTarget: (target: ResumeBrief | null) => void;
  setRenameValue: (value: string) => void;
  setNoteTarget: (target: ResumeBrief | null) => void;
  setNoteValue: (value: string) => void;
  setDiffBase: (target: ResumeBrief | null) => void;
  setDiffAgainstId: (id: number | null) => void;
  setDiffResult: (result: DiffViewData | null) => void;
  sortState: ResumeSortState;
  onSortChange: (next: ResumeSortState) => void;
  navigate: (path: string) => void;
  /** 展开的组 key（`job:1` / `resume:2`），由页面持久化到 localStorage。 */
  expandedKeys: string[];
  setExpandedKeys: (keys: string[]) => void;
}

export default function ResumeGroupedTable({
  groups,
  totalGroups,
  loading,
  batch,
  batchActions = [],
  favoriteResumeId,
  page,
  setPage,
  pageSize,
  setPageSize,
  toggleFavorite,
  remove,
  setPreviewId,
  setRenameTarget,
  setRenameValue,
  setNoteTarget,
  setNoteValue,
  setDiffBase,
  setDiffAgainstId,
  setDiffResult,
  sortState,
  onSortChange,
  navigate,
  expandedKeys,
  setExpandedKeys,
}: Props) {
  useLocale();
  const toast = useToast();

  const deps = useMemo<RowActionDeps>(
    () => ({
      setPreviewId,
      setRenameTarget,
      setRenameValue,
      setNoteTarget,
      setNoteValue,
      setDiffBase,
      setDiffAgainstId,
      setDiffResult,
      toggleFavorite,
      remove,
    }),
    [
      setPreviewId,
      setRenameTarget,
      setRenameValue,
      setNoteTarget,
      setNoteValue,
      setDiffBase,
      setDiffAgainstId,
      setDiffResult,
      toggleFavorite,
      remove,
    ],
  );

  const groupByKey = useMemo(() => {
    const map = new Map<string, ResumeGroup>();
    for (const group of groups) map.set(group.key, group);
    return map;
  }, [groups]);

  const titleOf = (group: ResumeGroup): string => {
    if (group.jobId === null) return group.latest.title;
    const job = group.jobTitle.trim();
    return job
      ? t("resumes.list.group.title", { job, count: group.versionCount })
      : t("resumes.list.group.titleFallback", { count: group.versionCount });
  };

  const toggleGroup = useCallback(
    (key: string) => {
      setExpandedKeys(
        expandedKeys.includes(key)
          ? expandedKeys.filter((item) => item !== key)
          : [...expandedKeys, key],
      );
    },
    [expandedKeys, setExpandedKeys],
  );

  /**
   * 行菜单上下文：组行 / 单版本行 / 版本行三处共用同一份（`resumeGroupMenu` 里按行类型
   * 分派）。`navigate` 由页面传下来，岗位名与「在岗位广场打开」走同一条深链。
   */
  const menuCtx = useMemo<GroupMenuContext>(
    () => ({
      deps,
      toast,
      enterSelecting: batch.enterSelecting,
      toggleGroup,
      openJob: (jobId: number) => navigate(`/jobs?job_id=${jobId}`),
      isExpanded: (key: string) => expandedKeys.includes(key),
    }),
    [deps, toast, batch.enterSelecting, toggleGroup, navigate, expandedKeys],
  );

  const columns: TableColumnsType<ResumeGroup> = [
    {
      title: t("resumes.list.column.title"),
      key: "group",
      render: (_, group) => (
        <Space size={6} wrap>
          {group.hasFavorite && (
            <Tooltip title={t("resumes.list.group.favoriteHint")}>
              <StarFilled style={{ color: "var(--rf-favorite)" }} />
            </Tooltip>
          )}
          {group.versionCount > 1 ? (
            <Button type="link" className="table-text-link" onClick={() => toggleGroup(group.key)}>
              {titleOf(group)}
            </Button>
          ) : (
            <Button
              type="link"
              className="table-text-link resume-title-link"
              onClick={() => setPreviewId(group.latest.id)}
            >
              {group.latest.title}
            </Button>
          )}
        </Space>
      ),
    },
    {
      title: t("resumes.list.column.job"),
      key: "job",
      width: 260,
      render: (_, group) => (
        <Space size={4} wrap>
          {group.jobId !== null && group.versionCount === 1 ? (
            <Button
              type="link"
              className="table-text-link"
              onClick={() => navigate(`/jobs?job_id=${group.jobId}`)}
            >
              <Tag color="blue" className="resume-job-tag">
                {group.jobTitle || "-"}
              </Tag>
            </Button>
          ) : group.jobId === null ? (
            <Tooltip title={t("resumes.list.generalHint")}>
              <Tag color="purple">{t("resumes.list.general")}</Tag>
            </Tooltip>
          ) : null}
          {group.company && <Tag className="resume-company-tag">{group.company}</Tag>}
        </Space>
      ),
    },
    {
      title: t("resumes.list.column.lastUpdated"),
      key: "updated",
      width: 220,
      render: (_, group) => (
        <Typography.Text type="secondary" className="resume-group-meta">
          {t("resumes.list.group.updated", {
            time: group.latestUpdatedAt ? formatDateTime(group.latestUpdatedAt) : "—",
          })}
        </Typography.Text>
      ),
    },
    {
      title: t("resumes.list.column.delivery"),
      key: "delivery",
      width: 160,
      render: (_, group) => (
        <span className="resume-group-meta">
          {t("resumes.list.group.delivery", { count: group.deliveryCount })}
        </span>
      ),
    },
    {
      title: t("resumes.list.column.actions"),
      key: "actions",
      width: 200,
      render: (_, group) =>
        group.versionCount > 1 ? (
          // 多版本组：主按钮是展开/收起，其余（去岗位广场 + 两个复制项）进「⋯」。
          // 「⋯」与整行右键共用 `resumeGroupMenu` 的同一份构造——多版本组行以前连
          // 「⋯」都没有，等于这一屏拿不到任何组级入口（问题 1）。
          <RowActions
            primary={[groupToggleAction(group, menuCtx)]}
            more={groupSecondaryActions(group, menuCtx)}
            disabled={batch.selecting}
          />
        ) : (
          // 单版本组：与平铺表格的行完全一致（主操作平铺，其余进「⋯」与整行右键）。
          <RowActions
            primary={primaryActionsFor(group.latest, deps)}
            more={[
              batchSelectAction(batch.enterSelecting),
              copyMenuFor(group.latest, toast),
              ...secondaryActionsFor(group.latest, deps),
            ]}
            disabled={batch.selecting}
          />
        ),
    },
  ];

  return (
    <div className="resume-group-table">
      <Space size={8} wrap style={{ marginBottom: 8 }}>
        <span className="resume-group-meta">{t("responsive.resumes.sort")}</span>
        <Select
          size="small"
          value={sortState.field}
          aria-label={t("responsive.resumes.sort")}
          options={SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          onChange={(field) =>
            onSortChange({
              field,
              order: sortState.field === field && sortState.order === "desc" ? "asc" : "desc",
              explicit: true,
            })
          }
        />
        <Button
          size="small"
          onClick={() =>
            onSortChange({
              ...sortState,
              order: sortState.order === "asc" ? "desc" : "asc",
              explicit: true,
            })
          }
        >
          {sortState.order === "asc"
            ? t("responsive.resumes.order.asc")
            : t("responsive.resumes.order.desc")}
        </Button>
      </Space>
      <Table
        rowKey="key"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={groups}
        components={{
          body: {
            /**
             * 整行右键（问题 1 的根因）：折叠表此前**没有**注入 `components.body.row`，
             * 而平铺表是在这里挂的（`ResumeTable.tsx` 的 `ContextMenuRow`）。按行 key
             * 分派：多版本组行给组级三项，单版本组行给与平铺行完全一致的一整份清单。
             *
             * 选择模式（`batch.selecting`）下与平铺表同口径：多版本组**不给**菜单
             * （它本来就不能勾选，弹一份"批量"菜单会让人以为能对整组操作），
             * 单版本行换成批量动作。
             */
            row: (props: HTMLAttributes<HTMLTableRowElement>) => {
              const rowKey = String((props as { "data-row-key"?: string })["data-row-key"] ?? "");
              const group = groupByKey.get(rowKey);
              if (!group) return <tr {...props} />;
              if (group.versionCount > 1) {
                if (batch.selecting) return <tr {...props} />;
                return (
                  <RowContextMenu items={groupRowActions(group, menuCtx)}>
                    <tr {...props} />
                  </RowContextMenu>
                );
              }
              const items = batch.selecting
                ? (batchActions ?? [])
                : singleRowActions(group.latest, menuCtx);
              return (
                <RowContextMenu items={items}>
                  <tr {...props} />
                </RowContextMenu>
              );
            },
          },
        }}
        expandable={{
          expandedRowKeys: expandedKeys,
          expandedRowRender: (group) => (
            <ResumeVersionList
              group={group}
              deps={deps}
              toast={toast}
              menuCtx={menuCtx}
              selecting={batch.selecting}
              favoriteResumeId={favoriteResumeId}
              toggleFavorite={toggleFavorite}
            />
          ),
          // 单版本组没有"展开"这回事，别给一个点了没变化的箭头。
          rowExpandable: (group) => group.versionCount > 1,
          onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)),
        }}
        rowSelection={
          batch.selecting
            ? {
                selectedRowKeys: groups
                  .filter(
                    (group) => isGroupBatchSelectable(group) && batch.isSelected(group.latest.id),
                  )
                  .map((group) => group.key),
                getCheckboxProps: (group) => ({
                  disabled: !isGroupBatchSelectable(group),
                  title: isGroupBatchSelectable(group)
                    ? undefined
                    : t("resumes.list.groupSelectDisabled"),
                }),
                onChange: (keys) => {
                  const ids = keys
                    .map((key) => groupByKey.get(String(key)))
                    .filter((group): group is ResumeGroup => group !== undefined)
                    .map((group) => group.latest.id);
                  batch.setSelected(ids);
                },
              }
            : undefined
        }
        pagination={{
          current: page,
          pageSize,
          total: totalGroups,
          showSizeChanger: true,
          showTotal: (total) => t("resumes.list.total", { total }),
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />
    </div>
  );
}
