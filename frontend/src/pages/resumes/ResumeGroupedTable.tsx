// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的「按岗位折叠」视图（CR-33 + 2026-11-26 方案 A 排版重做）。
 *
 * 一行 = 一个岗位（或一份通用简历）。行上给出用户判断"要不要展开"的三个事实：
 * 岗位名 · 版本数、最近更新时间、这个岗位投递过几次。版本本身仍然是一等公民：
 * 展开后的收藏/预览/重命名/备注/对比/删除全都带各自的 `resume_id`。
 *
 * 刻意**不提供**任何"作用于整组"的动作（组级收藏 / 组级删除）：折叠只是呈现方式，
 * 一旦让"整组"成为操作对象，用户就会在一行里删掉 N 份简历。多版本组因此也不可勾选
 * （见 `isGroupBatchSelectable`）。
 *
 * ## 排序：本地组级，与服务端排序并存（别合并）
 *
 * 列头三态只改 `groupSortState`（`utils/groupSort`），**不**改数据层的 fetch sort：
 * 平铺表格的列头排序用的是同一个 `useGroupedResumes`（见 `useResumesPageView` 文件头）。
 * 组级排序必须是在已加载数据上再排一层——服务端没有"按组"这个维度。
 *
 * ## 列与排版
 *
 * 列定义在 `resumeGroupedColumns.tsx`，列宽常量在 `resumeGroupLayout.ts`
 * （父表与版本行共用一份，改一次不会错位），样式在 `resumeGroupTable.css`。
 */
import { Table } from "antd";
import type { TableColumnsType } from "antd";
import type { SortOrder } from "antd/es/table/interface";
import type { HTMLAttributes } from "react";
import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { RowContextMenu, type RowActionItem } from "../../components/common/RowActions";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useToast } from "../../hooks/useToast";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { mqMax } from "../../theme/breakpoints";
import type { ResumeBrief } from "../../types";
import type { DiffViewData } from "../../types/resumeFieldDiff";
import { nextGroupSortState, type GroupSortState } from "../../utils/groupSort";
import type { ResumeGroup } from "../../features/resume/list/resumeGroups";
import { isGroupBatchSelectable } from "../../features/resume/list/resumeGroups";
import ResumeVersionList from "./ResumeVersionList";
import { singleRowActions, groupRowActions, type GroupMenuContext } from "./resumeGroupMenu";
import type { RowActionDeps } from "./resumeTableActions";
import { buildGroupedColumns } from "./resumeGroupedColumns";
import { GROUP_COLUMN_WIDTHS } from "./resumeGroupLayout";
import "./resumeGroupTable.css";

interface Props {
  /** 平铺视图的入参，由 ResumeResultList 原样透传；折叠视图按组渲染，用不到。 */
  data?: unknown;
  /** 多选态右键菜单的批量动作（批量删除 / 批量导出），与平铺表同一份。 */
  batchActions?: RowActionItem[];
  groups: ResumeGroup[];
  /** 组总数（折叠后的分页 total）。 */
  totalGroups: number;
  /** 已加载的简历条数（≤2000）：分页文案要同时说清"多少个岗位、多少份简历"。 */
  resumeCount?: number;
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
  /** 组级排序状态（本地，不进 URL）。 */
  groupSortState: GroupSortState;
  onGroupSortChange?: (next: GroupSortState) => void;
  navigate: (path: string) => void;
  /** 展开的组 key（`job:1` / `resume:2`），由页面持久化到 localStorage。 */
  expandedKeys: string[];
  setExpandedKeys: (keys: string[]) => void;
}

export default function ResumeGroupedTable({
  groups,
  totalGroups,
  resumeCount = 0,
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
  groupSortState,
  onGroupSortChange,
  navigate,
  expandedKeys,
  setExpandedKeys,
}: Props) {
  useLocale();
  const toast = useToast();
  /** 窄档与 `ResumeResultList` 同源（同一份断点表，见 `theme/breakpoints.ts`）。 */
  const narrow = useMediaQuery(mqMax("narrow"));

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
   * 行菜单上下文：组行 / 单版本行 / 版本行三处共用同一份（`resumeGroupMenu` 按行类型
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

  const columns: TableColumnsType<ResumeGroup> = useMemo(
    () =>
      buildGroupedColumns({
        deps,
        toast,
        batch,
        menuCtx,
        groupSortState,
        onGroupSortChange: onGroupSortChange ?? (() => undefined),
        navigate,
        setPreviewId: (id: number) => setPreviewId(id),
        toggleGroup,
        narrow,
      }),
    [
      deps,
      toast,
      batch,
      menuCtx,
      groupSortState,
      onGroupSortChange,
      navigate,
      setPreviewId,
      toggleGroup,
      narrow,
    ],
  );

  return (
    <div className="resume-group-table">
      <Table
        rowKey="key"
        size="middle"
        /**
         * 定宽布局（2026-11-26 窄档裁字的根因修复）：默认的 `auto` 会把每一列撑到它的
         * min-content，而身份列是 `white-space: nowrap`（要省略号），min-content 就是整串
         * 岗位名。940 视口下实测把身份列撑到 653，四列合计 968 > 容器 834，「操作」列
         * 被裁掉半截。`fixed` 让它严格按 `GROUP_COLUMN_WIDTHS` 分配，身份列独占剩余空间
         * 并由内部省略号收缩——见 `resumeGroupLayout.ts` 的说明。
         */
        tableLayout="fixed"
        loading={loading}
        columns={columns}
        dataSource={groups}
        // 多版本组行浅底 + 左侧色条（样式在 resumeGroupTable.css，作用域限本表）。
        rowClassName={(group) => (group.versionCount > 1 ? "rf-group-row" : "")}
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
                ? batchActions
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
          /**
           * 展开列必须显式定宽：`tableLayout: fixed` 下"没有宽度"的列会去瓜分剩余空间，
           * 而身份列正是没有宽度的那一列（它要吃掉剩余空间），两者会各分一半。
           */
          columnWidth: GROUP_COLUMN_WIDTHS.expand,
          expandedRowKeys: expandedKeys,
          expandedRowRender: (group) => (
            <ResumeVersionList
              group={group}
              deps={deps}
              toast={toast}
              menuCtx={menuCtx}
              selecting={batch.selecting}
              narrow={narrow}
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
          // `total` 是**组数**：只写"共 N 条记录"会与用户认知（22 份简历）对不上，
          // 所以两个数一起说清。
          showTotal: (total) =>
            t("resumesPage.list.totalGroups", { groups: total, resumes: resumeCount }),
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
        // 列头三态：只把"点了哪一列、什么方向"翻译成组级排序状态；分页走 pagination。
        onChange={(_pagination, _filters, sorter, extra) => {
          if (extra.action !== "sort") return;
          const active = Array.isArray(sorter) ? sorter[0] : sorter;
          const columnKey = String(active?.columnKey ?? active?.field ?? "");
          onGroupSortChange?.(nextGroupSortState(columnKey, active?.order as SortOrder | null));
        }}
      />
    </div>
  );
}
