// SPDX-License-Identifier: Apache-2.0
import { Row, Typography } from "antd";
import { memo, type CSSProperties } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { webformGroupLabel } from "../../features/webform/groupIdentity";
import WebFormProfileField from "./WebFormProfileField";
import { areGroupPropsEqual, type WebFormProfileGroupProps } from "./webFormProfileGroupMemo";
export type { WebFormProfileGroupProps } from "./webFormProfileGroupMemo";

/** 稳定引用：这两个对象以前每 render 新建，白白给 React 制造 diff 工作量。 */
const CONTAINER_STYLE: CSSProperties = {
  marginBottom: 14,
  padding: "12px 14px 14px",
  // 白底/浅边在深色下会变成"一块亮砖 + 一圈亮边"，改走语义 token。
  border: "1px solid var(--rf-border)",
  borderRadius: 12,
  background: "var(--rf-surface)",
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
  useLocale();
  return (
    <div style={CONTAINER_STYLE}>
      <div style={HEADER_STYLE}>
        <Typography.Text strong>{webformGroupLabel(group)}</Typography.Text>
        <Typography.Text type="secondary" style={COUNT_TEXT_STYLE}>
          {t("profileLibrary.webform.filledCount", {
            count: filledCount,
            total: groupAllFields.length,
          })}
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
