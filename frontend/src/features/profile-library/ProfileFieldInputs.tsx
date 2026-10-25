// SPDX-License-Identifier: Apache-2.0
/**
 * 一个条目内的字段输入（F6）：三种文本形态 + 默认收起 + 用户隐藏恢复。
 *
 * - 输入只使用三种文本形态（单行/多行/日期）；照片走资料页的专门入口，不在这里；
 * - 枚举只是**输入建议**（AutoComplete，可自由输入），不做校验拦截；
 * - default_collapsed 字段默认收进「更多字段」，展开/收起写 preference 的
 *   collapsed_override（刷新后仍记住）；collapsed 不参与判空、不进保存过滤；
 * - hidden 字段不渲染，只在「已隐藏 N 个字段」里恢复；两个状态独立，叠加时 hidden 优先。
 */
import { AutoComplete, Button, Form, Input, Popover, Typography } from "antd";
import { t } from "../../i18n";
import PartialDateSelect from "../../components/profile/PartialDateSelect";
import type { FieldOut, SectionOut } from "./types";

interface Props {
  section: SectionOut;
  /** 指向该条目 values 对象的 Form.Item name 前缀。 */
  namePrefix: (string | number)[];
  disabled?: boolean;
  singleLineMax: number;
  multiLineMax: number;
  onSetPreference: (
    field: FieldOut,
    patch: { hidden?: boolean; collapsed_override?: boolean | null },
  ) => void;
}

/** 该字段此刻是否处于收起态（用户显式展开过就跟随偏好，否则跟随代码默认）。 */
function isCollapsed(field: FieldOut): boolean {
  if (field.collapsed_override === null) return field.default_collapsed;
  return field.collapsed_override;
}

function fieldPlaceholder(field: FieldOut): string {
  if (field.enum_suggestions.length > 0) return t("profileLibrary.field.placeholder");
  return t("profileLibrary.field.placeholder");
}

/** Form.Item 注入给直接子元素的受控属性；必须原样转交给真正的输入控件。 */
interface ControlProps {
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  id?: string;
}

function InputForField({
  field,
  disabled,
  singleLineMax,
  multiLineMax,
  value,
  onChange,
  onBlur,
  id,
}: {
  field: FieldOut;
  disabled: boolean;
  singleLineMax: number;
  multiLineMax: number;
} & ControlProps) {
  if (field.field_type === "multi_line") {
    return (
      <Input.TextArea
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        maxLength={multiLineMax}
        autoSize={{ minRows: 2, maxRows: 8 }}
        placeholder={t("profileLibrary.field.placeholder")}
      />
    );
  }
  if (field.field_type === "date_text") {
    return (
      <PartialDateSelect
        id={id}
        value={value}
        onChange={onChange}
        label={field.label}
        allowOngoing
        disabled={disabled || undefined}
      />
    );
  }
  if (field.enum_suggestions.length > 0) {
    return (
      <AutoComplete
        id={id}
        value={value}
        onChange={(next: string) => onChange?.(next)}
        onBlur={onBlur}
        disabled={disabled}
        maxLength={singleLineMax}
        options={field.enum_suggestions.map((item) => ({ value: item }))}
        placeholder={fieldPlaceholder(field)}
      />
    );
  }
  return (
    <Input
      id={id}
      value={value ?? ""}
      onChange={(event) => onChange?.(event.target.value)}
      onBlur={onBlur}
      disabled={disabled}
      maxLength={singleLineMax}
      placeholder={fieldPlaceholder(field)}
    />
  );
}

export default function ProfileFieldInputs({
  section,
  namePrefix,
  disabled = false,
  singleLineMax,
  multiLineMax,
  onSetPreference,
}: Props) {
  const hiddenFields = section.fields.filter((field) => field.hidden);
  const visibleFields = section.fields.filter(
    (field) => !field.hidden && field.field_type !== "photo",
  );
  const collapsedFields = visibleFields.filter(isCollapsed);
  const expandedFields = visibleFields.filter((field) => !isCollapsed(field));
  const hasMore = collapsedFields.length > 0;

  const expandAll = () => {
    collapsedFields.forEach((field) => onSetPreference(field, { collapsed_override: false }));
  };
  const collapseAll = () => {
    visibleFields
      .filter((field) => field.default_collapsed && !isCollapsed(field))
      .forEach((field) => onSetPreference(field, { collapsed_override: true }));
  };

  const renderField = (field: FieldOut) => {
    const required = field.section_key === "basic_info" && field.key === "name";
    // 多行文本与日期区间需要整行宽度：半列里日期选择器会被压成细条、多行文本失去可读宽度。
    const wide = field.field_type === "multi_line" || field.field_type === "date_text";
    return (
      <div key={field.field_id} className={"profile-field-grid-item" + (wide ? " is-wide" : "")}>
        <Form.Item
          name={[...namePrefix, field.field_id]}
          label={field.label}
          rules={
            required ? [{ required: true, message: t("profileLibrary.field.required") }] : undefined
          }
          extra={field.private ? t("profileLibrary.field.private") : undefined}
          // 网格已经给出横向间距，行间只剩 12px：13 个大字段纵向不再各占一行半。
          style={{ marginBottom: 12 }}
        >
          <InputForField
            field={field}
            disabled={disabled}
            singleLineMax={singleLineMax}
            multiLineMax={multiLineMax}
          />
        </Form.Item>
      </div>
    );
  };

  const hiddenList = (
    <div className="profile-hidden-field-list">
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t("profileLibrary.field.hiddenHint")}
      </Typography.Paragraph>
      {hiddenFields.map((field) => (
        <div key={field.field_id} className="profile-hidden-field-row">
          <Typography.Text>{field.label}</Typography.Text>
          <Button size="small" onClick={() => onSetPreference(field, { hidden: false })}>
            {t("profileLibrary.field.restore")}
          </Button>
        </div>
      ))}
    </div>
  );

  const showCollapseAll = !hasMore && visibleFields.some((field) => field.default_collapsed);

  return (
    <div className="profile-field-inputs">
      <div className="profile-field-grid">
        {expandedFields.map(renderField)}
        {hasMore ? (
          <div className="profile-field-grid-actions">
            <Button type="link" size="small" onClick={expandAll}>
              {t("profileLibrary.field.more")}
            </Button>
          </div>
        ) : null}
        {hasMore ? null : collapsedFields.map(renderField)}
        {hiddenFields.length > 0 || showCollapseAll ? (
          <div className="profile-field-grid-actions">
            {hiddenFields.length > 0 ? (
              <Popover
                content={hiddenList}
                title={t("profileLibrary.field.hiddenHint")}
                trigger="click"
              >
                <Button type="link" size="small">
                  {t("profileLibrary.field.hiddenList", { count: hiddenFields.length })}
                </Button>
              </Popover>
            ) : null}
            {showCollapseAll ? (
              <Button type="link" size="small" onClick={collapseAll}>
                {t("profileLibrary.field.less")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
