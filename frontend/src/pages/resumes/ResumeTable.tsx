// SPDX-License-Identifier: Apache-2.0
/** 简历列表表格：收藏/标题/目标岗位/来源/模型/备注/美化拓展/时间/操作列 + 行右键菜单。
 *
 * 受控组件——数据、批量选择、收藏防连点与各入口的打开动作全部由 ResumesPage 经 props
 * 传入（navigate 留页面）；行操作清单（primary/secondary/context）随表格一起下沉。
 */
import { CheckSquareOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { SortOrder } from "antd/es/table/interface";
import { memo, useEffect, useMemo, useRef } from "react";
import type { HTMLAttributes } from "react";
import type { Dispatch, SetStateAction } from "react";
import { RowActions, RowContextMenu, type RowActionItem } from "../../components/common/RowActions";
import { TRASH_RECOVERY_NOTE } from "../../components/common/rowActionMenu";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { RESUME_ENHANCEMENT_LEVELS, enhancementLevelDescription } from "../../config";
import type { Page } from "../../types";
import type { ResumeBrief } from "../../types";
import type { DiffViewData } from "../../types/resumeFieldDiff";
import { formatDateTime } from "../../utils/format";
import {
  nextSortState,
  sortDirectionsFor,
  sortOrderFor,
  type ResumeSortState,
} from "../../utils/resumeSort";

/** 行操作动作的依赖集：全部是 setState 与 useCallback 回调，引用跨渲染稳定，
 * 行组件据此做 memo——页面其它 state 变化时已渲染的行不必重跑。 */
interface RowActionDeps {
  setPreviewId: (id: number | null) => void;
  setRenameTarget: (target: ResumeBrief | null) => void;
  setRenameValue: (value: string) => void;
  setNoteTarget: (target: ResumeBrief | null) => void;
  setNoteValue: (value: string) => void;
  setDiffBase: (target: ResumeBrief | null) => void;
  setDiffAgainstId: (id: number | null) => void;
  setDiffResult: (result: DiffViewData | null) => void;
  toggleFavorite: (record: ResumeBrief) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

function primaryActionsFor(record: ResumeBrief, deps: RowActionDeps): RowActionItem[] {
  return [{ key: "preview", label: "预览 / 导出", onClick: () => deps.setPreviewId(record.id) }];
}

function secondaryActionsFor(record: ResumeBrief, deps: RowActionDeps): RowActionItem[] {
  return [
    {
      key: "rename",
      label: "重命名",
      onClick: () => {
        deps.setRenameTarget(record);
        deps.setRenameValue(record.title);
      },
    },
    {
      key: "note",
      label: "编辑备注",
      onClick: () => {
        deps.setNoteTarget(record);
        deps.setNoteValue(record.note ?? "");
      },
    },
    {
      key: "diff",
      label: "版本对比",
      onClick: () => {
        deps.setDiffBase(record);
        deps.setDiffAgainstId(null);
        deps.setDiffResult(null);
      },
    },
    {
      key: "favorite",
      label: record.favorite ? "取消收藏" : "收藏",
      onClick: () => void deps.toggleFavorite(record),
    },
    {
      key: "delete",
      label: "删除",
      danger: true,
      confirm: "删除这份简历？",
      confirmBody: `这份简历${TRASH_RECOVERY_NOTE}`, // i18n-ok: 正文补「对象」段（§4.4 三段式），后果句引用 TRASH_RECOVERY_NOTE 常量，不重写
      onClick: () => void deps.remove(record.id),
    },
  ];
}

/** 右键菜单顶部的「批量选择」入口：工具栏按钮已收进这里（R8），点它进入多选模式。 */
function batchSelectAction(enterSelecting: () => void): RowActionItem {
  return {
    key: "batch_select",
    label: "批量选择",
    icon: <CheckSquareOutlined />,
    onClick: enterSelecting,
  };
}

interface ContextMenuRowProps extends HTMLAttributes<HTMLTableRowElement> {
  record?: ResumeBrief;
  /** 批量选择模式下右键菜单收起，与行内操作保持一致。 */
  selecting: boolean;
  /** 进入多选模式（「批量选择」菜单项的动作），页面传入的 useCallback 稳定引用。 */
  enterSelecting: () => void;
  deps: RowActionDeps;
}

/** 带右键菜单的表格行：props 全是稳定引用（antd 的 tr 属性 + record + deps），
 * 用 React.memo 让页面级 state 变化不触发整表行级重渲染。 */
const ContextMenuRow = memo(function ContextMenuRow({
  record,
  selecting,
  enterSelecting,
  deps,
  ...rest
}: ContextMenuRowProps) {
  if (!record) return <tr {...rest} />;
  return (
    <RowContextMenu
      items={
        selecting
          ? []
          : [
              batchSelectAction(enterSelecting),
              ...primaryActionsFor(record, deps),
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
}: Props) {
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
    node.setAttribute("aria-label", "简历列表（可横向滚动）");
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
  const sortTooltip = (label: string) => ({ title: `按${label}排序` });

  const columns: TableColumnsType<ResumeBrief> = [
    {
      title: "收藏",
      key: "favorite",
      width: 64,
      align: "center",
      render: (_, record) => (
        <Tooltip title={record.favorite ? "取消收藏" : "收藏简历"}>
          <Button
            type="text"
            aria-label={record.favorite ? "取消收藏简历" : "收藏简历"}
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
      title: "简历标题",
      dataIndex: "title",
      // 1080px 宽下无宽度的标题列会被压到约一个字宽：给一个下限再让它在窄屏内省略。
      width: 220,
      sorter: true,
      sortOrder: sortOrderFor("title", sortState),
      sortDirections: sortDirectionsFor("title"),
      showSorterTooltip: sortTooltip("简历标题"),
      // 自定义 render 返回的是按钮，列级 ellipsis 截不到按钮里的文字（按钮自带样式），
      // 所以省略号由按钮自己带（见下）；这里关掉 antd 的原生 title，避免和 Tooltip 弹两次。
      ellipsis: { showTitle: false },
      render: (_, record) => (
        <Tooltip title={record.title} placement="topLeft">
          <Button
            type="link"
            className="table-text-link"
            style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}
            onClick={() => setPreviewId(record.id)}
          >
            {record.title}
          </Button>
        </Tooltip>
      ),
    },
    {
      title: "目标岗位",
      key: "job",
      // T3：这一列原本没有宽度，长岗位名/公司名会把整表撑宽，其它列被挤成一字宽。
      // 固定 200 + 列级 ellipsis（整表切 table-layout: fixed）+ 单元格内 Tag 自己省略。
      width: 200,
      sorter: true,
      sortOrder: sortOrderFor("job", sortState),
      sortDirections: sortDirectionsFor("job"),
      showSorterTooltip: sortTooltip("目标岗位"),
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
              <Tooltip title="不关联岗位、可投递多个方向的简历">
                <Tag color="purple">通用简历</Tag>
              </Tooltip>
              {record.job_title && (
                <Tag className="resume-job-tag">求职意向：{record.job_title}</Tag>
              )}
            </>
          )}
          {record.company && <Tag className="resume-company-tag">{record.company}</Tag>}
        </Space>
      ),
    },
    {
      title: "来源",
      dataIndex: "source",
      width: 100,
      render: (value: ResumeBrief["source"]) => (
        <Tag color={value === "manual" ? "purple" : "blue"}>
          {value === "manual" ? "用户编写" : "AI 生成"}
        </Tag>
      ),
    },
    { title: "模型", dataIndex: "model", width: 150, render: (value) => value || "-" },
    {
      title: "备注",
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
      title: "美化拓展",
      key: "enhancement",
      width: 110,
      render: (_, record) => {
        if (!record.enhancement_enabled)
          return <Typography.Text type="secondary">未开启</Typography.Text>;
        const level = RESUME_ENHANCEMENT_LEVELS.find(
          (item) => item.value === record.enhancement_level,
        );
        // "均衡"这种词单看说明不了什么；悬停给出这一档到底做了什么——和生成弹窗里
        // 用的是同一份文案，通用简历的"深度"档说法也由它区分。
        return (
          <Tooltip
            title={
              record.enhancement_level
                ? enhancementLevelDescription(record.enhancement_level, !record.job_id)
                : "已开启经历美化拓展"
            }
          >
            <Tag color="green">{level?.label ?? "已开启"}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      width: 160,
      sorter: true,
      sortOrder: sortOrderFor("created_at", sortState),
      sortDirections: sortDirectionsFor("created_at"),
      showSorterTooltip: sortTooltip("创建时间"),
      render: (value) => formatDateTime(value),
    },
    {
      // 默认排序就是「最近修改」，这一列让排序结果可解释：改完备注/版式后时间会往前走。
      title: "最近修改",
      dataIndex: "updated_at",
      width: 160,
      sorter: true,
      sortOrder: sortOrderFor("updated_at", sortState),
      sortDirections: sortDirectionsFor("updated_at"),
      showSorterTooltip: sortTooltip("最近修改"),
      render: (value: string | null | undefined) =>
        value ? formatDateTime(value) : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
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
          showTotal: (total) => `共 ${total} 条记录`,
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
