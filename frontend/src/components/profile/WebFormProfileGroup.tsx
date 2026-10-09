import { Row, Typography } from "antd";
import { memo, type CSSProperties } from "react";
import type { WebFormExtraEntry, WebFormField } from "../../types";
import WebFormProfileField from "./WebFormProfileField";

export interface WebFormProfileGroupProps {
  group: string;
  fields: WebFormField[];
  groupAllFields: WebFormField[];
  /** 本组**已填**字段数：由 Section 用一遍全字段扫描算出，Group 不再自己 filter 一遍。 */
  filledCount: number;
  editing: boolean;
  saving: boolean;
  values: Record<string, string>;
  entries: Record<string, WebFormExtraEntry>;
  displayLabel: (field: WebFormField) => string;
  onChange: (key: string, value: string) => void;
  onRename: (key: string, label: string) => string | undefined;
  onDelete: (key: string) => void;
}

/** 稳定引用：这两个对象以前每 render 新建，白白给 React 制造 diff 工作量。 */
const CONTAINER_STYLE: CSSProperties = {
  marginBottom: 14,
  padding: "12px 14px 14px",
  border: "1px solid #e6edf5",
  borderRadius: 12,
  background: "#fff",
  boxShadow: "0 2px 8px rgba(31, 56, 88, 0.04)",
};

const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "wrap",
  marginBottom: 10,
};

const COUNT_TEXT_STYLE: CSSProperties = { fontSize: 12 };

/** 两个 fields 数组是否「同一批 key、同一顺序」（长度也一致）。 */
function sameFieldKeys(previous: WebFormField[], next: WebFormField[]): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index].key !== next[index].key) return false;
  }
  return true;
}

/**
 * 只比较**本组 fields 覆盖到的那几个 key** 的值：别的组打字会把整个 `values` 对象换新，
 * 但那与本组无关；只要本组每个 key 的值都没变，本组就该 bail。
 *
 * 调用约束：本函数在 `sameFieldKeys` 已判定 true 之后调用，因此 prev/next 的 key 序列一致。
 */
function sameFieldValues(
  fields: WebFormField[],
  previousValues: Record<string, string>,
  nextValues: Record<string, string>,
): boolean {
  for (const field of fields) {
    if (previousValues[field.key] !== nextValues[field.key]) return false;
  }
  return true;
}

/**
 * `WebFormProfileGroup` 的自定义 memo 比较器（导出为纯函数，便于单测）。
 *
 * ## 为什么需要它，而不是靠默认的浅比较
 *
 * 击键时父组件 `WebFormProfileSection` 持有的 `values` 必然换成新对象；默认浅比较会因此
 * 判「props 变了」，12 个组全部重渲——即使其中 11 个根本没被编辑。这里把「values 变了」
 * 收窄成「**本组**的 values 变了」，未编辑组才能整棵跳过。
 *
 * - `fields`：按长度 + key 序列比较。这一条不能只比引用——查看态 /「只看已填」下，某个
 *   字段会因为值被清空而从 `fields` 里被过滤掉，成员变化必须让本组重渲。
 * - `values`：只比 `fields` 各 key 的值（见 `sameFieldValues`）。
 * - 其余 props（groupAllFields / entries / displayLabel / 回调）在父组件侧都已稳定，按引用比较。
 */
export function areGroupPropsEqual(
  previous: WebFormProfileGroupProps,
  next: WebFormProfileGroupProps,
): boolean {
  return (
    previous.group === next.group &&
    previous.editing === next.editing &&
    previous.saving === next.saving &&
    previous.filledCount === next.filledCount &&
    previous.groupAllFields === next.groupAllFields &&
    previous.entries === next.entries &&
    previous.displayLabel === next.displayLabel &&
    previous.onChange === next.onChange &&
    previous.onRename === next.onRename &&
    previous.onDelete === next.onDelete &&
    sameFieldKeys(previous.fields, next.fields) &&
    sameFieldValues(next.fields, previous.values, next.values)
  );
}

/**
 * **自定义 memo**：Group 本身很薄（一个容器 + 计数），真正的开销在每个字段的输入控件。
 * Field 已接收稳定回调（见 WebFormProfileField），加上这里只按「本组 fields 的值」判等，
 * 打字时只有值变了的那一个字段会真正重渲，其余组与其余字段整块跳过。
 */
function WebFormProfileGroupImpl({
  group,
  fields,
  groupAllFields,
  filledCount,
  editing,
  saving,
  values,
  entries,
  displayLabel,
  onChange,
  onRename,
  onDelete,
}: WebFormProfileGroupProps) {
  return (
    <div style={CONTAINER_STYLE}>
      <div style={HEADER_STYLE}>
        <Typography.Text strong>{group}</Typography.Text>
        <Typography.Text type="secondary" style={COUNT_TEXT_STYLE}>
          已填写 {filledCount} / {groupAllFields.length}
        </Typography.Text>
      </div>
      <Row gutter={[12, 12]}>
        {fields.map((field) => (
          <WebFormProfileField
            key={field.key}
            field={field}
            editing={editing}
            saving={saving}
            value={values[field.key] ?? ""}
            entry={entries[field.key]}
            displayLabel={displayLabel(field)}
            onChange={onChange}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </Row>
    </div>
  );
}

export default memo(WebFormProfileGroupImpl, areGroupPropsEqual);
