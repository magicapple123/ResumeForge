import { Row, Typography } from "antd";
import type { WebFormExtraEntry, WebFormField } from "../../types";
import WebFormProfileField from "./WebFormProfileField";

interface Props {
  group: string;
  fields: WebFormField[];
  groupAllFields: WebFormField[];
  editing: boolean;
  saving: boolean;
  values: Record<string, string>;
  entries: Record<string, WebFormExtraEntry>;
  displayLabel: (field: WebFormField) => string;
  onChange: (key: string, value: string) => void;
  onRename: (key: string, label: string) => string | undefined;
  onDelete: (key: string) => void;
}

export default function WebFormProfileGroup({
  group,
  fields,
  groupAllFields,
  editing,
  saving,
  values,
  entries,
  displayLabel,
  onChange,
  onRename,
  onDelete,
}: Props) {
  const groupFilledCount = groupAllFields.filter((field) => values[field.key]?.trim()).length;

  return (
    <div
      style={{
        marginBottom: 14,
        padding: "12px 14px 14px",
        border: "1px solid #e6edf5",
        borderRadius: 12,
        background: "#fff",
        boxShadow: "0 2px 8px rgba(31, 56, 88, 0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <Typography.Text strong>{group}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          已填写 {groupFilledCount} / {groupAllFields.length}
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
            onChange={(value) => onChange(field.key, value)}
            onRename={(label) => onRename(field.key, label)}
            onDelete={() => onDelete(field.key)}
          />
        ))}
      </Row>
    </div>
  );
}
