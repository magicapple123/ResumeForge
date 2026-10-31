// SPDX-License-Identifier: Apache-2.0
/**
 * 灰色短字段顺序 / 显示（Q07/Q08/Q20）：lead↔trail、上下移动、隐藏/恢复、
 * 独占一行、显示标签，以及字段目录的中文标签。
 *
 * 从 `EntryLayoutPanel` 拆出（单文件 500 行预算），行为不变：
 * - 顺序 = 纸上从左到右的排列（lead 组在前、trail 组在后）；
 * - 显示名优先显式 label，其次字段目录标签，最后才退回原始 key（Q20）；
 * - 写回全走 `features/resume-document/placement` 的不可变实现。
 */
import { Button, Radio, Switch, Tooltip } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, EyeOutlined } from "@ant-design/icons";
import { useCallback, useMemo } from "react";
import { useLocale } from "../../../i18n/i18nContext";
import { t } from "../../../i18n";
import type {
  DocumentFieldCatalog,
  Placement,
  ResumeDocument,
  ResumeEntry,
} from "../../../types/resumeDocument";
import { updateFieldItem } from "../../../features/resume-document/mutations";
import { fieldCatalogLabelResolver } from "../../../features/resume-document/fieldCatalog";
import { moveItem, reorderItems } from "../../../features/resume-document/placement";
import {
  shortFieldRows,
  type ShortFieldRow,
} from "../../../features/resume-layout/entryLayoutModel";

export interface EntryLayoutShortFieldsProps {
  document: ResumeDocument;
  sectionKey: string;
  entry: ResumeEntry;
  /** 制作台字段目录：没有显式 label 的字段用它显示中文名（Q20）。 */
  fieldCatalog?: DocumentFieldCatalog | null;
  /** 面板级禁用（宿主禁用 / 锁排版由调用方合并后传入）。 */
  disabled: boolean;
  /** 锁排版：禁用这一条的所有字段操作（与 `disabled` 分开只为可读）。 */
  layoutLocked: boolean;
  onChange: (next: ResumeDocument) => void;
}

export default function EntryLayoutShortFields({
  document,
  sectionKey,
  entry,
  fieldCatalog,
  disabled,
  layoutLocked,
  onChange,
}: EntryLayoutShortFieldsProps) {
  useLocale();
  // Q20：短字段没有 label 时用字段目录的中文标签；resolver 只收 key，这里绑定当前板块。
  const fieldLabel = useMemo(() => fieldCatalogLabelResolver(fieldCatalog), [fieldCatalog]);
  const shortFieldLabel = useCallback(
    (key: string) => fieldLabel(key, sectionKey),
    [fieldLabel, sectionKey],
  );
  const rows = useMemo(
    () => shortFieldRows(entry, sectionKey, shortFieldLabel),
    [entry, sectionKey, shortFieldLabel],
  );
  const hiddenRows = useMemo(
    () =>
      entry.items.flatMap((item) => {
        if (item.kind === "text" || item.placement !== "hidden") return [];
        return [
          {
            path: `${sectionKey}.${entry.id ?? ""}.${item.id}`,
            label: item.label || fieldLabel(item.key, sectionKey) || item.key,
            itemId: item.id,
          },
        ];
      }),
    [entry, sectionKey, fieldLabel],
  );
  const locked = disabled || layoutLocked;

  const moveShortField = (row: ShortFieldRow, delta: -1 | 1) => {
    const next = reorderItems(document, row.path, delta);
    if (next !== document) onChange(next);
  };
  const setShortFieldPlacement = (row: ShortFieldRow, placement: "lead" | "trail") => {
    const next = moveItem(document, row.path, { placement });
    if (next !== document) onChange(next);
  };
  const hideShortField = (row: ShortFieldRow) => {
    const next = moveItem(document, row.path, { placement: "hidden" as Placement });
    if (next !== document) onChange(next);
  };
  const showHiddenField = (path: string) => {
    const next = moveItem(document, path, { placement: "trail" });
    if (next !== document) onChange(next);
  };
  const toggleSolo = (row: ShortFieldRow, value: boolean) => {
    onChange(updateFieldItem(document, row.path, { solo: value }));
  };
  const toggleShowLabel = (row: ShortFieldRow, value: boolean) => {
    onChange(updateFieldItem(document, row.path, { show_label: value }));
  };

  return (
    <div className="rf-entry-layout-fields">
      <div className="rf-entry-layout-fields-title">{t("structure.layout.order")}</div>
      <div className="rf-entry-layout-fields-hint">{t("structure.layout.orderHint")}</div>
      {rows.length === 0 ? (
        <div className="rf-entry-layout-fields-hint">{t("structure.group.empty")}</div>
      ) : (
        <ul className="rf-entry-layout-field-list">
          {rows.map((row, index) => (
            <li key={row.path} className="rf-entry-layout-field" data-field-path={row.path}>
              <span className="rf-entry-layout-field-label">{row.label}</span>
              <Radio.Group
                size="small"
                value={row.placement}
                disabled={locked}
                aria-label={t("structure.action.moveToPlacement", {
                  placement: t(
                    row.placement === "lead"
                      ? "structure.placement.lead"
                      : "structure.placement.trail",
                  ),
                })}
                options={[
                  { value: "lead", label: t("structure.placement.lead") },
                  { value: "trail", label: t("structure.placement.trail") },
                ]}
                onChange={(event) =>
                  setShortFieldPlacement(row, event.target.value as "lead" | "trail")
                }
              />
              <Tooltip title={t("structure.layout.solo")}>
                <Switch
                  size="small"
                  checked={row.solo}
                  disabled={locked}
                  aria-label={t("structure.layout.solo")}
                  onChange={(checked) => toggleSolo(row, checked)}
                />
              </Tooltip>
              <Tooltip title={t("structure.layout.showLabel")}>
                <Switch
                  size="small"
                  checked={row.showLabel}
                  disabled={locked}
                  aria-label={t("structure.layout.showLabel")}
                  onChange={(checked) => toggleShowLabel(row, checked)}
                />
              </Tooltip>
              <Button
                type="text"
                size="small"
                icon={<ArrowUpOutlined />}
                disabled={locked || index === 0}
                aria-label={t("structure.action.moveUp")}
                onClick={() => moveShortField(row, -1)}
              />
              <Button
                type="text"
                size="small"
                icon={<ArrowDownOutlined />}
                disabled={locked || index === rows.length - 1}
                aria-label={t("structure.action.moveDown")}
                onClick={() => moveShortField(row, 1)}
              />
              <Button
                type="text"
                size="small"
                aria-label={t("structure.action.hide")}
                disabled={locked}
                onClick={() => hideShortField(row)}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      {hiddenRows.length > 0 ? (
        <>
          <div className="rf-entry-layout-fields-title">{t("structure.layout.visibility")}</div>
          <ul className="rf-entry-layout-field-list">
            {hiddenRows.map((row) => (
              <li
                key={row.path}
                className="rf-entry-layout-field is-hidden"
                data-field-path={row.path}
              >
                <span className="rf-entry-layout-field-label">{row.label}</span>
                <Button
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  aria-label={t("structure.layout.itemShown")}
                  disabled={locked}
                  onClick={() => showHiddenField(row.path)}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
