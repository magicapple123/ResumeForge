// SPDX-License-Identifier: Apache-2.0
/**
 * 选中 item 的编辑面板：值控件（按 format/kind 分派）+ 位置 / 标签 / 样式开关。
 *
 * 位置也能用 Select 改（不只靠拖拽）：键盘用户不方便拖，Select 是**可访问的等价入口**。
 */
import { Input, Segmented, Select, Switch, Tooltip } from "antd";
import type { MessageKey } from "../../i18n";
import { useI18n } from "../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  Placement,
  ResumeDocument,
  ResumeItem,
} from "../../types/resumeDocument";
import {
  allowedPlacementsForItem,
  getItemPlacement,
  updateAuthorsItem,
  updateFieldItem,
  updateListItem,
  updateTextItem,
} from "../../features/resume-document";
import { AuthorsValuesEditor, FieldValueEditor, ListValuesEditor } from "./itemValueEditors";

const PLACEMENT_LABEL_KEYS: Record<Placement, MessageKey> = {
  title: "document.placement.title",
  meta: "document.placement.meta",
  lead: "document.placement.lead",
  trail: "document.placement.trail",
  body: "document.placement.body",
  hidden: "document.placement.hidden",
};

interface Props {
  document: ResumeDocument;
  path: string;
  item: ResumeItem;
  sectionKey: string;
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  onChange: (next: ResumeDocument) => void;
}

export default function ItemEditor({
  document,
  path,
  item,
  sectionKey,
  catalog = null,
  readOnly = false,
  onChange,
}: Props) {
  const { t } = useI18n();
  const placement = getItemPlacement(item);
  const updateField = (patch: Parameters<typeof updateFieldItem>[2]) =>
    onChange(updateFieldItem(document, path, patch));
  const updateList = (patch: Parameters<typeof updateListItem>[2]) =>
    onChange(updateListItem(document, path, patch));
  const updateAuthors = (patch: Parameters<typeof updateAuthorsItem>[2]) =>
    onChange(updateAuthorsItem(document, path, patch));
  const updateText = (patch: Parameters<typeof updateTextItem>[2]) =>
    onChange(updateTextItem(document, path, patch));

  const isCustomField = item.kind !== "text" && item.key.startsWith("custom:");
  const allowed = allowedPlacementsForItem(item);
  const bodyStyleValue =
    item.kind === "text"
      ? item.style
      : item.kind === "field" || item.kind === "list"
        ? item.body_style
        : "bullet";
  const setBodyStyle = (value: "bullet" | "paragraph") => {
    if (item.kind === "text") updateText({ style: value });
    else if (item.kind === "field") updateField({ body_style: value });
    else if (item.kind === "list") updateList({ body_style: value });
  };

  return (
    <div className="document-item-editor" data-document-item-editor={path}>
      {isCustomField && item.kind === "field" ? (
        <div className="document-value-row">
          <span className="document-zone-label">{t("document.field.label")}</span>
          <Input
            aria-label={t("document.field.label")}
            placeholder={t("document.field.labelPlaceholder")}
            value={item.label}
            disabled={readOnly}
            onChange={(event) => updateField({ label: event.target.value })}
          />
        </div>
      ) : null}

      {item.kind === "field" ? (
        <FieldValueEditor
          item={item}
          sectionKey={sectionKey}
          catalog={catalog}
          disabled={readOnly}
          onChange={(patch) => updateField(patch)}
        />
      ) : null}
      {item.kind === "list" ? (
        <ListValuesEditor item={item} disabled={readOnly} onChange={(patch) => updateList(patch)} />
      ) : null}
      {item.kind === "authors" ? (
        <AuthorsValuesEditor
          item={item}
          disabled={readOnly}
          onChange={(patch) => updateAuthors(patch)}
        />
      ) : null}
      {item.kind === "text" ? (
        <Input.TextArea
          aria-label={t("document.field.value")}
          placeholder={t("document.field.textPlaceholder")}
          autoSize={{ minRows: 2, maxRows: 8 }}
          value={item.text}
          disabled={readOnly}
          onChange={(event) => updateText({ text: event.target.value })}
        />
      ) : null}

      <div className="document-toggles">
        {allowed.length > 0 ? (
          <Tooltip title={t("document.placement.aria")}>
            <Select
              size="small"
              aria-label={t("document.placement.aria")}
              style={{ width: 132 }}
              value={placement}
              disabled={readOnly}
              options={allowed.map((value) => ({ value, label: t(PLACEMENT_LABEL_KEYS[value]) }))}
              onChange={(value: Placement) => {
                if (item.kind === "text") return;
                if (item.kind === "field") updateField({ placement: value });
                else if (item.kind === "list") updateList({ placement: value });
                else updateAuthors({ placement: value });
              }}
            />
          </Tooltip>
        ) : null}

        {placement === "body" || item.kind === "text" ? (
          <Segmented
            disabled={readOnly || undefined}
            size="small"
            aria-label={t("document.item.bodyStyle")}
            value={bodyStyleValue}
            options={[
              { value: "bullet", label: t("document.item.bodyStyle.bullet") },
              { value: "paragraph", label: t("document.item.bodyStyle.paragraph") },
            ]}
            onChange={(value) => setBodyStyle(value as "bullet" | "paragraph")}
          />
        ) : null}

        {item.kind !== "text" && (placement === "lead" || placement === "trail") ? (
          <>
            <label className="document-drag-hint">
              <Switch
                size="small"
                aria-label={t("document.item.showLabel")}
                checked={item.show_label}
                disabled={readOnly}
                onChange={(checked) => {
                  if (item.kind === "field") updateField({ show_label: checked });
                  else if (item.kind === "list") updateList({ show_label: checked });
                  else updateAuthors({ show_label: checked });
                }}
              />{" "}
              {t("document.item.showLabel")}
            </label>
            <label className="document-drag-hint">
              <Switch
                size="small"
                aria-label={t("document.item.solo")}
                checked={item.solo}
                disabled={readOnly}
                onChange={(checked) => {
                  if (item.kind === "field") updateField({ solo: checked });
                  else if (item.kind === "list") updateList({ solo: checked });
                  else updateAuthors({ solo: checked });
                }}
              />{" "}
              {t("document.item.solo")}
            </label>
          </>
        ) : null}

        {/* 「值加括号」只在 planner **真正消费** wrap 的位置出现：正文块与行内板块的 body
            位置（`document_plan.py` 的 `_body_blocks` / `_inline_rows`）。title / meta /
            lead / trail 的括号不会出现在纸面上（Q17），摆一个改了没反应的开关只会让人以为坏了。 */}
        {item.kind === "field" && item.format !== "date_range" && placement === "body" ? (
          <label className="document-drag-hint">
            <Switch
              size="small"
              aria-label={t("document.item.wrap")}
              checked={item.wrap === "paren"}
              disabled={readOnly}
              onChange={(checked) => updateField({ wrap: checked ? "paren" : "none" })}
            />{" "}
            {t("document.item.wrap")}
          </label>
        ) : null}
      </div>
    </div>
  );
}
