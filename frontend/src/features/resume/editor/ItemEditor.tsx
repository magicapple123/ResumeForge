// SPDX-License-Identifier: Apache-2.0
/**
 * 选中 item 的编辑面板：值控件（按 format/kind 分派）+ 位置 / 标签 / 样式开关。
 *
 * 位置也能用 Select 改（不只靠拖拽）：键盘用户不方便拖，Select 是**可访问的等价入口**。
 */
import { ReloadOutlined } from "@ant-design/icons";
import { Button, Input, Segmented, Select, Switch, Tooltip } from "antd";
import type { MessageKey } from "../../../i18n";
import { useI18n } from "../../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  Placement,
  ResumeDocument,
  ResumeItem,
  SectionKind,
} from "../../../types/resumeDocument";
import {
  allowedPlacementsForItem,
  getItemPlacement,
  updateAuthorsItem,
  updateFieldItem,
  updateListItem,
  updateTextItem,
} from "../document";
import InlineMarkButtons from "../layout/InlineMarkButtons";
import InlineMarkContextMenu from "../layout/InlineMarkContextMenu";
import { AuthorsValuesEditor, FieldValueEditor, ListValuesEditor } from "./itemValueEditors";
import { applyInlineEdit, getFocusedField } from "./lastFocusedTextarea";
import { registerInlineMarkField, useInlineMarkRange } from "./useInlineMarkRange";
import "./document-item-editor.css";

const PLACEMENT_LABEL_KEYS: Record<Placement, MessageKey> = {
  title: "document.placement.title",
  meta: "document.placement.meta",
  lead: "document.placement.lead",
  trail: "document.placement.trail",
  body: "document.placement.body",
  hidden: "document.placement.hidden",
};

/**
 * 行内板块（技能 / 语言）的位置名：纸面上只有「黑字主文本 / 灰字补充 / 隐藏」三种结果，
 * 所以不复用条目卡那套（`document.placement.*`：标题行 / 元信息 / 正文前灰字 …）。
 */
const INLINE_PLACEMENT_LABEL_KEYS: Record<Placement, MessageKey> = {
  body: "document.placement.inline.body",
  trail: "document.placement.inline.trail",
  hidden: "document.placement.inline.hidden",
  title: "document.placement.title",
  meta: "document.placement.meta",
  lead: "document.placement.lead",
};

interface Props {
  document: ResumeDocument;
  path: string;
  item: ResumeItem;
  sectionKey: string;
  /** 板块类型：`inline` 用另一套位置名与位置集（问题 10）。缺省 = 普通条目板块。 */
  sectionKind?: SectionKind;
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  onChange: (next: ResumeDocument) => void;
}

export default function ItemEditor({
  document,
  path,
  item,
  sectionKey,
  sectionKind,
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

  const isInlineSection = sectionKind === "inline" && item.kind !== "text";
  const allowed = allowedPlacementsForItem(item, sectionKind);
  const labelKeys = isInlineSection ? INLINE_PLACEMENT_LABEL_KEYS : PLACEMENT_LABEL_KEYS;
  const { getRange } = useInlineMarkRange();
  /** 目录里的默认字段名：标签输入框的占位符（空值 = 跟随目录/字段语言）。 */
  const defaultLabel =
    catalog?.sections
      .find((section) => section.key === sectionKey)
      ?.fields.find((field) => field.key === (item.kind === "text" ? "" : item.key))?.label ?? "";
  /** 标签写进哪条 item —— 三种 kind 都有自己的 `label`，空串 = 跟随目录。 */
  const setLabel = (label: string) => {
    if (item.kind === "field") updateField({ label });
    else if (item.kind === "list") updateList({ label });
    else if (item.kind === "authors") updateAuthors({ label });
  };
  const inlineCommit = (next: { text: string; selection: { start: number; end: number } }) =>
    applyInlineEdit({ text: next.text, start: next.selection.start, end: next.selection.end });
  /**
   * 下拉选项 = 允许集；**当前值不在允许集里时并进一条「（当前）」**（问题 10 的兜底）。
   *
   * 历史数据里存在"合法但已不在白名单"的组合（如 inline 行里出现 `lead`）。antd `Select`
   * 找不到匹配 option 时会**回退显示原始枚举**，于是英文 `lead` 直接漏到界面。兜底项只做
   * 展示，不假装用户能把它选回来，所以显式标「（当前）」。
   */
  const currentInAllowed = allowed.includes(placement);
  const placementOptions: { value: Placement; label: string }[] = allowed.map((value) => ({
    value,
    label: t(labelKeys[value]),
  }));
  if (!currentInAllowed) {
    placementOptions.push({
      value: placement,
      label: t("document.placement.currentOption", { label: t(labelKeys[placement]) }),
    });
  }
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
    <InlineMarkContextMenu onCommit={inlineCommit} disabled={readOnly}>
      <div className="document-item-editor" data-document-item-editor={path}>
        {/* R-11 / F22：行内格式（加粗 / 字号 / 颜色 / 链接）作用在"当前聚焦的输入框"上，
            按钮不持有内容、也不新增一层表单状态。 */}
        {readOnly ? null : (
          <div className="document-field-row">
            <span className="document-field-label">{t("document.inlineFormat")}</span>
            <InlineMarkButtons
              getTarget={getFocusedField}
              getRememberedRange={getRange}
              onCommit={inlineCommit}
            />
          </div>
        )}
        {/* F22：字段名对所有非正文 item 开放（以前只有自定义字段有输入框）。
            空值 = 跟随目录的默认名；填了之后**不再跟随「字段语言」**，所以给一颗恢复默认。 */}
        {item.kind !== "text" ? (
          <div className="document-field-row">
            <span className="document-field-label">{t("document.field.label")}</span>
            <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
              <Input
                aria-label={t("document.field.label")}
                placeholder={defaultLabel || t("document.field.labelPlaceholder")}
                value={item.label}
                disabled={readOnly}
                onFocus={registerInlineMarkField}
                onChange={(event) => setLabel(event.target.value)}
              />
              <Tooltip title={t("document.field.labelResetHint")}>
                <Button
                  size="small"
                  aria-label={t("document.field.labelReset")}
                  icon={<ReloadOutlined />}
                  disabled={readOnly || !item.label}
                  onClick={() => setLabel("")}
                />
              </Tooltip>
            </div>
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
          <ListValuesEditor
            item={item}
            disabled={readOnly}
            onChange={(patch) => updateList(patch)}
          />
        ) : null}
        {item.kind === "authors" ? (
          <AuthorsValuesEditor
            item={item}
            disabled={readOnly}
            onChange={(patch) => updateAuthors(patch)}
          />
        ) : null}
        {item.kind === "text" ? (
          <div className="document-field-row">
            <span className="document-field-label">{t("document.field.value")}</span>
            <Input.TextArea
              aria-label={t("document.field.value")}
              placeholder={t("document.field.textPlaceholder")}
              autoSize={{ minRows: 2, maxRows: 8 }}
              value={item.text}
              disabled={readOnly}
              onFocus={registerInlineMarkField}
              onChange={(event) => updateText({ text: event.target.value })}
            />
          </div>
        ) : null}

        {allowed.length > 0 ? (
          <div className="document-field-row">
            <span className="document-field-label">{t("document.placement.short")}</span>
            <Tooltip title={t("document.placement.aria")}>
              <Select
                size="small"
                aria-label={t("document.placement.aria")}
                style={{ width: 132 }}
                value={placement}
                disabled={readOnly}
                options={placementOptions}
                onChange={(value: Placement) => {
                  if (item.kind === "text") return;
                  if (item.kind === "field") updateField({ placement: value });
                  else if (item.kind === "list") updateList({ placement: value });
                  else updateAuthors({ placement: value });
                }}
              />
            </Tooltip>
          </div>
        ) : null}

        <div className="document-toggles">
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
    </InlineMarkContextMenu>
  );
}
