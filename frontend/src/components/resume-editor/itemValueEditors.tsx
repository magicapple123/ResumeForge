// SPDX-License-Identifier: Apache-2.0
/**
 * item 的**值编辑控件**（按 format / kind 分派）：
 * 文本 / 日期 / 日期范围（两个输入）/ 枚举下拉 / URL / 列表逐项 / 作者行。
 *
 * 只负责"值"，位置 / 标签 / 样式在 ItemEditor 里；拆开是为了让文件各守 400 行预算。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Select, Tooltip } from "antd";
import { useI18n } from "../../i18n/i18nContext";
import type { DocumentFieldCatalog } from "../../types/resumeDocument";
import type { AuthorsItem, FieldItem, ListItem } from "../../types/resumeDocument";
import { enumOptionsOf } from "../../features/resume-document/fieldCatalog";
import { joinDateRange, splitDateRange } from "../../features/resume-document/format";

interface FieldValueProps {
  item: FieldItem;
  sectionKey: string;
  catalog?: DocumentFieldCatalog | null;
  disabled?: boolean;
  onChange: (patch: Partial<FieldItem>) => void;
}

/** 单字段的值控件：format 决定用哪个输入控件。 */
export function FieldValueEditor({
  item,
  sectionKey,
  catalog,
  disabled = false,
  onChange,
}: FieldValueProps) {
  const { t } = useI18n();
  if (item.format === "date_range") {
    const { start, end } = splitDateRange(item.value);
    return (
      <div className="document-value-row">
        <Input
          disabled={disabled || undefined}
          aria-label={t("document.field.dateStart")}
          placeholder={t("document.field.dateStart")}
          value={start}
          onChange={(event) => onChange({ value: joinDateRange(event.target.value, end) })}
        />
        <Input
          disabled={disabled || undefined}
          aria-label={t("document.field.dateEnd")}
          placeholder={t("document.field.datePresent")}
          value={end}
          onChange={(event) => onChange({ value: joinDateRange(start, event.target.value) })}
        />
      </div>
    );
  }
  if (item.format === "enum") {
    const options = enumOptionsOf(catalog, sectionKey, item.key, t);
    return (
      <Select
        disabled={disabled || undefined}
        aria-label={t("document.field.value")}
        placeholder={t("document.field.enumPlaceholder")}
        style={{ width: "100%" }}
        value={item.value || undefined}
        options={options}
        onChange={(value: string) => onChange({ value })}
      />
    );
  }
  const placeholder =
    item.format === "url"
      ? t("document.field.urlPlaceholder")
      : t("document.field.valuePlaceholder");
  const multiline = item.placement === "body";
  return multiline ? (
    <Input.TextArea
      disabled={disabled || undefined}
      aria-label={t("document.field.value")}
      placeholder={t("document.field.textPlaceholder")}
      autoSize={{ minRows: 2, maxRows: 8 }}
      value={item.value}
      onChange={(event) => onChange({ value: event.target.value })}
    />
  ) : (
    <Input
      disabled={disabled || undefined}
      aria-label={t("document.field.value")}
      placeholder={placeholder}
      value={item.value}
      onChange={(event) => onChange({ value: event.target.value })}
    />
  );
}

interface ListValuesProps {
  item: ListItem;
  disabled?: boolean;
  onChange: (patch: Partial<ListItem>) => void;
}

/** 列表值：逐项输入，可增删（空行不保存为有效值，但仍留在编辑器里让用户继续输入）。 */
export function ListValuesEditor({ item, disabled = false, onChange }: ListValuesProps) {
  const { t } = useI18n();
  const update = (index: number, value: string) => {
    const values = item.values.slice();
    values[index] = value;
    onChange({ values });
  };
  return (
    <div className="document-body-list">
      {item.values.map((value, index) => (
        <div className="document-value-row" key={`${item.id}-${index}`}>
          <Input
            disabled={disabled || undefined}
            aria-label={t("document.field.valueAria", { index: index + 1 })}
            placeholder={t("document.field.listPlaceholder")}
            value={value}
            onChange={(event) => update(index, event.target.value)}
          />
          <Tooltip title={t("document.field.removeValue")}>
            <Button
              size="small"
              disabled={disabled || undefined}
              type="text"
              danger
              aria-label={t("document.field.removeValue")}
              onClick={() => onChange({ values: item.values.filter((_, at) => at !== index) })}
            >
              ×
            </Button>
          </Tooltip>
        </div>
      ))}
      {item.values.length === 0 ? (
        <span className="document-section-hint">{t("document.field.listEmpty")}</span>
      ) : null}
      <div>
        <Button
          size="small"
          disabled={disabled || undefined}
          icon={<PlusOutlined />}
          onClick={() => onChange({ values: [...item.values, ""] })}
        >
          {t("document.field.listAdd")}
        </Button>
      </div>
    </div>
  );
}

interface AuthorsProps {
  item: AuthorsItem;
  disabled?: boolean;
  onChange: (patch: Partial<AuthorsItem>) => void;
}

/** 作者 / 发明人：姓名 + 本人 + 通讯；顺序即署名顺序。 */
export function AuthorsValuesEditor({ item, disabled = false, onChange }: AuthorsProps) {
  const { t } = useI18n();
  const update = (index: number, patch: Partial<AuthorsItem["authors"][number]>) => {
    const authors = item.authors.map((author, at) =>
      at === index ? { ...author, ...patch } : author,
    );
    onChange({ authors });
  };
  return (
    <div className="document-body-list">
      {item.authors.map((author, index) => (
        <div className="document-value-row" key={`${item.id}-${index}`}>
          <Input
            disabled={disabled || undefined}
            aria-label={t("document.field.authorName")}
            placeholder={t("document.field.authorNamePlaceholder")}
            value={author.name}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <Checkbox
            disabled={disabled || undefined}
            checked={author.is_self}
            onChange={(event) => update(index, { is_self: event.target.checked })}
          >
            {t("document.field.authorSelf")}
          </Checkbox>
          <Checkbox
            disabled={disabled || undefined}
            checked={author.corresponding}
            onChange={(event) => update(index, { corresponding: event.target.checked })}
          >
            {t("document.field.authorCorresponding")}
          </Checkbox>
          <Tooltip title={t("document.field.authorRemove")}>
            <Button
              size="small"
              disabled={disabled || undefined}
              type="text"
              danger
              aria-label={t("document.field.authorRemove")}
              onClick={() => onChange({ authors: item.authors.filter((_, at) => at !== index) })}
            >
              ×
            </Button>
          </Tooltip>
        </div>
      ))}
      {item.authors.length === 0 ? (
        <span className="document-section-hint">{t("document.field.authorsEmpty")}</span>
      ) : null}
      <div>
        <Button
          size="small"
          disabled={disabled || undefined}
          icon={<PlusOutlined />}
          onClick={() =>
            onChange({
              authors: [...item.authors, { name: "", is_self: false, corresponding: false }],
            })
          }
        >
          {t("document.field.authorsAdd")}
        </Button>
      </div>
    </div>
  );
}
