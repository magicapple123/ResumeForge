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
  Button,
  Collapse,
  Descriptions,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import { deleteWebFormRecord, listWebFormRecords } from "../../api/webform";
import { useApi } from "../../hooks/useApi";
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

  const records = data ?? [];
  if (!loading && records.length === 0) {
    return <Empty description={error ? "读取填充记录失败" : "还没有填充记录"} />;
  }

  return (
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
        extra: (
          <Popconfirm
            title="删除这条填充记录？"
            description="会进回收站，之后可以恢复。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void remove(record.id)}
          >
            {/* 阻止冒泡，否则点删除会顺带展开/收起这一条。 */}
            <Button size="small" danger onClick={(event) => event.stopPropagation()}>
              删除
            </Button>
          </Popconfirm>
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
                填完后页面上共 {record.page_snapshot.filter((row) => row.filled).length} 个框是我们
                填的；其余为你原有的内容或页面自己算出来的。
              </Typography.Text>
            ) : null}
          </Space>
        ),
      }))}
    />
  );
}
