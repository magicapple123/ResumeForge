// SPDX-License-Identifier: Apache-2.0
/** 简历列表表格：收藏/标题/目标岗位/来源/模型/备注/美化拓展/时间/操作列 + 行右键菜单。
 *
 * 受控组件——数据、批量选择、收藏防连点与各入口的打开动作全部由 ResumesPage 经 props
 * 传入（navigate 留页面）；行操作清单（primary/secondary/context）随表格一起下沉。
 */
import { StarFilled, StarOutlined } from "@ant-design/icons";
import { App, Button, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { SortOrder } from "antd/es/table/interface";
import { memo, useEffect, useMemo, useRef } from "react";
import type { HTMLAttributes } from "react";
import type { Dispatch, SetStateAction } from "react";
import { RowActions, RowContextMenu, type RowActionItem } from "../../components/common/RowActions";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { RESUME_ENHANCEMENT_LEVELS, enhancementLevelDescriptionKey } from "../../config";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { Page, ResumeBrief } from "../../types";
import type { DiffViewData } from "../../types/resumeFieldDiff";
import { formatDateTime } from "../../utils/format";
import {
  nextSortState,
  sortDirectionsFor,
  sortOrderFor,
  type ResumeSortState,
} from "../../utils/resumeSort";
import { copyMenuFor } from "./resumeRowCopyActions";
import {
  batchSelectAction,
  primaryActionsFor,
  secondaryActionsFor,
  type RowActionDeps,
} from "./resumeTableActions";

interface ContextMenuRowProps extends HTMLAttributes<HTMLTableRowElement> {
  record?: ResumeBrief;
  /** 批量选择模式下右键菜单收起，与行内操作保持一致。 */
  selecting: boolean;
  /** 进入多选模式（「批量选择」菜单项的动作），页面传入的 useCallback 稳定引用。 */
  enterSelecting: () => void;
  /** 多选态的整行右键菜单：与工具条的「批量操作」下拉同一组动作。 */
  batchActions: RowActionItem[];
  deps: RowActionDeps;
}

/** 带右键菜单的表格行：props 全是稳定引用（antd 的 tr 属性 + record + deps），
 * 用 React.memo 让页面级 state 变化不触发整表行级重渲染。 */
const ContextMenuRow = memo(function ContextMenuRow({
  record,
  selecting,
  enterSelecting,
  batchActions,
  deps,
  ...rest
}: ContextMenuRowProps) {
  // 必须在提前 return 之前调用（Hook 顺序），`record` 为空时用不上也无妨。
  const { message } = App.useApp();
  useLocale();
  if (!record) return <tr {...rest} />;
  return (
    <RowContextMenu
      items={
        selecting
          ? batchActions
          : [
              batchSelectAction(enterSelecting),
              ...primaryActionsFor(record, deps),
              // 「复制」子菜单：把标题 / 目标岗位 / 公司 / 备注 / 整行拿出去（贴招聘表单、
              // 发内推、粘进表格）。它是一次性的取数动作，不该占列表宽度，所以只在右键里。
              copyMenuFor(record, message),
              ...secondaryActionsFor(record, deps),
            ]
      }
    >
      <tr {...rest} />
    </RowContextMenu>
  );
});

interface Props {
  data: Page<ResumeBrief> | undefined;
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
  /** 当前排序状态（列头箭头的唯一来源）。 */
  sortState: ResumeSortState;
  /** 列头三态排序的回调（页面负责 setPage(1) 与 URL 写回）。 */
  onSortChange: (next: ResumeSortState) => void;
  /** 跳转岗位广场（保留在页面里的 useNavigate）。 */
  navigate: (path: string) => void;
  /** 多选态右键菜单的批量动作（批量删除 / 批量导出）。 */
  batchActions: RowActionItem[];
}

export default function ResumeTable({
  data,
  loading,
  batch,
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
  batchActions,
}: Props) {
  useLocale(); // 本组件用模块级 t()，必须订阅语言变化，否则切语言后列头与菜单不重渲染
  const tableWrapRef = useRef<HTMLDivElement>(null);

  // 列宽加起来会超过容器（标题固定 220 + 最近修改列），antd 因此把表格放进一个
  // 横向滚动的 `.ant-table-content` 里——但它不给这个容器 tabindex。于是键盘用户
  // 既滚不到被裁掉的列，也拿不到焦点（WCAG 2.1.1，axe 的 scrollable-region-focusable）。
  // 这里不去改 antd 内部结构，只把那个已经存在的滚动容器补成可聚焦区域；
  // 不传依赖数组是有意的：翻页/换数据都会重建节点，每次渲染后确认一次即可。
  useEffect(() => {
    const node = tableWrapRef.current?.querySelector<HTMLElement>(".ant-table-content");
    if (!node || node.hasAttribute("tabindex")) return;
    node.tabIndex = 0;
    node.setAttribute("role", "region");
    node.setAttribute("aria-label", t("resumes.list.scrollRegion"));
  });

  /**
   * 主操作平铺在行上；其余操作（重命名/备注/对比/收藏/删除）只走整行右键菜单
   * （三点「更多」下拉已移除），菜单里不重复「预览 / 导出」。
   * 动作定义在模块级 builder 里（ContextMenuRow 复用同一份），这里只做绑定。
   */
  const actionDeps = useMemo<RowActionDeps>(
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

  const primaryActions = (record: ResumeBrief): RowActionItem[] =>
    primaryActionsFor(record, actionDeps);

  /** rowKey → record：行渲染 O(1) 取值，替代对 items 的逐条 find（O(n²)）。 */
  const itemsByRowKey = useMemo(() => {
    const map = new Map<string, ResumeBrief>();
    for (const item of data?.items ?? []) map.set(String(item.id), item);
    return map;
  }, [data]);

  /**
   * 列头排序（T2）：排序在服务端做（本地排序在分页下必错），这里只把"点了哪一列、
   * 什么方向"翻译成页面状态。四列的键分别是 title / job(job_title) / created / updated。
   *
   * 提示文案（项 3 / D3）只说"这一列按什么排"，三态机制由表头箭头自解释。原来的
   * "点击排序，再点反向，第三次取消"讲的是**机制**，但用户在一列表头上的疑问是**语义**
   * （尤其"目标岗位"与"简历标题"容易混）。机制一眼可见，语义不写就没人知道，所以按列名生成。
   */
  const sortTooltip = (label: string) => ({ title: t("resumes.list.sort", { label }) });

  const columns: TableColumnsType<ResumeBrief> = [
    {
      title: t("resumes.list.column.favorite"),
      key: "favorite",
      width: 64,
      align: "center",
      render: (_, record) => (
        <Tooltip
          title={record.favorite ? t("resumes.list.unfavorite") : t("resumes.list.favoriteAdd")}
        >
          <Button
            type="text"
            aria-label={
              record.favorite ? t("resumes.list.favoriteRemove") : t("resumes.list.favoriteAdd")
            }
            loading={favoriteResumeId === record.id}
            disabled={favoriteResumeId !== null}
            icon={
              record.favorite ? (
                <StarFilled style={{ color: "var(--rf-favorite)" }} />
              ) : (
                <StarOutlined />
              )
            }
            onClick={() => void toggleFavorite(record)}
          />
        </Tooltip>
      ),
    },
    {
      title: t("resumes.list.column.title"),
      dataIndex: "title",
      // 1080px 宽下无宽度的标题列会被压到约一个字宽：给一个下限再让它在窄屏内省略。
      width: 220,
      sorter: true,
      sortOrder: sortOrderFor("title", sortState),
      sortDirections: sortDirectionsFor("title"),
      showSorterTooltip: sortTooltip(t("resumes.list.column.title")),
      // 自定义 render 返回的是按钮，列级 ellipsis 截不到按钮里的文字（按钮自带样式），
      // 所以省略号由按钮自己带（见下）；这里关掉 antd 的原生 title，避免再弹一次浏览器原生提示。
      ellipsis: { showTitle: false },
      // 标题本身**不再包 Tooltip**（2026-11 用户要求）：鼠标扫过列表时黑框会挡住相邻行，
      // 而"看完整标题"的诉求已经由点击打开预览满足。省略号仍在，长标题不撑破列宽。
      render: (_, record) => (
        <Button
          type="link"
          className="table-text-link resume-title-link"
          onClick={() => setPreviewId(record.id)}
        >
          {record.title}
        </Button>
      ),
    },
    {
      title: t("resumes.list.column.job"),
      key: "job",
      // T3：这一列原本没有宽度，长岗位名/公司名会把整表撑宽，其它列被挤成一字宽。
      // 固定 200 + 列级 ellipsis（整表切 table-layout: fixed）+ 单元格内 Tag 自己省略。
      width: 200,
      sorter: true,
      sortOrder: sortOrderFor("job", sortState),
      sortDirections: sortDirectionsFor("job"),
      showSorterTooltip: sortTooltip(t("resumes.list.column.job")),
      ellipsis: { showTitle: false },
      render: (_, record) => (
        <Space wrap size={[4, 4]}>
          {record.job_id ? (
            <Button
              type="link"
              className="table-text-link"
              onClick={() => navigate(`/jobs?job_id=${record.job_id}`)}
            >
              <Tag color="blue" className="resume-job-tag">
                {record.job_title || "-"}
              </Tag>
            </Button>
          ) : (
            // 无岗位记录的 job_title 存的是求职意向，不能当岗位名显示，
            // 否则通用简历看起来就是一份岗位简历。
            <>
              <Tooltip title={t("resumes.list.generalHint")}>
                <Tag color="purple">{t("resumes.list.general")}</Tag>
              </Tooltip>
              {record.job_title && (
                <Tag className="resume-job-tag">
                  {t("resumes.list.intent", { job: record.job_title })}
                </Tag>
              )}
            </>
          )}
          {record.company && <Tag className="resume-company-tag">{record.company}</Tag>}
        </Space>
      ),
    },
    {
      title: t("resumes.list.column.source"),
      dataIndex: "source",
      width: 100,
      render: (value: ResumeBrief["source"]) => (
        <Tag color={value === "manual" ? "purple" : "blue"}>
          {value === "manual" ? t("resumes.list.sourceManual") : t("resumes.list.sourceAi")}
        </Tag>
      ),
    },
    {
      title: t("resumes.list.column.model"),
      dataIndex: "model",
      width: 150,
      render: (value) => value || "-",
    },
    {
      title: t("resumes.list.column.note"),
      dataIndex: "note",
      width: 180,
      render: (value: string) =>
        value ? (
          <Typography.Text ellipsis={{ tooltip: value }} style={{ maxWidth: 180 }}>
            {value}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: t("resumes.list.column.enhancement"),
      key: "enhancement",
      width: 110,
      render: (_, record) => {
        if (!record.enhancement_enabled)
          return <Typography.Text type="secondary">{t("resumes.list.off")}</Typography.Text>;
        const level = RESUME_ENHANCEMENT_LEVELS.find(
          (item) => item.value === record.enhancement_level,
        );
        // "均衡"这种词单看说明不了什么；悬停给出这一档到底做了什么——和生成弹窗里
        // 用的是同一份文案，通用简历的"深度"档说法也由它区分。
        return (
          <Tooltip
            title={
              record.enhancement_level
                ? t(enhancementLevelDescriptionKey(record.enhancement_level, !record.job_id))
                : t("resumes.list.enhancementOn")
            }
          >
            <Tag color="green">{level ? t(level.labelKey) : t("resumes.list.on")}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: t("resumes.list.column.created"),
      dataIndex: "created_at",
      width: 160,
      sorter: true,
      sortOrder: sortOrderFor("created_at", sortState),
      sortDirections: sortDirectionsFor("created_at"),
      showSorterTooltip: sortTooltip(t("resumes.list.column.created")),
      render: (value) => formatDateTime(value),
    },
    {
      // 默认排序就是「最近修改」，这一列让排序结果可解释：改完备注/版式后时间会往前走。
      title: t("resumes.list.column.updated"),
      dataIndex: "updated_at",
      width: 160,
      sorter: true,
      sortOrder: sortOrderFor("updated_at", sortState),
      sortDirections: sortDirectionsFor("updated_at"),
      showSorterTooltip: sortTooltip(t("resumes.list.column.updated")),
      render: (value: string | null | undefined) =>
        value ? formatDateTime(value) : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: t("resumes.list.column.actions"),
      key: "actions",
      width: 150,
      // 钉在右侧：窄屏（≤1536）表格要横滚 216–660px，不钉住的话「预览 / 导出」整列在首屏外，
      // 而滚动条落在表体底部、首屏根本看不到（AUDIT P1-11）。
      fixed: "right",
      render: (_, record) => (
        // 三点「更多」下拉已移除：重命名/备注/对比/收藏/删除统一走整行右键菜单，
        // 键盘用户可用 ContextMenu 键 / Shift+F10 打开（见 RowContextMenu）。
        <RowActions
          primary={primaryActions(record)}
          // 多选模式下收起行内操作，避免勾选与单行操作互相干扰。
          disabled={batch.selecting}
        />
      ),
    },
  ];

  return (
    <div ref={tableWrapRef}>
      <Table
        rowKey="id"
        // 10 列宽度之和 = 64+220+200+100+150+180+110+160+160+150 = 1494。
        // 必须写 ≥ 各列之和：写小了会把 220 的标题列与 180 的备注列**压扁**（不是横滚）。
        scroll={{ x: 1494 }}
        columns={columns}
        dataSource={data?.items ?? []}
        loading={loading}
        rowSelection={
          batch.selecting
            ? {
                selectedRowKeys: [...batch.selectedIds],
                onChange: (keys) => batch.setSelected(keys as number[]),
              }
            : undefined
        }
        components={{
          body: {
            // 整行右键即可重命名、收藏或删除，不必先找到右侧的按钮。
            // record 用 Map 以 rowKey 查找（列表里逐条 find 是 O(n²)），行组件 memo 化。
            row: (props: HTMLAttributes<HTMLTableRowElement>) => {
              const rowKey = String((props as { "data-row-key"?: string })["data-row-key"] ?? "");
              return (
                <ContextMenuRow
                  {...props}
                  record={itemsByRowKey.get(rowKey)}
                  selecting={batch.selecting}
                  enterSelecting={batch.enterSelecting}
                  batchActions={batchActions}
                  deps={actionDeps}
                />
              );
            },
          },
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (total) => t("resumes.list.total", { total }),
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
        // 排序交给服务端：只把"排序动作"翻译成页面状态，翻页/筛选各走各的。
        onChange={(_pagination, _filters, sorter, extra) => {
          if (extra.action !== "sort") return;
          const active = Array.isArray(sorter) ? sorter[0] : sorter;
          const columnKey = String(active?.columnKey ?? active?.field ?? "");
          onSortChange(nextSortState(columnKey, active?.order as SortOrder | null | undefined));
        }}
      />
    </div>
  );
}
