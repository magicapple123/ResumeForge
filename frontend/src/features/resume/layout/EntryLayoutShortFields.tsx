// SPDX-License-Identifier: Apache-2.0
/**
 * 灰色短字段顺序 / 显示（Q07/Q08/Q20）：lead↔trail、上下移动、隐藏/恢复、
 * 独占一行、显示标签，以及字段目录的中文标签。
 *
 * 从 `EntryLayoutPanel` 拆出（单文件 500 行预算），行为不变：
 * - 顺序 = 纸上从左到右的排列（lead 组在前、trail 组在后）；
 * - 显示名优先显式 label，其次字段目录标签，最后才退回原始 key（Q20）；
 * - 写回全走 `features/resume/document/placement` 的不可变实现。
 */
import { Button, Dropdown, Segmented } from "antd";
import type { MenuProps } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, EyeOutlined, MoreOutlined } from "@ant-design/icons";
import { Fragment, useCallback, useMemo } from "react";
import { useLocale } from "../../../i18n/i18nContext";
import { t } from "../../../i18n";
import type {
  DocumentFieldCatalog,
  Placement,
  ResumeDocument,
  ResumeEntry,
} from "../../../types/resumeDocument";
import { updateFieldItem } from "../document/mutations";
import { fieldCatalogLabelResolver } from "../document/fieldCatalog";
import { moveItem, reorderItems } from "../document/placement";
import { shortFieldRows, type ShortFieldRow } from "./entryLayoutModel";

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
  // #16：展示序 = lead → trail（组序 = 纸面顺序）；上下键的邻居判定也按这份序。
  const orderedRows = useMemo(
    () => [
      ...rows.filter((row) => row.placement === "lead"),
      ...rows.filter((row) => row.placement === "trail"),
    ],
    [rows],
  );
  const leadCount = orderedRows.filter((row) => row.placement === "lead").length;
  // #16：↑↓ 只在**组内**移动。document 层的 reorderItems 本来就会拒绝越界，但组边界的
  // 按钮如果亮着却什么都不发生，用户会以为坏了——这里按组首/组尾把按钮置灰。
  const groupStart = (row: ShortFieldRow) => (row.placement === "lead" ? 0 : leadCount);
  const groupEnd = (row: ShortFieldRow) =>
    row.placement === "lead" ? leadCount - 1 : orderedRows.length - 1;
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

  /** 「⋯」菜单的动作 key；与菜单 items 一一对应（R-10）。 */
  type FieldMenuKey = "solo" | "showLabel" | "hide";
  const menuItemsOf = (row: ShortFieldRow): MenuProps["items"] => [
    { key: "solo", label: t("structure.layout.solo"), disabled: !row.canSolo },
    { key: "showLabel", label: t("structure.layout.showLabel") },
    { type: "divider" as const },
    { key: "hide", label: t("structure.layout.itemHidden"), danger: true },
  ];
  const selectedKeysOf = (row: ShortFieldRow): string[] => {
    const keys: string[] = [];
    if (row.solo && row.canSolo) keys.push("solo");
    if (row.showLabel) keys.push("showLabel");
    return keys;
  };
  const handleMenuClick = (row: ShortFieldRow, key: FieldMenuKey) => {
    if (key === "solo") {
      toggleSolo(row, !row.solo);
      return;
    }
    if (key === "showLabel") {
      toggleShowLabel(row, !row.showLabel);
      return;
    }
    hideShortField(row);
  };

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
          {/* #16：展示序 = lead → trail（组序 = 纸面顺序），分隔行插在两个边界；
              切「前/后」会跳到对应组（R-10 的不跳位让位于纸面一致性，滚动锚兜住）。 */}
          {orderedRows.map((row, index) => (
            <Fragment key={row.path}>
              {index === 0 && leadCount > 0 ? (
                <li className="rf-entry-layout-group-sep" aria-hidden="true">
                  {t("structure.layout.placementShort.lead")}
                </li>
              ) : null}
              {index === leadCount ? (
                <li className="rf-entry-layout-group-sep" aria-hidden="true">
                  {t("structure.layout.placementShort.trail")}
                </li>
              ) : null}
              <li className="rf-entry-layout-field" data-field-path={row.path}>
                {/* R3：省略号必须配 title（长字段名在 360px 下会被截断）。 */}
                <span className="rf-entry-layout-field-label" title={row.label}>
                  {row.label}
                </span>
                <div className="rf-entry-layout-field-controls">
                  <Segmented
                    className="rf-entry-layout-field-placement"
                    size="small"
                    value={row.placement}
                    disabled={locked}
                    aria-label={t("structure.layout.fieldPlacementAria", { name: row.label })}
                    options={[
                      { value: "lead", label: t("structure.layout.placementShort.lead") },
                      { value: "trail", label: t("structure.layout.placementShort.trail") },
                    ]}
                    onChange={(value) => setShortFieldPlacement(row, value as "lead" | "trail")}
                  />
                  <div className="rf-entry-layout-field-move">
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowUpOutlined />}
                      disabled={locked || index === groupStart(row)}
                      aria-label={t("structure.action.moveUp")}
                      onClick={() => moveShortField(row, -1)}
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<ArrowDownOutlined />}
                      disabled={locked || index === groupEnd(row)}
                      aria-label={t("structure.action.moveDown")}
                      onClick={() => moveShortField(row, 1)}
                    />
                  </div>
                  {/* R-10：独占一行/显示字段名/隐藏收进菜单（行内不再有常显 Switch）。 */}
                  <Dropdown
                    trigger={["click"]}
                    disabled={locked}
                    menu={{
                      items: menuItemsOf(row),
                      selectable: true,
                      multiple: true,
                      selectedKeys: selectedKeysOf(row),
                      onClick: ({ key }) => handleMenuClick(row, key as FieldMenuKey),
                    }}
                  >
                    <Button
                      type="text"
                      size="small"
                      className="rf-entry-layout-field-more"
                      icon={<MoreOutlined />}
                      disabled={locked}
                      aria-label={t("structure.layout.fieldActionsAria", { name: row.label })}
                      title={t("structure.layout.fieldActionsAria", { name: row.label })}
                    />
                  </Dropdown>
                </div>
              </li>
            </Fragment>
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
