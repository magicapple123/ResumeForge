// SPDX-License-Identifier: Apache-2.0
/**
 * item 的**值编辑控件**（按 format / kind 分派）：
 * 文本 / 日期 / 日期范围（两个输入）/ 枚举下拉 / URL / 列表逐项 / 作者行。
 *
 * 只负责"值"，位置 / 标签 / 样式在 ItemEditor 里；拆开是为了让文件各守 400 行预算。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Select, Tooltip } from "antd";
import { useI18n } from "../../../i18n/i18nContext";
import type { DocumentFieldCatalog } from "../../../types/resumeDocument";
import type { AuthorsItem, FieldItem, ListItem } from "../../../types/resumeDocument";
import { enumOptionsOf } from "../document/fieldCatalog";
import { joinDateRange, splitDateRange } from "../document/format";
import ResizableValueTextArea from "./ResizableValueTextArea";

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
    /**
     * R-06 ②B：「至」只在**结束值是一个日期**时出现。
     *
     * 结束值有三种形态：真实日期（"2023-06"）、空串（还没填）、「至今」（在岗/在读）。
     * 后两种都不该出现连接词——空串时第二个框自己写着占位「至今」，再挂一个「至」就成了
     * 「至 至今」；而「至今」本身就是一句话的一部分，前面加「至」读作「至 至今」同样别扭。
     */
    const showSeparator = /\d/.test(end);
    return (
      <div className="document-field-row is-date-range">
        <span className="document-field-label-spacer" aria-hidden="true" />
        <Input
          disabled={disabled || undefined}
          aria-label={t("document.field.dateStart")}
          placeholder={t("document.field.dateStart")}
          value={start}
          onChange={(event) => onChange({ value: joinDateRange(event.target.value, end) })}
        />
        <span className="document-field-sep" aria-hidden="true">
          {showSeparator ? t("document.field.dateRangeSeparator") : ""}
        </span>
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
    const options = enumOptionsOf(catalog, sectionKey, item.key, t, item.value);
    // A5：自建枚举字段（key=custom:*、值表不在目录里）没有可枚举的选项——给一个自由输入
    // 比给一个空下拉好：空下拉既改不了值，又把原始 code 卡在框里；自由输入至少能继续编辑。
    if (options.length === 0) {
      return (
        <div className="document-field-row">
          <span className="document-field-label">{t("document.field.value")}</span>
          {/* 问题 8：单行语义 + 可拖高的文本域（自由输入的枚举字段同样要能看全文）。 */}
          <ResizableValueTextArea
            ariaLabel={t("document.field.value")}
            placeholder={t("document.field.enumPlaceholder")}
            value={item.value}
            disabled={disabled}
            onChange={(value) => onChange({ value })}
          />
        </div>
      );
    }
    return (
      <div className="document-field-row">
        <span className="document-field-label">{t("document.field.value")}</span>
        <Select
          disabled={disabled || undefined}
          aria-label={t("document.field.value")}
          placeholder={t("document.field.enumPlaceholder")}
          style={{ width: "100%" }}
          value={item.value || undefined}
          options={options}
          onChange={(value: string) => onChange({ value })}
        />
      </div>
    );
  }
  const placeholder =
    item.format === "url"
      ? t("document.field.urlPlaceholder")
      : t("document.field.valuePlaceholder");
  const multiline = item.placement === "body";
  return (
    <div className="document-field-row">
      <span className="document-field-label">{t("document.field.value")}</span>
      {multiline ? (
        <Input.TextArea
          disabled={disabled || undefined}
          aria-label={t("document.field.value")}
          placeholder={t("document.field.textPlaceholder")}
          autoSize={{ minRows: 2, maxRows: 8 }}
          value={item.value}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      ) : (
        // 问题 8：单行值也换成"一行高、可拖高"的文本域。
        // 多行字段（`placement === "body"`）仍然走上面的 `autoSize`——那里**要**自动长高，
        // 与"可拖手柄"互斥，两者各自服务不同的语义。
        <ResizableValueTextArea
          ariaLabel={t("document.field.value")}
          placeholder={placeholder}
          value={item.value}
          disabled={disabled}
          onChange={(value) => onChange({ value })}
        />
      )}
    </div>
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
