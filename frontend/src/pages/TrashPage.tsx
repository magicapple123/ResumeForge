/**
 * 回收站：六类被删除的内容集中在这里，可以恢复，也可以彻底删除。
 *
 * 为什么值得单独一个页面：在这之前**所有删除都是不可逆的**，用户不敢删；现在删除只打一个
 * 时间戳，东西先落到这里。页面上有两条不能含糊的边界，它们在交互上被刻意做成不一样重：
 *
 * - **恢复**是安全的 → 一键就行，不用确认；
 * - **彻底删除**不可逆 → 必须二次确认，而且确认文案要说清"删了就找不回来了"。
 *
 * 每条都标出**类型**与**删除时间**：用户来这儿找的往往是"我前几天删的那个岗位"，
 * 只有标题没有时间等于让他一条条点开看。
 */
import { CheckSquareOutlined, DeleteOutlined, UndoOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Empty,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import PageSkeleton from "../components/common/PageSkeleton";
import type { ColumnsType } from "antd/es/table";
import type { TableRowSelection } from "antd/es/table/interface";
import type { HTMLAttributes } from "react";
import { useMemo, useState } from "react";
import { emptyTrash, getTrash, purgeTrashItem, restoreTrashItem } from "../api/trash";
import { RowContextMenu, type RowActionItem } from "../components/common/RowActions";
import { useApi } from "../hooks/useApi";
import type { TrashBatchItem, TrashItem } from "../types";

const ALL = "__all__";

/** 带右键菜单的表格行：菜单 = 批量选择（进多选）+ 恢复 + 彻底删除（不可逆，二次确认）。 */
interface ContextMenuRowProps extends HTMLAttributes<HTMLTableRowElement> {
  record?: TrashItem;
  /** 多选模式下右键菜单收起，与复选框选择互不打架。 */
  selectMode: boolean;
  onEnterSelectMode: () => void;
  onRestore: (row: TrashItem) => void;
  onPurge: (row: TrashItem) => void;
}

function ContextMenuRow({
  record,
  selectMode,
  onEnterSelectMode,
  onRestore,
  onPurge,
  ...rest
}: ContextMenuRowProps) {
  if (!record) return <tr {...rest} />;
  const items: RowActionItem[] = selectMode
    ? []
    : [
        {
          key: "batch_select",
          label: "批量选择",
          icon: <CheckSquareOutlined />,
          onClick: onEnterSelectMode,
        },
        {
          key: "restore",
          label: "恢复",
          icon: <UndoOutlined />,
          onClick: () => onRestore(record),
        },
        {
          key: "purge",
          label: "彻底删除",
          danger: true,
          icon: <DeleteOutlined />,
          // 确认文案要把后果说白：这是全应用唯一不可逆的动作。
          confirm: `「${record.title || record.type_label}」将被永久删除，无法恢复。`,
          onClick: () => onPurge(record),
        },
      ];
  return (
    <RowContextMenu items={items}>
      <tr {...rest} />
    </RowContextMenu>
  );
}

/** 把后端的 ISO 时间显示成"到分钟"的本地时间。 */
function deletedAtText(value: string | null): string {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 16);
}

export default function TrashPage() {
  const { message } = App.useApp();
  const [type, setType] = useState<string>(ALL);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  // 多选模式默认关闭：复选框列平时不占宽度，批量动作从「批量操作」显式进入，
  // 退出时一并清空已勾选的行，避免残留一个看不见的选择集。
  const [selectMode, setSelectMode] = useState(false);
  const { data, loading, error, reload } = useApi(
    () => getTrash(type === ALL ? {} : { type }),
    [type],
  );

  const labels = data?.labels ?? {};
  // 行右键菜单按 rowKey 查条目时依赖它（useMemo），包一层保证引用稳定。
  const items = useMemo(() => data?.items ?? [], [data]);
  const counts = data?.counts ?? {};

  const selectedItems = (): TrashBatchItem[] =>
    items
      .filter((item) => selectedKeys.includes(`${item.type}-${item.id}`))
      .map((item) => ({ type_key: item.type, id: item.id }));

  /** 批量恢复：逐条调恢复接口（全部 allSettled），有几条失败要如实说，不能只报成功数。 */
  const batchRestore = async () => {
    const chosen = selectedItems();
    if (chosen.length === 0) return;
    const results = await Promise.allSettled(
      chosen.map((item) => restoreTrashItem(item.type_key, item.id)),
    );
    const failed = results.filter((item) => item.status === "rejected").length;
    if (failed === 0) {
      message.success(`已恢复 ${chosen.length} 条`);
    } else {
      message.warning(`已恢复 ${chosen.length - failed} 条，${failed} 条恢复失败，请重试`);
    }
    setSelectedKeys([]);
    await reload();
  };

  /** 批量彻底删除：同恢复的逐条 allSettled 模式，部分失败如实报。 */
  const batchPurge = async () => {
    const chosen = selectedItems();
    if (chosen.length === 0) return;
    const results = await Promise.allSettled(
      chosen.map((item) => purgeTrashItem(item.type_key, item.id)),
    );
    const failed = results.filter((item) => item.status === "rejected").length;
    if (failed === 0) {
      message.success(`已彻底删除 ${chosen.length} 条`);
    } else {
      message.warning(`已彻底删除 ${chosen.length - failed} 条，${failed} 条删除失败，请重试`);
    }
    setSelectedKeys([]);
    await reload();
  };

  const options = [
    { label: `全部（${data?.total ?? 0}）`, value: ALL },
    // 只列出**当前有内容**的类型：回收站里的空类型只会让筛选器变长。
    ...Object.entries(labels)
      .filter(([key]) => (counts[key] ?? 0) > 0)
      .map(([key, label]) => ({ label: `${label}（${counts[key]}）`, value: key })),
  ];

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      message.success(success);
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const columns: ColumnsType<TrashItem> = [
    {
      title: "类型",
      dataIndex: "type_label",
      width: 110,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: "名称",
      dataIndex: "title",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{value || "（无标题）"}</Typography.Text>
          {row.subtitle && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.subtitle}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: "删除时间",
      dataIndex: "deleted_at",
      width: 160,
      render: (value: string | null) => deletedAtText(value),
    },
    {
      title: "操作",
      key: "actions",
      width: 190,
      render: (_value, row) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<UndoOutlined />}
            aria-label={`恢复 ${row.title || row.type_label}`}
            onClick={() =>
              void run(() => restoreTrashItem(row.type, row.id), `已恢复「${row.title}」`)
            }
          >
            恢复
          </Button>
          <Popconfirm
            title="彻底删除？"
            // 确认文案要把后果说白：这是全应用唯一不可逆的动作。
            description={`「${row.title || row.type_label}」将被永久删除，无法恢复。`}
            okText="彻底删除"
            // 显式 aria-label：antd 会给两字中文按钮自动插空格（"取 消"），
            // 不写死名称则界面与测试都容易踩到这个坑（同 CollectResultPanel 的处理）。
            okButtonProps={{
              danger: true,
              "aria-label": `确认彻底删除 ${row.title || row.type_label}`,
            }}
            cancelText="取消"
            cancelButtonProps={{ "aria-label": `取消彻底删除 ${row.title || row.type_label}` }}
            onConfirm={() =>
              void run(() => purgeTrashItem(row.type, row.id), `已彻底删除「${row.title}」`)
            }
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={`彻底删除 ${row.title || row.type_label}`}
            >
              彻底删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const rowSelection: TableRowSelection<TrashItem> | undefined = selectMode
    ? {
        selectedRowKeys: selectedKeys,
        onChange: (keys) => setSelectedKeys(keys.map(String)),
      }
    : undefined;

  /** 退出多选：清空选择，复选框列随之消失。 */
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedKeys([]);
  };

  /** 右键菜单「批量选择」的动作：进入多选模式（入口已从页头按钮收进这里，R8）。 */
  const enterSelectMode = () => setSelectMode(true);

  /** rowKey（`type-id`）→ record：行右键菜单 O(1) 取条目。 */
  const itemsByRowKey = useMemo(() => {
    const map = new Map<string, TrashItem>();
    for (const item of items) map.set(`${item.type}-${item.id}`, item);
    return map;
  }, [items]);

  return (
    <div className="trash-page">
      <div className="trash-page-head">
        <Space orientation="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            回收站
          </Typography.Title>
          <Typography.Text type="secondary">
            删除的内容会先到这里，不会直接消失；恢复是一键的。「彻底删除」才会真正抹掉， 不可撤销。
          </Typography.Text>
        </Space>
        {items.length > 0 && (
          <Space>
            <Popconfirm
              title={`清空${type === ALL ? "回收站" : "这一类"}？`}
              description={`将永久删除 ${
                type === ALL ? (data?.total ?? 0) : (counts[type] ?? 0)
              } 条内容，无法恢复。`}
              okText="清空"
              okButtonProps={{ danger: true, "aria-label": "确认清空回收站" }}
              cancelText="取消"
              cancelButtonProps={{ "aria-label": "取消清空回收站" }}
              onConfirm={() => void run(() => emptyTrash(type === ALL ? "" : type), "回收站已清空")}
            >
              <Button danger icon={<DeleteOutlined />}>
                清空{type === ALL ? "回收站" : "这一类"}
              </Button>
            </Popconfirm>
            {/* 进入多选的入口在行右键菜单的「批量选择」（R8）；这里只保留退出。 */}
            {selectMode && <Button onClick={exitSelectMode}>退出多选</Button>}
          </Space>
        )}
        {selectMode && selectedKeys.length > 0 && (
          <Space>
            <Button icon={<UndoOutlined />} onClick={() => void batchRestore()}>
              批量恢复（{selectedKeys.length}）
            </Button>
            <Popconfirm
              title={`彻底删除选中的 ${selectedKeys.length} 条？`}
              description="将永久删除，无法恢复。"
              okText="彻底删除"
              okButtonProps={{ danger: true, "aria-label": "确认批量彻底删除" }}
              cancelText="取消"
              cancelButtonProps={{ "aria-label": "取消批量彻底删除" }}
              onConfirm={() => void batchPurge()}
            >
              <Button danger icon={<DeleteOutlined />}>
                批量彻底删除
              </Button>
            </Popconfirm>
          </Space>
        )}
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="回收站里的内容不会出现在其它页面"
        description="岗位、简历、投递记录、事实台账条目、资料箱材料与助手会话——删除后它们立刻从各自的列表、首页统计和搜索里消失，只在这里可见。"
      />

      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}

      {data && data.total > 0 && (
        <Segmented
          style={{ marginBottom: 12 }}
          value={type}
          onChange={(value) => setType(value as string)}
          options={options}
        />
      )}

      {loading && !data ? (
        <PageSkeleton rows={5} />
      ) : items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="回收站是空的。删除内容后，它们会出现在这里，可以随时恢复。"
        />
      ) : (
        <Table
          rowKey={(row) => `${row.type}-${row.id}`}
          size="medium"
          columns={columns}
          dataSource={items}
          // 回收站可能积攒上千条；分页后批量恢复/彻底删除仍按选中 key 在全量
          // items 里匹配（见 selectedItems()），跨页勾选不受影响。
          pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
          rowSelection={rowSelection}
          components={{
            body: {
              // 整行右键：批量选择 / 恢复 / 彻底删除；多选模式下收起。
              row: (props: HTMLAttributes<HTMLTableRowElement>) => {
                const rowKey = String((props as { "data-row-key"?: string })["data-row-key"] ?? "");
                return (
                  <ContextMenuRow
                    {...props}
                    record={itemsByRowKey.get(rowKey)}
                    selectMode={selectMode}
                    onEnterSelectMode={enterSelectMode}
                    onRestore={(row) =>
                      void run(() => restoreTrashItem(row.type, row.id), `已恢复「${row.title}」`)
                    }
                    onPurge={(row) =>
                      void run(() => purgeTrashItem(row.type, row.id), `已彻底删除「${row.title}」`)
                    }
                  />
                );
              },
            },
          }}
        />
      )}
    </div>
  );
}
