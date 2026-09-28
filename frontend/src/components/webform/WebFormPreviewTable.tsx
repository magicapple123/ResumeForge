/**
 * 映射预览表：把"资料里的哪个字段 → 页面上的哪个框"逐条摊开给用户核对。
 *
 * 这一步不是装饰。字段匹配是启发式的（"姓名"与"紧急联系人姓名"只差几个字），
 * 负向词能挡掉一部分但挡不全，所以**让人看一眼**才是这个功能的正确性前提。
 * 冲突行（页面上已有不同的值）默认不勾选——那可能是用户上一轮填了一半的草稿。
 *
 * `source === "ai"` 的行打「AI 建议」标签，**同样默认不勾选**（后端决定的）：规则命中至少
 * 证明页面上有字对上了，AI 命中可能纯粹是上下文推的，用户核对的怀疑程度应当不同。
 */
import { Checkbox, Input, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { WebFormItemStatus, WebFormPreviewItem } from "../../types";

const STATUS_META: Record<WebFormItemStatus, { color: string; label: string; hint: string }> = {
  ready: { color: "success", label: "已就绪", hint: "字段与取值都对上了" },
  low_confidence: {
    color: "warning",
    label: "需确认",
    hint: "有另一个控件也沾边，请核对填对了没有",
  },
  conflict: {
    color: "error",
    label: "冲突",
    hint: "页面上已经有值，默认保留它（不覆盖你自己填的内容）",
  },
};

interface Props {
  items: WebFormPreviewItem[];
  selected: Set<number>;
  values: Record<number, string>;
  disabled?: boolean;
  onToggle: (index: number) => void;
  onValueChange: (index: number, value: string) => void;
}

export default function WebFormPreviewTable({
  items,
  selected,
  values,
  disabled,
  onToggle,
  onValueChange,
}: Props) {
  const columns: ColumnsType<WebFormPreviewItem> = [
    {
      title: "填入",
      key: "pick",
      width: 62,
      render: (_, item) => (
        <Checkbox
          checked={selected.has(item.index)}
          disabled={disabled}
          onChange={() => onToggle(item.index)}
          aria-label={`选择填入${item.field_label}`}
        />
      ),
    },
    {
      title: "字段",
      dataIndex: "field_label",
      key: "field",
      width: 130,
      render: (_, item) => (
        <div>
          <Space size={4}>
            <span>{item.field_label}</span>
            {item.source === "ai" ? <Tag color="blue">AI 建议</Tag> : null}
          </Space>
          {item.control_label && item.control_label !== item.field_label ? (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                页面：{item.control_label}
              </Typography.Text>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: "将填入的值",
      key: "value",
      render: (_, item) =>
        item.options.length > 0 ? (
          <Select
            style={{ width: "100%" }}
            value={values[item.index] ?? item.value}
            disabled={disabled}
            onChange={(next: string) => onValueChange(item.index, next)}
            options={item.options.map((option) => ({
              value: option.value,
              label: option.text || option.value,
            }))}
          />
        ) : (
          <Input
            value={values[item.index] ?? item.value}
            disabled={disabled}
            onChange={(event) => onValueChange(item.index, event.target.value)}
          />
        ),
    },
    {
      title: "状态",
      key: "status",
      width: 130,
      render: (_, item) => {
        const meta = STATUS_META[item.status];
        return (
          <Tooltip title={meta.hint}>
            <Tag color={meta.color}>{meta.label}</Tag>
            {item.status === "conflict" && item.current_value ? (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  页面上：{item.current_value}
                </Typography.Text>
              </div>
            ) : null}
            {item.note && item.status !== "conflict" ? (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {item.note}
                </Typography.Text>
              </div>
            ) : null}
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Table
      rowKey="index"
      size="small"
      columns={columns}
      dataSource={items}
      pagination={false}
      rowClassName={(item) => (item.status === "conflict" ? "webform-row-conflict" : "")}
      locale={{ emptyText: "这一页没有能自动填的字段" }}
    />
  );
}
