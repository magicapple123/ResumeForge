import { Col, Input, Select, Space, Tag, Tooltip, Typography } from "antd";
import { memo } from "react";
import WebFormCustomFieldControls from "./WebFormCustomFieldControls";
import PartialDateSelect from "./PartialDateSelect";
import { isCustomField } from "./WebFormProfileFieldUtils";
import type { WebFormExtraEntry, WebFormField } from "../../types";

const { TextArea } = Input;

const CUSTOM_HINT =
  "标签与唯一预设字段精确对应时可自动匹配；放宽模式会尝试受约束的文本匹配，歧义项不猜、请复核";

/**
 * 回调按 (key, ...) 维度收口：Group 传下来的是**稳定引用**（页面级 useCallback），
 * 字段自身的信息由本组件持有的 `field` 提供。配合 memo，打字时只有值变了的那一个
 * 字段重渲，同组其余字段（各自的输入框、标签、Select options）整块跳过。
 */
interface Props {
  field: WebFormField;
  editing: boolean;
  saving: boolean;
  value: string;
  entry?: WebFormExtraEntry;
  displayLabel: string;
  onChange: (key: string, value: string) => void;
  onRename: (key: string, label: string) => string | undefined;
  onDelete: (key: string) => void;
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
  label,
}: {
  field: WebFormField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  label: string;
}) {
  if (field.kind === "longtext") {
    return (
      <TextArea
        value={value}
        disabled={disabled}
        autoSize={{ minRows: 2, maxRows: 5 }}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
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
        onChange={(nextValue) => onChange(nextValue ?? "")}
        aria-label={label}
        style={{ width: "100%" }}
      />
    );
  }
  return (
    <Input
      value={value}
      disabled={disabled}
      type={field.kind === "tel" ? "tel" : field.kind === "email" ? "email" : "text"}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
    />
  );
}

export default memo(function WebFormProfileField({
  field,
  editing,
  saving,
  value,
  entry,
  displayLabel,
  onChange,
  onRename,
  onDelete,
}: Props) {
  return (
    <Col xs={24} lg={12}>
      <div
        style={{
          height: "100%",
          padding: "10px 12px",
          border: "1px solid #edf2f7",
          borderRadius: 9,
          background: editing && !value.trim() ? "#fbfcfe" : "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
            minHeight: 24,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }} title={displayLabel}>
            {isCustomField(field) ? (
              <WebFormCustomFieldControls
                label={displayLabel}
                editing={editing}
                saving={saving}
                onRename={(label) => onRename(field.key, label)}
                onDelete={() => onDelete(field.key)}
              />
            ) : (
              <Typography.Text
                type="secondary"
                style={{
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {field.label}
              </Typography.Text>
            )}
          </div>
          <Space size={4} wrap>
            {entry?.source === "learned" ? (
              <Tooltip title="填表时你填了这个框、而简历通里没有，于是问你要不要记住">
                <Tag color="purple">学到</Tag>
              </Tooltip>
            ) : null}
            {isCustomField(field) ? (
              <Tooltip title={CUSTOM_HINT}>
                <Tag color="cyan">自定义</Tag>
              </Tooltip>
            ) : null}
          </Space>
        </div>
        <div style={{ marginTop: 8, minHeight: editing ? 32 : 24 }}>
          {editing ? (
            <FieldInput
              field={field}
              value={value}
              disabled={saving}
              label={displayLabel}
              onChange={(nextValue) => onChange(field.key, nextValue)}
            />
          ) : (
            <Typography.Text
              style={{
                display: "block",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                color: value.trim() ? undefined : "#b8c2cc",
              }}
            >
              {value || "未填写"}
            </Typography.Text>
          )}
        </div>
      </div>
    </Col>
  );
});
