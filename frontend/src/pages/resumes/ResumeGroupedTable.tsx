// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心的「按岗位折叠」视图（CR-33 + 2026-11-26 方案 A 排版重做 + R1 三态整组）。
 *
 * 一行 = 一个岗位（或一份通用简历）。行上给出用户判断"要不要展开"的三个事实：
 * 岗位名 · 版本数、最近更新时间、这个岗位投递过几次。版本本身仍然是一等公民：
 * 展开后的收藏/预览/重命名/备注/对比/删除全都带各自的 `resume_id`。
 *
 * ## 组行勾选 = 整组全部版本（2026-11-26 三态，推翻 CR-33 的"不可勾选"）
 *
 * 勾选框必须有个确定的语义。"勾一行 = 删一组"是这个方案的原罪，所以换了个语义：
 * **勾一行 = 勾上这一组的每一份简历**——批量删除仍然按份数执行、仍走二次确认，
 * 但用户不必先展开才能选中这个岗位的简历。
 *
 * 三态由"组内已选份数"自然推出：
 * - 全选 → 组行打勾（`selectedRowKeys` 命中，antd 自己加 `ant-table-row-selected`）；
 * - 部分 → 组行半选（`getCheckboxProps.indeterminate`），**不加底色**（半选只是过程态，
 *   给底色会与"全选"撞衫——这正是 R1 第三条"组行看着像被选中"的来源）；
 * - 未选 → 空。
 * 版本行的勾选框直接改 `batch`，组行状态随之反推，不需要额外同步。
 *
 * ## 跨页勾选不丢（R4）
 *
 * `preserveSelectedRowKeys: true` 是前提，但**不够**：`rowSelection.onChange` 只回传
 * dataSource 里存在的 key，`setSelected(keys)` 一把替换会把别的页的选区扔掉。
 * 所以这里读 `onSelect` / `onSelectAll` 的**增量**（哪一组、变勾还是变不勾），
 * 用 `batch.selectPage(ids, checked)` 合并——它读的是函数式 `setState`，不受闭包
 * 里的旧 `selectedIds` 影响。
 *
 * ## 展开动画（240ms，自己控制卸载时机）
 *
 * antd 一收起就卸载 `expandedRowRender`，`grid-template-rows: 0fr → 1fr` 的收起动画
 * 永远跑不完。所以传给 antd 的 `expandedRowKeys` 是"展开中 ∪ 正在收起"的
 * `renderedKeys`：收起的 key 先留在里面，等 `transitionend`（兜底 300ms 定时器）
 * 之后再摘掉。`showExpandColumn: false`：44px 的箭头列是首列表头那格空槽的来源，
 * 箭头改由身份格自绘（带 `aria-expanded` / `aria-controls`）。
 *
 * ## 排序：本地组级，与服务端排序并存（别合并）
 *
 * 列头三态只改 `groupSortState`（`utils/groupSort`），**不**改数据层的 fetch sort。
 * 组级排序必须是在已加载数据上再排一层——服务端没有"按组"这个维度。
 */
import { Table } from "antd";
import type { TableColumnsType } from "antd";
import type { SortOrder } from "antd/es/table/interface";
import type { Dispatch, HTMLAttributes, ReactNode, SetStateAction } from "react";
import { useCallback, useMemo, useState } from "react";
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
import { groupResumeIds } from "../../features/resume/list/resumeGroups";
import ResumeVersionList, { GROUP_SELECTION_COLUMN_WIDTH } from "./ResumeVersionList";
import { singleRowActions, groupRowActions, type GroupMenuContext } from "./resumeGroupMenu";
import type { RowActionDeps } from "./resumeTableActions";
import { buildGroupedColumns, groupVersionsRegionId } from "./resumeGroupedColumns";
import "./resumeGroupTable.css";

/** 展开/收起过渡时长，必须与 `resumeGroupTable.css` 的 `--rf-group-expand-duration` 一致。 */
const EXPAND_DURATION_MS = 240;
/** 兜底清理：`transitionend` 在"元素已不可见/被裁剪"等情况下可能不派发。 */
const EXPAND_FALLBACK_MS = EXPAND_DURATION_MS + 60;

/**
 * 展开区域的裁剪容器（R1 第六条）。
 *
 * ## 为什么用 `animation` 而不是 `transition`
 *
 * antd 在 `expandedRowKeys` 变化时会重建展开行（节点是新的），于是"把 `data-state`
 * 从 open 改成 closed、让 transition 跑 1fr → 0fr"在**收起**方向永远做不到：新节点
 * 一出生就是 closed，没有前一帧可比（实测高度 402 → 0 只用一帧）。改成两条 keyframes
 * （进场 0fr→1fr、出场 1fr→0fr，`both` 保持终值）就与"节点是否重建"无关了——这也是
 * 实机采样能拿到中间值的原因（0 → 21 → 65 → 126 … → 402）。
 *
 * 卸载时机由父组件的 `closingKeys` 接管：`animationend` 到了才摘 key，另有一个定时器
 * 兜底（`animationend` 在 jsdom、或元素被裁剪/动画被禁用时都不保证派发）。
 */
function VersionsRegion({
  regionId,
  open,
  onClosed,
  children,
}: {
  regionId: string;
  open: boolean;
  onClosed: () => void;
  children: ReactNode;
}) {
  return (
    <div
      id={regionId}
      className="rf-group-versions-clip"
      data-state={open ? "open" : "closed"}
      // 收起动画期间内容仍在 DOM 里：读屏不该再读它。
      aria-hidden={open ? undefined : true}
      onAnimationEnd={(event) => {
        // 只认自己那条：内层子元素的动画会冒泡上来。
        if (event.target !== event.currentTarget) return;
        if (!open) onClosed();
      }}
    >
      <div className="rf-group-versions-inner">{children}</div>
    </div>
  );
}

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
  /** 页面持有的 `useNavigate`：岗位名不再是链接，跳转只走右键菜单的 `open_job`。 */
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
      // 岗位跳转（R25）：岗位名本身是纯文本，去岗位广场只走菜单。
      openJob: (jobId: number) => navigate(`/jobs?job_id=${jobId}`),
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
      navigate,
    ],
  );

  const groupByKey = useMemo(() => {
    const map = new Map<string, ResumeGroup>();
    for (const group of groups) map.set(group.key, group);
    return map;
  }, [groups]);

  const expandedSet = useMemo(() => new Set(expandedKeys), [expandedKeys]);

  /**
   * 正在收起的组：已经不在 `expandedKeys` 里，但要多留一会儿让动画跑完。
   * 只增不减的数组会被这里按 `expandedKeys` 过滤，重复展开也不会残留。
   */
  const [closingKeys, setClosingKeys] = useState<string[]>([]);
  const renderedKeys = useMemo(() => {
    const union = new Set(expandedKeys);
    for (const key of closingKeys) if (!union.has(key)) union.add(key);
    return [...union];
  }, [expandedKeys, closingKeys]);

  // 兜底卸载：`animationend` 不派发（jsdom、动画被禁用、`prefers-reduced-motion`）时
  // 也不能让一行隐藏的内容永久挂在 DOM 里——那会让键盘 Tab 走进收起的内容。
  //
  // 定时器**在点击处登记**，不放在 `useEffect` 里：那张表在动画期间会被父级
  // 重渲染（分组数据每条消息都可能换一个数组引用），effect 的清理函数会把还没到期的
  // 定时器一并取消，于是收起的行永远不卸载（实测：收起后 1.6s 仍在 DOM 里）。
  const scheduleClosing = useCallback((key: string) => {
    window.setTimeout(() => {
      setClosingKeys((current) => current.filter((item) => item !== key));
    }, EXPAND_FALLBACK_MS);
  }, []);

  const toggleGroup = useCallback(
    (key: string) => {
      const isOpen = expandedKeys.includes(key);
      if (isOpen) {
        setClosingKeys((current) => (current.includes(key) ? current : [...current, key]));
        setExpandedKeys(expandedKeys.filter((item) => item !== key));
        scheduleClosing(key);
        return;
      }
      setExpandedKeys([...expandedKeys, key]);
    },
    [expandedKeys, setExpandedKeys, scheduleClosing],
  );

  const finishClosing = useCallback((key: string) => {
    setClosingKeys((current) => current.filter((item) => item !== key));
  }, []);

  /**
   * 行菜单上下文：组行 / 单版本行 / 版本行三处共用同一份（`resumeGroupMenu` 按行类型
   * 分派）。`openJob` 是岗位跳转的唯一出口（R25）。
   */
  const menuCtx = useMemo<GroupMenuContext>(
    () => ({
      deps,
      toast,
      enterSelecting: batch.enterSelecting,
      // 右键「批量选择」= 进多选 + 把这一行勾上（R3 的验收口径）。
      selectResume: (id: number) => batch.selectPage([id], true),
      toggleGroup,
      openJob: (jobId: number) => navigate(`/jobs?job_id=${jobId}`),
      isExpanded: (key: string) => expandedSet.has(key),
    }),
    [deps, toast, batch.enterSelecting, batch.selectPage, toggleGroup, navigate, expandedSet],
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
        setPreviewId: (id: number) => setPreviewId(id),
        toggleGroup,
        isExpanded: (key: string) => expandedSet.has(key),
        narrow,
      }),
    [
      deps,
      toast,
      batch,
      menuCtx,
      groupSortState,
      onGroupSortChange,
      setPreviewId,
      toggleGroup,
      expandedSet,
      narrow,
    ],
  );

  /**
   * 组行三态（R1）。判据只看**版本 id**：勾选框代表这一组每一份简历，
   * 与"这个组展开没展开"无关。
   */
  const selectionState = useMemo(() => {
    const selected = batch.selectedIds;
    const full: string[] = [];
    const partial = new Set<string>();
    for (const group of groups) {
      const ids = groupResumeIds(group);
      let hit = 0;
      for (const id of ids) if (selected.has(id)) hit += 1;
      if (ids.length > 0 && hit === ids.length) full.push(group.key);
      else if (hit > 0) partial.add(group.key);
    }
    return { full, partial };
  }, [groups, batch.selectedIds]);

  /**
   * 选区摘要（R1 第四条）：批量栏说"已选 N 项"，这张表补一句"其中几个是整组岗位带上来的"
   * ——用户勾一行却看到计数从 1 跳到 11，这句话就是解释。
   *
   * 只数**多版本组**（"整组岗位"= 同一个岗位的每一版都进来了），而且只数当前页：
   * 别的页的组结构本地拿不到，硬凑一个数字不如不说。没有多版本组时退回纯份数。
   */
  const wholeGroupCount = selectionState.full.filter(
    (key) => (groupByKey.get(key)?.versionCount ?? 0) > 1,
  ).length;
  const selectionSummary =
    wholeGroupCount > 0
      ? t("resumesPage.list.group.selectionSummary", {
          count: batch.selectedCount,
          groups: wholeGroupCount,
        })
      : t("resumesPage.list.group.selectionSummaryPlain", { count: batch.selectedCount });

  return (
    <div className="resume-group-table">
      <Table
        rowKey="key"
        size="middle"
        /**
         * 定宽布局：默认的 `auto` 会把每一列撑到它的 min-content，而身份列是
         * `white-space: nowrap`（要省略号），min-content 就是整串岗位名——940 视口
         * 实测把身份列撑到 653，四列合计 968 > 容器 834，「操作」列被裁掉半截。
         * `fixed` 让它严格按 `GROUP_COLUMN_WIDTHS` 分配，身份列独占剩余空间。
         */
        tableLayout="fixed"
        loading={loading}
        columns={columns}
        dataSource={groups}
        /**
         * 分区标题（R1 第三条）：多版本组行 = 白底 + 上分隔线，蓝底与左竖条**只给
         * 选满的行**（由 antd 自己的 `ant-table-row-selected` 提供，见 CSS）。
         */
        rowClassName={(group) => (group.versionCount > 1 ? "rf-group-row" : "rf-group-single")}
        /**
         * 选区摘要（R1 第四条）：批量栏的「N 份」由页面持有，而"其中几个是整组带上来的"
         * 只有这张表知道。串成一句放在表头上方，与批量栏同一视线。
         */
        title={
          batch.selecting && batch.selectedCount > 0
            ? () => <div className="rf-group-selection-summary">{selectionSummary}</div>
            : undefined
        }
        components={{
          body: {
            /**
             * 整行右键：按行 key 分派。多版本组行给组级三项；单版本组行给与平铺行
             * 完全一致的一整份清单；选择模式下多版本组行也给批量动作的替代——它现在
             * 可以被勾选，右键菜单里放"对所选做什么"不再自相矛盾。
             */
            row: (props: HTMLAttributes<HTMLTableRowElement>) => {
              const rowKey = String((props as { "data-row-key"?: string })["data-row-key"] ?? "");
              const group = groupByKey.get(rowKey);
              if (!group) return <tr {...props} />;
              if (group.versionCount > 1) {
                if (batch.selecting) {
                  return (
                    <RowContextMenu items={batchActions}>
                      <tr {...props} />
                    </RowContextMenu>
                  );
                }
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
          /** 独立的 44px 箭头列已去掉：它是首列表头那格空槽的来源（R1 第五条）。 */
          showExpandColumn: false,
          expandedRowKeys: renderedKeys,
          expandedRowRender: (group) => (
            <VersionsRegion
              regionId={groupVersionsRegionId(group.key)}
              open={expandedSet.has(group.key)}
              onClosed={() => finishClosing(group.key)}
            >
              <ResumeVersionList
                group={group}
                deps={deps}
                toast={toast}
                menuCtx={menuCtx}
                selecting={batch.selecting}
                batch={batch}
                narrow={narrow}
                favoriteResumeId={favoriteResumeId}
                toggleFavorite={toggleFavorite}
              />
            </VersionsRegion>
          ),
        }}
        rowSelection={
          batch.selecting
            ? {
                /**
                 * 跨页保留（R4）：只要这一条，antd 才不会在勾选本页某行时把别的页的
                 * key 从内部状态里清掉。`selectedRowKeys` 仍是我们算的"选满的组"。
                 */
                preserveSelectedRowKeys: true,
                /** 勾选列宽写死：版本行的栅格要照着它让出一格（见 `ResumeVersionList`）。 */
                columnWidth: GROUP_SELECTION_COLUMN_WIDTH,
                selectedRowKeys: selectionState.full,
                getCheckboxProps: (group) => ({
                  // 半选只用勾选框自己的半选态，**不加**底色（R1 第六条）。
                  indeterminate: selectionState.partial.has(group.key),
                  title: t("resumesPage.list.group.selectWhole", { count: group.versionCount }),
                }),
                // 增量合并：`onSelect` 告诉我们"哪一组、变勾还是变不勾"，
                // `selectPage` 在函数式 setState 里改，不受闭包旧值影响。
                onSelect: (group, selected) => {
                  batch.selectPage(groupResumeIds(group), selected);
                },
                onSelectAll: (selected, _rows, changeRows) => {
                  // 取消全选时要清**整页**：半选的组不在 `changeRows` 里，
                  // 只清 changeRows 会留下一堆"取消全选后还勾着几份"的残局。
                  const targets = selected ? changeRows : groups;
                  batch.selectPage(targets.flatMap(groupResumeIds), selected);
                },
              }
            : undefined
        }
        pagination={{
          current: page,
          pageSize,
          total: totalGroups,
          showSizeChanger: true,
          // `total` 是**组数**：只写"共 N 条记录"会与用户认知（22 份简历）对不上。
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
