// SPDX-License-Identifier: Apache-2.0
/**
 * 行内板块（技能 / 语言）的**一条 entry 一行**（Q06）。
 *
 * 修复前的 inline 分支只渲染 `section.entries[0]`：v1→v2 转换器把每个技能 / 每种语言
 * 转成一条 entry，于是 14 条技能在编辑器里只看得到第 1 条，其余条目在纸上却存在——用户
 * 既看不到也改不了，还不能新增。现在：
 *
 * - 每条 entry 一行：正文 chips + 灰色 chips（+ 隐藏字段区），与纸面"一行一条"对齐；
 * - 行操作：上移 / 下移 / 隐藏 / 移除（与条目卡同一套语义，纯函数来自 `features`）；
 * - 行内添加字段：选中这一行（点任一行内字段或结构树选中条目）时出现 body / trail 菜单；
 * - 结构树选中 `section.entry.id` 时整行高亮（`is-selected`）——修复前选中第 2 条什么都看不到。
 */
import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import { useI18n } from "../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  ResumeDocument,
  ResumeEntry,
  ResumeSection,
} from "../../types/resumeDocument";
import {
  entryPath as buildEntryPath,
  getItemPlacement,
  moveEntry,
  removeEntry,
  toggleEntryHidden,
} from "../../features/resume-document";
import AddFieldMenu from "./AddFieldMenu";
import ItemChipRow from "./ItemChipRow";

interface Props {
  document: ResumeDocument;
  section: ResumeSection;
  entry: ResumeEntry;
  entryIndex: number;
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  selectedPath?: string | null;
  onSelectPath: (path: string | null) => void;
  onChange: (next: ResumeDocument) => void;
  onHoverPath?: (path: string | null) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function InlineEntryRow({
  document,
  section,
  entry,
  entryIndex,
  catalog = null,
  readOnly = false,
  selectedPath,
  onSelectPath,
  onChange,
  onHoverPath,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const [entryMenuOpen, setEntryMenuOpen] = useState(false);
  const entryId = entry.id ?? "";
  const entryPath = buildEntryPath(section.key, entryId);
  const selected = selectedPath === entryPath || (selectedPath ?? "").startsWith(`${entryPath}.`);
  const bodyItems = entry.items.filter((item) => getItemPlacement(item) === "body");
  const greyItems = entry.items.filter((item) => {
    const placement = getItemPlacement(item);
    return placement !== "body" && placement !== "hidden";
  });
  const hiddenItems = entry.items.filter((item) => getItemPlacement(item) === "hidden");

  const row = (items: typeof entry.items) =>
    items.length > 0 ? (
      <ItemChipRow
        document={document}
        section={section}
        entryId={entryId}
        items={items}
        catalog={catalog}
        readOnly={readOnly}
        selectedPath={selectedPath}
        onSelectPath={onSelectPath}
        onChange={onChange}
        onHoverPath={onHoverPath}
        onNotice={onNotice}
      />
    ) : null;

  const entryMenu: MenuProps = {
    items: [
      {
        key: "toggle",
        label: entry.hidden ? t("document.entry.show") : t("document.entry.hide"),
      },
      { key: "remove", label: t("document.entry.remove"), danger: true },
    ],
    onClick: ({ key }) => {
      setEntryMenuOpen(false);
      if (key === "toggle") {
        onChange(toggleEntryHidden(document, entryPath));
        onNotice(entry.hidden ? t("document.toast.shown") : t("document.toast.hidden"), "info");
        return;
      }
      if (key === "remove") {
        onChange(removeEntry(document, entryPath));
        onNotice(t("document.toast.entryRemoved"), "info");
      }
    },
  };

  return (
    <div
      className={[
        "document-inline-entry",
        selected ? "is-selected" : "",
        entry.hidden ? "is-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-document-entry={entryPath}
      data-document-inline-entry=""
    >
      <Dropdown
        menu={entryMenu}
        trigger={["contextMenu"]}
        disabled={readOnly}
        open={entryMenuOpen}
        onOpenChange={setEntryMenuOpen}
      >
        <div
          className="document-inline-entry-head"
          tabIndex={readOnly ? undefined : 0}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault();
              setEntryMenuOpen(true);
            }
          }}
        >
          <span className="document-entry-index">#{entryIndex + 1}</span>
          {entry.hidden ? (
            <span className="document-chip-badge">{t("document.entry.hidden")}</span>
          ) : null}
          {!readOnly ? (
            <span className="document-entry-actions">
              <Tooltip title={t("document.entry.moveUp")}>
                <Button
                  size="small"
                  type="text"
                  aria-label={t("document.entry.moveUp")}
                  disabled={entryIndex === 0}
                  icon={<ArrowUpOutlined />}
                  onClick={() => onChange(moveEntry(document, entryPath, "up"))}
                />
              </Tooltip>
              <Tooltip title={t("document.entry.moveDown")}>
                <Button
                  size="small"
                  type="text"
                  aria-label={t("document.entry.moveDown")}
                  disabled={entryIndex >= section.entries.length - 1}
                  icon={<ArrowDownOutlined />}
                  onClick={() => onChange(moveEntry(document, entryPath, "down"))}
                />
              </Tooltip>
            </span>
          ) : null}
        </div>
      </Dropdown>
      <div className="document-inline-entry-body">
        {row(bodyItems)}
        {row(greyItems)}
        {row(hiddenItems)}
      </div>
      {!readOnly && selected ? (
        <div className="document-add-row" data-document-inline-add="">
          <AddFieldMenu
            document={document}
            sectionKey={section.key}
            entryId={entryId}
            placement="body"
            catalog={catalog}
            readOnly={readOnly}
            label={t("document.addField.action")}
            onChange={onChange}
            onSelectPath={onSelectPath}
            onNotice={onNotice}
          />
          <AddFieldMenu
            document={document}
            sectionKey={section.key}
            entryId={entryId}
            placement="trail"
            catalog={catalog}
            readOnly={readOnly}
            label={t("document.detail.addTrail")}
            onChange={onChange}
            onSelectPath={onSelectPath}
            onNotice={onNotice}
          />
        </div>
      ) : null}
    </div>
  );
}
