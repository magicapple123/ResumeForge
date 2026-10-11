/**
 * 填充记录：每次「填充到页面」留下的那一笔，供用户回看。
 *
 * 为什么要有它：网申填表此前"填完即忘"——表单快照只在内存里活 900 秒。用户填完一张长表
 * （含证件号、手机号），事后想确认"我当时到底填了什么、有几个没成"时无处可查。
 *
 * **记录里含真实值**，所以删除是隐私上的必要项，不是便利：删掉即进回收站，可恢复；
 * 彻底删除在回收站里另做（那是真删，要二次确认）。
 *
 * 列表默认只取最近 20 条——记录是"最近填了什么"的地方，不是归档区。
 */
import {
  App,
  Button,
  Checkbox,
  Collapse,
  Descriptions,
  Modal,
  Pagination,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { CheckSquareOutlined } from "@ant-design/icons";
import { RowActions, RowContextMenu, type RowActionItem } from "../common/RowActions";
import EmptyState from "../common/EmptyState";
import ErrorState from "../common/ErrorState";
import { deleteWebFormRecord, getWebFormRecord, listWebFormRecordsPage } from "../../api/webform";
import BatchActionBar from "../../components/common/BatchActionBar";
import { useApi } from "../../hooks/useApi";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import type { WebFormFillRecord, WebFormRecordItem, WebFormRecordSummary } from "../../types";

/** 每页条数：与迁移前「最近 20 条」的口径一致（迁移后翻页可达全部历史记录）。 */
const RECORD_PAGE_SIZE = 20;

/** 记录里那条明细的状态 → 中文与颜色（与填充结果用的是同一套取值）。 */
const ITEM_STATUS_META: Record<string, { color: string; label: string }> = {
  filled: { color: "success", label: "已填入" },
  unverified: { color: "warning", label: "待核对" },
  failed: { color: "error", label: "失败" },
  skipped: { color: "default", label: "已跳过" },
  conflict: { color: "error", label: "冲突" },
};

function shortTime(value: string): string {
  return (value || "").replace("T", " ").slice(0, 16);
}

const itemColumns: ColumnsType<WebFormRecordItem> = [
  {
    title: "字段",
    key: "field",
    width: 150,
    render: (_, item) => item.field_label || item.control_label || "—",
  },
  { title: "填入的值", dataIndex: "value", key: "value", ellipsis: true },
  {
    title: "结果",
    key: "status",
    width: 200,
    render: (_, item) => {
      const meta = ITEM_STATUS_META[item.status] ?? { color: "default", label: item.status };
      return (
        <Space orientation="vertical" size={0}>
          <Tag color={meta.color}>{meta.label}</Tag>
          {item.detail ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {item.detail}
            </Typography.Text>
          ) : null}
        </Space>
      );
    },
  },
];

interface Props {
  /** 外部触发刷新（填充完成后调用，让新记录立刻出现）。 */
  refreshKey?: number;
}

export default function WebFormRecordsPanel({ refreshKey = 0 }: Props) {
  const { message } = App.useApp();
  // 服务端分页（RF-08）：页码/总数来自分页端点；列表行是摘要（无填写值与页面快照），
  // 展开某条时再取详情（getWebFormRecord），不让真实填写值随列表整体下发。
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi(
    () => listWebFormRecordsPage(page, RECORD_PAGE_SIZE),
    [page],
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<WebFormFillRecord | null>(null);
  // 详情请求失败标记：失败后不再显示 Spin（如实展示"没有可展示的明细"），
  // 与「详情还没到」的加载态区分开。
  const [detailFailed, setDetailFailed] = useState(false);
  // 选中条目变化时清掉上一次的失败标记（渲染期守卫式 reset，Compiler 规范；
  // 不在 effect 里同步 setState，避免 react-hooks/set-state-in-effect）。
  const [prevSelected, setPrevSelected] = useState(selected);
  if (prevSelected !== selected) {
    setPrevSelected(selected);
    setDetailFailed(false);
  }

  // 加载态由「选中的条目」与「已取回详情是否属于它」推导：展开一条还没有它详情的
  // 记录时必然在加载。明细是否在加载不进 state，effect 里就只剩异步回调里的 setState。
  const detailLoading = selected !== null && !detailFailed && detail?.id !== selected;

  // 展开条目变化 → 取那条的全文（填写值明细与页面快照只在详情里）。
  useEffect(() => {
    if (selected === null) return;
    let cancelled = false;
    getWebFormRecord(selected)
      .then((full) => {
        if (!cancelled) setDetail(full);
      })
      .catch(() => {
        // 详情取不到时如实显示"没有可展示的明细"，不把整块炸掉。
        if (!cancelled) {
          setDetail(null);
          setDetailFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // 填充完成后外部把 refreshKey 加一，这里重新拉一次。
  useEffect(() => {
    if (refreshKey > 0) void reload();
  }, [refreshKey, reload]);

  const remove = useCallback(
    async (recordId: number) => {
      await deleteWebFormRecord(recordId);
      if (selected === recordId) setSelected(null);
      await reload();
    },
    [reload, selected],
  );

  // 批量选择：勾选若干次填充记录后一次删除。选择集只在当前页内——翻页即清空，
  // 不存在跨页多选（确认文案因此无需区分"本页/全部"）。
  const batch = useBatchSelection<number>();

  /** 批量删除：确认后逐条走同一个删除接口，全部完成再刷新一次。 */
  const removeSelected = () => {
    const ids = [...batch.selectedIds];
    if (ids.length === 0) return;
    Modal.confirm({
      title: `删除选中的 ${ids.length} 条填充记录？`,
      content: "会进回收站，之后可以恢复。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: async () => {
        const results = await Promise.allSettled(ids.map((id) => deleteWebFormRecord(id)));
        const failed = results.filter((item) => item.status === "rejected").length;
        if (failed === 0) message.success(`已删除 ${ids.length} 条填充记录`);
        else message.warning(`已删除 ${ids.length - failed} 条，${failed} 条失败，请重试`);
        batch.exitSelecting();
        await reload();
      },
    });
  };

  const records: WebFormRecordSummary[] = data?.items ?? [];
  const total = data?.total ?? 0;
  if (!loading && records.length === 0) {
    // 错误与空态分开：失败给重试出路（ErrorState，role=alert 可感知），
    // 真的没有记录才是 EmptyState——两者混成一句文案会让"坏了"看起来像"没填过"。
    return error ? (
      <ErrorState description="读取填充记录失败" onRetry={() => void reload()} />
    ) : (
      <EmptyState description="还没有填充记录" />
    );
  }

  // 翻页即清空展开条与选择集：上一页的展开/勾选对新页没有意义。
  const changePage = (next: number) => {
    setSelected(null);
    batch.exitSelecting();
    setPage(next);
  };

  /** 记录条目的右键菜单：批量选择（工具栏按钮已收进这里，R8）+ 删除（二次确认）。 */
  const contextActions = (record: WebFormRecordSummary): RowActionItem[] => [
    {
      key: "batch_select",
      label: "批量选择",
      icon: <CheckSquareOutlined />,
      onClick: batch.enterSelecting,
    },
    {
      key: "delete",
      label: "删除",
      danger: true,
      confirm: "删除这条填充记录？会进回收站，之后可以恢复。",
      onClick: () => void remove(record.id),
    },
  ];

  return (
    <div>
      {batch.selecting && (
        <BatchActionBar count={batch.selectedCount} onExit={batch.exitSelecting}>
          <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
            删除所选
          </Button>
        </BatchActionBar>
      )}
      <Collapse
        accordion
        activeKey={selected === null ? undefined : String(selected)}
        onChange={(key) => {
          const next = Array.isArray(key) ? key[0] : key;
          setSelected(next ? Number(next) : null);
        }}
        items={records.map((record) => ({
          key: String(record.id),
          label: (
            // 右键菜单挂在条目摘要上：批量选择（工具栏按钮已收进这里，R8）+ 删除。
            <RowContextMenu items={batch.selecting ? [] : contextActions(record)}>
              <Space size={8} wrap>
                {batch.selecting && (
                  <Checkbox
                    aria-label={`选择填充记录 ${record.id}`}
                    checked={batch.isSelected(record.id)}
                    onChange={() => batch.toggle(record.id)}
                  />
                )}
                <span>{shortTime(record.created_at)}</span>
                <Typography.Text type="secondary">
                  {record.page_title || record.url || "（无标题）"}
                </Typography.Text>
                <Tag color="success">成功 {record.filled}</Tag>
                {record.unverified > 0 ? (
                  <Tag color="warning">待核对 {record.unverified}</Tag>
                ) : null}
                {record.failed > 0 ? <Tag color="error">失败 {record.failed}</Tag> : null}
                {record.source === "live" ? <Tag>逐项填</Tag> : null}
              </Space>
            </RowContextMenu>
          ),
          extra: batch.selecting ? undefined : (
            // 阻止冒泡，否则点「···」会顺带展开/收起这一条。
            <span onClick={(event) => event.stopPropagation()}>
              <RowActions
                more={[
                  {
                    key: "delete",
                    label: "删除",
                    danger: true,
                    confirm: "删除这条填充记录？会进回收站，之后可以恢复。",
                    onClick: () => void remove(record.id),
                  },
                ]}
              />
            </span>
          ),
          children: (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="页面">
                  {record.page_title || "（无标题）"}
                  {record.url ? (
                    <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                      {record.url}
                    </Typography.Text>
                  ) : null}
                </Descriptions.Item>
              </Descriptions>
              {detailLoading ? (
                <div style={{ textAlign: "center", padding: 16 }}>
                  <Spin />
                </div>
              ) : (
                <>
                  <Table
                    rowKey="index"
                    size="small"
                    pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
                    columns={itemColumns}
                    dataSource={detail?.items ?? []}
                    locale={{ emptyText: "这一轮没有可填的字段" }}
                  />
                  {(detail?.page_snapshot.length ?? 0) > 0 ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      填完后页面上共 {detail?.page_snapshot.filter((row) => row.filled).length}{" "}
                      个框是我们填的；其余为你原有的内容或页面自己算出来的。
                    </Typography.Text>
                  ) : null}
                </>
              )}
            </Space>
          ),
        }))}
      />
      {/* 服务端分页（RF-08）：页码/总数来自分页端点；翻页即清空展开条与选择集。 */}
      <div style={{ textAlign: "right", marginTop: 12 }}>
        <Pagination
          current={page}
          pageSize={RECORD_PAGE_SIZE}
          total={total}
          onChange={changePage}
          hideOnSinglePage
          showSizeChanger={false}
          showTotal={(count) => `共 ${count} 条`}
        />
      </div>
    </div>
  );
}
