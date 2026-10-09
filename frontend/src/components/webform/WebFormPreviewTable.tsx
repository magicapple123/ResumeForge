/**
 * 映射预览表：把"资料里的哪个字段 → 页面上的哪个框"逐条摊开给用户核对。
 *
 * 这一步不是装饰。字段匹配是启发式的（"姓名"与"紧急联系人姓名"只差几个字），
 * 负向词能挡掉一部分但挡不全，所以**让人看一眼**才是这个功能的正确性前提。
 * 冲突行（页面上已有不同的值）默认不勾选——那可能是用户上一轮填了一半的草稿。
 *
 * `source === "ai"` 的行打「AI 建议」标签，**同样默认不勾选**（后端决定的）：规则命中至少
 * 证明页面上有字对上了，AI 命中可能纯粹是上下文推的，用户核对的怀疑程度应当不同。
 *
 * ## 为什么把每一列拆成独立的 memo 组件
 *
 * 手改某个框的值会更新整份 `values`，于是本表重渲、antd Table 会把**每一行**的 BodyRow
 * 都再渲染一遍——未编辑行的 `Input`/`Select`（含 options 映射）也会跟着跑。把 4 列的
 * `render` 收成 4 个 `memo` 子组件后，未变行的 cell props 全部相等 → 整块 bail，
 * 只剩真正被编辑的那一行重渲。
 */
import { Checkbox, Input, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { memo, useMemo } from "react";
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
  relaxed_ready: {
    color: "processing",
    label: "放宽代选",
    hint: "放宽模式：这一项的值由点选产生，程序将代点并回读核对，填完请确认",
  },
  needs_confirm: {
    color: "warning",
    label: "需你确认",
    hint: "同意/声明类勾选：默认不勾，你勾选后才由程序代点——勾上即视为你本人同意",
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

/** 「填入」列的勾选框。只依赖本行 + 稳定回调，未变行走 memo bail。 */
const PreviewPickCell = memo(function PreviewPickCell({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: WebFormPreviewItem;
  checked: boolean;
  disabled?: boolean;
  onToggle: (index: number) => void;
}) {
  return (
    <Checkbox
      checked={checked}
      disabled={disabled}
      onChange={() => onToggle(item.index)}
      aria-label={`选择填入${item.field_label}`}
    />
  );
});

/** 「字段」列：字段名 + 页面控件名 + AI 建议标签。纯展示，只依赖本行。 */
const PreviewLabelCell = memo(function PreviewLabelCell({ item }: { item: WebFormPreviewItem }) {
  return (
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
  );
});

/** 「将填入的值」列：受控可编辑。options 只在 item 变化时重建。 */
const PreviewValueCell = memo(function PreviewValueCell({
  item,
  value,
  disabled,
  onValueChange,
}: {
  item: WebFormPreviewItem;
  value: string;
  disabled?: boolean;
  onValueChange: (index: number, value: string) => void;
}) {
  const options = useMemo(
    () =>
      item.options.map((option) => ({
        value: option.value,
        label: option.text || option.value,
      })),
    [item.options],
  );

  if (item.options.length > 0) {
    return (
      <Select
        style={{ width: "100%" }}
        value={value}
        disabled={disabled}
        onChange={(next: string) => onValueChange(item.index, next)}
        options={options}
      />
    );
  }
  return (
    <Input
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(item.index, event.target.value)}
    />
  );
});

/** 「状态」列：状态标签 + 冲突页面上值 / 备注。纯展示，只依赖本行。 */
const PreviewStatusCell = memo(function PreviewStatusCell({ item }: { item: WebFormPreviewItem }) {
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
});

/**
 * **React.memo 的收益点**：浏览器状态/实时会话的轮询会周期性重渲整页，
 * memo 让本表在 props（items/selected/values/回调引用）都没变时整棵跳过。
 * 击键时 values 引用必变、本表必然重渲（输入值就在表里），这是数据流本身决定的；
 * 真正的节省来自上面 4 个 memo 单元格——未变行不再重跑各自的 Input/Select。
 */
function WebFormPreviewTableImpl({
  items,
  selected,
  values,
  disabled,
  onToggle,
  onValueChange,
}: Props) {
  // 列定义里的 render 闭包引用了 selected/values/disabled 与回调，按真实依赖缓存；
  // render 里只把「本行解析后的原始值」交给 memo 子组件，因此未变行 props 恒等、可 bail。
  const columns: ColumnsType<WebFormPreviewItem> = useMemo(
    () => [
      {
        title: "填入",
        key: "pick",
        width: 62,
        render: (_, item) => (
          <PreviewPickCell
            item={item}
            checked={selected.has(item.index)}
            disabled={disabled}
            onToggle={onToggle}
          />
        ),
      },
      {
        title: "字段",
        dataIndex: "field_label",
        key: "field",
        width: 130,
        render: (_, item) => <PreviewLabelCell item={item} />,
      },
      {
        title: "将填入的值",
        key: "value",
        render: (_, item) => (
          <PreviewValueCell
            item={item}
            value={values[item.index] ?? item.value}
            disabled={disabled}
            onValueChange={onValueChange}
          />
        ),
      },
      {
        title: "状态",
        key: "status",
        width: 130,
        render: (_, item) => <PreviewStatusCell item={item} />,
      },
    ],
    [disabled, onToggle, onValueChange, selected, values],
  );

  return (
    <Table
      rowKey="index"
      size="small"
      columns={columns}
      dataSource={items}
      pagination={false}
      rowClassName={(item) =>
        // 「需你确认」行（同意/声明类）用淡警示底色与事实类区分：勾上它等于代你表态。
        item.status === "needs_confirm" ? "webform-row-needs-confirm" : ""
      }
      locale={{ emptyText: "这一页没有能自动填的字段" }}
    />
  );
}

export default memo(WebFormPreviewTableImpl);
