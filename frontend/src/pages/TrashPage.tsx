// SPDX-License-Identifier: Apache-2.0
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
import { Alert, App, Button, Popconfirm, Segmented, Space, Table, Tag, Typography } from "antd";
import EmptyState from "../components/common/EmptyState";
import PageSkeleton from "../components/common/PageSkeleton";
import ErrorState from "../components/common/ErrorState";
import type { TableColumnsType } from "antd";
import type { TableRowSelection } from "antd/es/table/interface";
import type { HTMLAttributes } from "react";
import { useMemo, useState } from "react";
import { emptyTrash, getTrash, purgeTrashItem, restoreTrashItem } from "../api/trash";
import { RowContextMenu, type RowMenuItem } from "../components/common/RowActions";
import { formatErrorGuidance } from "../api/errorGuidance";
import { useApi } from "../hooks/useApi";
import type { TrashBatchItem, TrashItem } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

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
  const items: RowMenuItem[] = selectMode
    ? []
    : [
        {
          key: "batch_select",
          label: t("trash.selectMode"),
          icon: <CheckSquareOutlined />,
          onClick: onEnterSelectMode,
        },
        {
          key: "restore",
          label: t("trash.action.restore"),
          icon: <UndoOutlined />,
          onClick: () => onRestore(record),
        },
        // 分隔线把「可逆的恢复」与「不可逆的彻底删除」分开：这两个词挨着排最容易点错，
        // 而右边那个没有撤销机会（§4.9：危险项单独成组）。
        { key: "purge_divider", type: "divider" },
        {
          key: "purge",
          label: t("trash.action.purge"),
          danger: true,
          icon: <DeleteOutlined />,
          // 确认文案要把后果说白：这是全应用唯一不可逆的动作。
          confirm: t("trash.confirm.purgeOne", { title: record.title || record.type_label }),
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
  useLocale();
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
      message.success(t("trash.toast.restored", { count: chosen.length }));
    } else {
      message.warning(t("trash.toast.restoredPartial", { ok: chosen.length - failed, failed }));
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
      message.success(t("trash.toast.purged", { count: chosen.length }));
    } else {
      message.warning(t("trash.toast.purgedPartial", { ok: chosen.length - failed, failed }));
    }
    setSelectedKeys([]);
    await reload();
  };

  const options = [
    { label: t("trash.filter.all", { count: data?.total ?? 0 }), value: ALL },
    // 只列出**当前有内容**的类型：回收站里的空类型只会让筛选器变长。
    ...Object.entries(labels)
      .filter(([key]) => (counts[key] ?? 0) > 0)
      .map(([key, label]) => ({
        label: t("trash.filter.labeled", { label, count: counts[key] }),
        value: key,
      })),
  ];

  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    try {
      await action();
      message.success(success);
      await reload();
    } catch (err) {
      // 兜底不再是「操作失败」：先说是哪一步失败，再拼 errorGuidance 的「原因 · 建议 · 编号」（F11）。
      message.error(formatErrorGuidance(err, failure));
    }
  };

  /**
   * 三个动作各包一层：行内按钮与整行右键菜单共用同一份成功/失败文案。
   *
   * 之前同一条恢复在两处各写一份成功文案，改一处就会分叉；包一层后文案只有一份，
   * 失败时也说得清是「恢复」还是「彻底删除」失败。
   */
  const restoreRow = (row: TrashItem) =>
    run(
      () => restoreTrashItem(row.type, row.id),
      t("trash.toast.restoredOne", { title: row.title }),
      t("trash.toast.restoreFailed"),
    );
  const purgeRow = (row: TrashItem) =>
    run(
      () => purgeTrashItem(row.type, row.id),
      t("trash.toast.purgedOne", { title: row.title }),
      t("trash.toast.purgeFailed"),
    );
  const emptyAll = () =>
    run(
      () => emptyTrash(type === ALL ? "" : type),
      t("trash.toast.emptied"),
      t("trash.toast.emptyFailed"),
    );

  const columns: TableColumnsType<TrashItem> = [
    {
      title: t("trash.column.type"),
      dataIndex: "type_label",
      width: 110,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: t("trash.column.name"),
      dataIndex: "title",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{value || t("trash.untitled")}</Typography.Text>
          {row.subtitle && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {row.subtitle}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: t("trash.column.deletedAt"),
      dataIndex: "deleted_at",
      width: 160,
      render: (value: string | null) => deletedAtText(value),
    },
    {
      title: t("trash.column.actions"),
      key: "actions",
      width: 190,
      render: (_value, row) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<UndoOutlined />}
            aria-label={t("trash.aria.restore", { title: row.title || row.type_label })}
            onClick={() => void restoreRow(row)}
          >
            {t("trash.action.restore")}
          </Button>
          <Popconfirm
            title={t("trash.confirm.purgeOneTitle")}
            // 确认文案要把后果说白：这是全应用唯一不可逆的动作。
            description={t("trash.confirm.purgeOne", { title: row.title || row.type_label })}
            okText={t("trash.action.purge")}
            // 显式 aria-label：antd 会给两字中文按钮自动插空格（"取 消"），
            // 不写死名称则界面与测试都容易踩到这个坑（同 CollectResultPanel 的处理）。
            okButtonProps={{
              danger: true,
              "aria-label": t("trash.confirm.confirmAria", { title: row.title || row.type_label }),
            }}
            cancelText={t("common.action.cancel")}
            cancelButtonProps={{
              "aria-label": t("trash.confirm.cancelAria", { title: row.title || row.type_label }),
            }}
            onConfirm={() => void purgeRow(row)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={t("trash.aria.purge", { title: row.title || row.type_label })}
            >
              {t("trash.action.purge")}
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
            {t("trash.page.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("trash.page.subtitle")}</Typography.Text>
        </Space>
        {items.length > 0 && (
          <Space>
            <Popconfirm
              title={type === ALL ? t("trash.emptyOut.titleAll") : t("trash.emptyOut.titleType")}
              description={t("trash.emptyOut.description", {
                count: type === ALL ? (data?.total ?? 0) : (counts[type] ?? 0),
              })}
              okText={t("trash.action.clear")}
              okButtonProps={{ danger: true, "aria-label": t("trash.emptyOut.confirmAria") }}
              cancelText={t("common.action.cancel")}
              cancelButtonProps={{ "aria-label": t("trash.emptyOut.cancelAria") }}
              onConfirm={() => void emptyAll()}
            >
              <Button danger icon={<DeleteOutlined />}>
                {type === ALL ? t("trash.emptyOut.actionAll") : t("trash.emptyOut.actionType")}
              </Button>
            </Popconfirm>
            {/* 进入多选的入口在行右键菜单的「批量选择」（R8）；这里只保留退出。 */}
            {selectMode && <Button onClick={exitSelectMode}>{t("trash.exitSelect")}</Button>}
          </Space>
        )}
        {selectMode && selectedKeys.length > 0 && (
          <Space>
            <Button icon={<UndoOutlined />} onClick={() => void batchRestore()}>
              {t("trash.batch.restore", { count: selectedKeys.length })}
            </Button>
            <Popconfirm
              title={t("trash.batch.confirmTitle")}
              description={t("trash.batch.confirmDescription", { count: selectedKeys.length })}
              okText={t("trash.action.purge")}
              okButtonProps={{ danger: true, "aria-label": t("trash.batch.confirmAria") }}
              cancelText={t("common.action.cancel")}
              cancelButtonProps={{ "aria-label": t("trash.batch.cancelAria") }}
              onConfirm={() => void batchPurge()}
            >
              <Button danger icon={<DeleteOutlined />}>
                {t("trash.batch.purge")}
              </Button>
            </Popconfirm>
          </Space>
        )}
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={t("trash.tip.title")}
        description={t("trash.tip.description")}
      />

      {data && data.total > 0 && (
        <div className="trash-type-filters" role="region" aria-label={t("trash.filters.aria")}>
          <Segmented
            value={type}
            onChange={(value) => setType(value as string)}
            options={options}
          />
        </div>
      )}

      {error ? (
        <ErrorState description={error} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <PageSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState description={t("trash.emptyState.description")} />
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
                    onRestore={(row) => void restoreRow(row)}
                    onPurge={(row) => void purgeRow(row)}
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
