// SPDX-License-Identifier: Apache-2.0
/**
 * 一个条目内的字段输入（F6）：三种文本形态 + 用户隐藏恢复。
 *
 * - 输入只使用三种文本形态（单行/多行/日期）；照片走资料页的专门入口，不在这里；
 * - 枚举只是**输入建议**（AutoComplete，可自由输入），不做校验拦截；
 * - 字段一律渲染，不再有「更多字段 / 收起更多字段」折叠（2026-10-27 用户要求去掉）：
 *   服务端 FieldOut 仍带 default_collapsed / collapsed_override（DTO 兼容），界面**不读**它们；
 * - hidden 字段不渲染，只在「已隐藏 N 个字段」里恢复——用户明确说"隐藏就够了"。
 */
import { AutoComplete, Button, Form, Input, Popover, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import PartialDateSelect from "../../components/profile/PartialDateSelect";
import type { FieldOut, SectionOut } from "./types";

interface Props {
  section: SectionOut;
  /** 指向该条目 values 对象的 Form.Item name 前缀。 */
  namePrefix: (string | number)[];
  disabled?: boolean;
  singleLineMax: number;
  multiLineMax: number;
  onSetPreference: (field: FieldOut, patch: { hidden?: boolean }) => void;
}

function fieldPlaceholder(field: FieldOut): string {
  if (field.enum_suggestions.length > 0) return t("profileLibrary.field.placeholder");
  return t("profileLibrary.field.placeholder");
}

/**
 * 这个日期字段该不该有「至今」勾选框。
 *
 * 「至今」只对**区间的结束端**有意义（教育 / 工作的"结束时间"）。此前一个 `date_text`
 * 就无条件给，于是「出生年月」「获奖时间」「取得时间」「年份」这类**点日期**也长出
 * 一只「至今」——勾上等于把 2004-11 说成"仍在 2004-11"，语义不成立，取消时还会把原值
 * 吞成空（用户实测 2004-11-10 勾上再取消变空）。
 *
 * 判定按字段定义走，不看分区：`end_date` 结尾是内置区间的结束端；用户自建的小字段
 * 没有这个约定，因此额外认标签里的「结束 / 截止」。
 */
function allowsOngoing(field: FieldOut): boolean {
  if (field.field_type !== "date_text") return false;
  if (field.key.endsWith("end_date")) return true;
  // 匹配后端给的中文字段标签，不是界面文案（永远不该翻）。
  return /结束|截止/.test(field.label); // i18n-ok: 用中文匹配后端字段标签
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
  useLocale();
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
        allowOngoing={allowsOngoing(field)}
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
  useLocale();
  const hiddenFields = section.fields.filter((field) => field.hidden);
  const visibleFields = section.fields.filter(
    (field) => !field.hidden && field.field_type !== "photo",
  );

  const renderField = (field: FieldOut) => {
    const required = field.section_key === "basic_info" && field.key === "name";
    // 只有多行文本需要整行（半列里失去可读宽度）。日期不再整行：年/月/日三个下拉
    // 排在一格里，相邻字段（姓名 / 性别 / 出生年月、开始 / 结束）才能落在同一行。
    const wide = field.field_type === "multi_line";
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

  return (
    <div className="profile-field-inputs">
      <div className="profile-field-grid">
        {visibleFields.map(renderField)}
        {hiddenFields.length > 0 ? (
          <div className="profile-field-grid-actions">
            <Popover
              content={hiddenList}
              title={t("profileLibrary.field.hiddenTitle")}
              trigger="click"
            >
              <Button type="link" size="small">
                {t("profileLibrary.field.hiddenList", { count: hiddenFields.length })}
              </Button>
            </Popover>
          </div>
        ) : null}
      </div>
    </div>
  );
}
