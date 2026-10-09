/** 简历列表表格：收藏/标题/目标岗位/来源/模型/备注/美化拓展/时间/操作列 + 行右键菜单。
 *
 * 受控组件——数据、批量选择、收藏防连点与各入口的打开动作全部由 ResumesPage 经 props
 * 传入（navigate 留页面）；行操作清单（primary/secondary/context）随表格一起下沉。
 */
import { CheckSquareOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { Button, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { memo, useMemo } from "react";
import type { HTMLAttributes } from "react";
import type { Dispatch, SetStateAction } from "react";
import { RowActions, RowContextMenu, type RowActionItem } from "../../components/common/RowActions";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { RESUME_ENHANCEMENT_LEVELS, enhancementLevelDescription } from "../../config";
import type { Page } from "../../types";
import type { ResumeBrief } from "../../types";
import type { DiffViewData } from "../../types/resumeFieldDiff";
import { formatDateTime } from "../../utils/format";

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
      confirm: "确定删除这条记录？",
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
  navigate,
}: Props) {
  /**
   * 行操作分两层，两层**不重叠**：主操作是行上的蓝色链接，「更多」里只放其余操作。
   * 菜单里再出现一遍「预览 / 导出」会让人以为那是另一个入口。
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

  const secondaryActions = (record: ResumeBrief): RowActionItem[] =>
    secondaryActionsFor(record, actionDeps);

  /** rowKey → record：行渲染 O(1) 取值，替代对 items 的逐条 find（O(n²)）。 */
  const itemsByRowKey = useMemo(() => {
    const map = new Map<string, ResumeBrief>();
    for (const item of data?.items ?? []) map.set(String(item.id), item);
    return map;
  }, [data]);

  const columns: ColumnsType<ResumeBrief> = [
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
            icon={record.favorite ? <StarFilled style={{ color: "#d89614" }} /> : <StarOutlined />}
            onClick={() => void toggleFavorite(record)}
          />
        </Tooltip>
      ),
    },
    {
      title: "简历标题",
      dataIndex: "title",
      render: (_, record) => (
        <Button type="link" className="table-text-link" onClick={() => setPreviewId(record.id)}>
          {record.title}
        </Button>
      ),
    },
    {
      title: "目标岗位",
      key: "job",
      render: (_, record) => (
        <Space>
          {record.job_id ? (
            <Button
              type="link"
              className="table-text-link"
              onClick={() => navigate(`/jobs?job_id=${record.job_id}`)}
            >
              <Tag color="blue">{record.job_title || "-"}</Tag>
            </Button>
          ) : (
            // 无岗位记录的 job_title 存的是求职意向，不能当岗位名显示，
            // 否则通用简历看起来就是一份岗位简历。
            <>
              <Tooltip title="不关联岗位、可投递多个方向的简历">
                <Tag color="purple">通用简历</Tag>
              </Tooltip>
              {record.job_title && <Tag>求职意向：{record.job_title}</Tag>}
            </>
          )}
          {record.company && <Tag>{record.company}</Tag>}
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
      render: (value) => formatDateTime(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 150,
      render: (_, record) => (
        <RowActions
          primary={primaryActions(record)}
          more={secondaryActions(record)}
          // 多选模式下收起行内操作，避免勾选与单行操作互相干扰。
          disabled={batch.selecting}
        />
      ),
    },
  ];

  return (
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
    />
  );
}
