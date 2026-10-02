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
  Empty,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { CheckSquareOutlined } from "@ant-design/icons";
import { RowActions } from "../common/RowActions";
import { deleteWebFormRecord, listWebFormRecords } from "../../api/webform";
import BatchActionBar from "../../components/common/BatchActionBar";
import { useApi } from "../../hooks/useApi";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import type { WebFormFillRecord, WebFormRecordItem } from "../../types";

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
        <Space direction="vertical" size={0}>
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
  const { data, loading, error, reload } = useApi<WebFormFillRecord[]>(
    () => listWebFormRecords(20),
    [],
  );
  const [selected, setSelected] = useState<number | null>(null);

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

  // 批量选择：勾选若干次填充记录后一次删除。
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

  const records = data ?? [];
  if (!loading && records.length === 0) {
    return <Empty description={error ? "读取填充记录失败" : "还没有填充记录"} />;
  }

  return (
    <div>
      {batch.selecting ? (
        <BatchActionBar count={batch.selectedCount} onExit={batch.exitSelecting}>
          <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
            删除所选
          </Button>
        </BatchActionBar>
      ) : (
        <Button
          size="small"
          icon={<CheckSquareOutlined />}
          style={{ marginBottom: 12 }}
          onClick={batch.enterSelecting}
        >
          批量选择
        </Button>
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
              {record.unverified > 0 ? <Tag color="warning">待核对 {record.unverified}</Tag> : null}
              {record.failed > 0 ? <Tag color="error">失败 {record.failed}</Tag> : null}
              {record.source === "live" ? <Tag>逐项填</Tag> : null}
            </Space>
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
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
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
              <Table
                rowKey="index"
                size="small"
                pagination={false}
                columns={itemColumns}
                dataSource={record.items}
                locale={{ emptyText: "这一轮没有可填的字段" }}
              />
              {record.page_snapshot.length > 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  填完后页面上共 {record.page_snapshot.filter((row) => row.filled).length}{" "}
                  个框是我们 填的；其余为你原有的内容或页面自己算出来的。
                </Typography.Text>
              ) : null}
            </Space>
          ),
        }))}
      />
    </div>
  );
}
