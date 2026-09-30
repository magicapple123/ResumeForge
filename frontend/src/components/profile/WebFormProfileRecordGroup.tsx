import { Button, Card, Col, Empty, Input, Row, Select, Space, Tag, Typography } from "antd";
import type { WebFormRepeatedGroup } from "../../types";
import PartialDateSelect from "./PartialDateSelect";

const { TextArea } = Input;

interface Props {
  group: WebFormRepeatedGroup;
  editing: boolean;
  saving: boolean;
  onAdd: () => void;
  onDelete: (index: number) => void;
  onChange: (index: number, fieldKey: string, value: string) => void;
}

function hasValues(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => value.trim());
}

function RecordInput({
  field,
  value,
  disabled,
  label,
  onChange,
}: {
  field: WebFormRepeatedGroup["fields"][number];
  value: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  if (field.kind === "longtext") {
    return (
      <TextArea
        value={value}
        disabled={disabled}
        autoSize={{ minRows: 2, maxRows: 5 }}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.kind === "date") {
    return (
      <PartialDateSelect
        value={value}
        disabled={disabled}
        label={label}
        allowOngoing={field.key.endsWith("_end")}
        onChange={onChange}
      />
    );
  }
  if (field.kind === "select" && field.options?.length) {
    return (
      <Select
        value={value || undefined}
        disabled={disabled}
        allowClear
        options={field.options.map((option) => ({ label: option, value: option }))}
        aria-label={label}
        style={{ width: "100%" }}
        onChange={(nextValue) => onChange(nextValue ?? "")}
      />
    );
  }
  return (
    <Input
      value={value}
      disabled={disabled}
      type={field.kind === "tel" ? "tel" : "text"}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function RecordCard({
  group,
  index,
  editing,
  saving,
  onDelete,
  onChange,
}: {
  group: WebFormRepeatedGroup;
  index: number;
  editing: boolean;
  saving: boolean;
  onDelete: () => void;
  onChange: (fieldKey: string, value: string) => void;
}) {
  const record = group.records[index];
  const recordLabel = `${group.label}第${index + 1}条`;
  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <Typography.Text strong>{`第${index + 1}条`}</Typography.Text>
          {index === 0 ? <Tag color="blue">第一条</Tag> : null}
        </Space>
      }
      extra={
        editing ? (
          <Button
            type="text"
            danger
            disabled={saving}
            aria-label={`删除${recordLabel}`}
            onClick={onDelete}
          >
            删除
          </Button>
        ) : null
      }
      style={{ height: "100%" }}
    >
      {editing ? (
        <Row gutter={[12, 4]}>
          {group.fields.map((field) => (
            <Col key={field.key} xs={24} md={field.kind === "longtext" ? 24 : 12}>
              <div style={{ marginBottom: 10 }}>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 5 }}>
                  {field.label}
                </Typography.Text>
                <RecordInput
                  field={field}
                  value={record?.values[field.key] ?? ""}
                  disabled={saving}
                  label={`${recordLabel}${field.label}`}
                  onChange={(value) => onChange(field.key, value)}
                />
              </div>
            </Col>
          ))}
        </Row>
      ) : (
        <Row gutter={[12, 8]}>
          {group.fields.map((field) => {
            const value = record?.values[field.key]?.trim() ?? "";
            if (!value) return null;
            return (
              <Col key={field.key} xs={24} md={field.kind === "longtext" ? 24 : 12}>
                <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                  {field.label}
                </Typography.Text>
                <Typography.Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {value}
                </Typography.Text>
              </Col>
            );
          })}
        </Row>
      )}
    </Card>
  );
}

export default function WebFormProfileRecordGroup({
  group,
  editing,
  saving,
  onAdd,
  onDelete,
  onChange,
}: Props) {
  const visibleRecords = editing
    ? group.records
    : group.records.filter((record) => hasValues(record.values));

  if (!editing && visibleRecords.length === 0) return null;

  return (
    <Card
      size="small"
      title={group.label}
      extra={
        <Button type="link" disabled={!editing || saving} onClick={onAdd}>
          {`新增${group.label}`}
        </Button>
      }
      style={{ marginBottom: 14 }}
    >
      {editing && visibleRecords.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`还没有${group.label}`} />
      ) : (
        <Row gutter={[12, 12]}>
          {visibleRecords.map((record) => {
            const index = group.records.indexOf(record);
            return (
              <Col key={`${group.key}-${record.id ?? `draft-${index}`}`} xs={24}>
                <RecordCard
                  group={group}
                  index={index}
                  editing={editing}
                  saving={saving}
                  onDelete={() => onDelete(index)}
                  onChange={(fieldKey, value) => onChange(index, fieldKey, value)}
                />
              </Col>
            );
          })}
        </Row>
      )}
    </Card>
  );
}
