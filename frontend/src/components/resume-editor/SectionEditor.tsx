// SPDX-License-Identifier: Apache-2.0
/**
 * 一个板块的编辑器：按 kind 分派三种形态。
 *
 * - `entries`：条目卡列表 + 添加条目（系统板块与自建板块同构）；
 * - `inline`：行内条目（行内板块的 items 按顺序连成一段，body 黑字、trail 灰字）；
 * - `text`：单段文本板块（只有正文）。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useI18n } from "../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  ResumeDocument,
  ResumeSection,
} from "../../types/resumeDocument";
import {
  addEntry,
  catalogSectionOf,
  defaultInlineEntry,
  defaultTextItem,
  entryPath as buildEntryPath,
  getItemPlacement,
  itemPath as buildItemPath,
} from "../../features/resume-document";
import { addItem as addEntryItem } from "../../features/resume-document/mutations";
import EntryCard from "./EntryCard";
import InlineEntryRow from "./InlineEntryRow";
import ItemChipRow from "./ItemChipRow";

interface Props {
  document: ResumeDocument;
  section: ResumeSection;
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  selectedPath?: string | null;
  onSelectPath: (path: string | null) => void;
  onChange: (next: ResumeDocument) => void;
  onHoverPath?: (path: string | null) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function SectionEditor({
  document,
  section,
  catalog = null,
  readOnly = false,
  selectedPath,
  onSelectPath,
  onChange,
  onHoverPath,
  onNotice,
}: Props) {
  const { t } = useI18n();

  if (section.kind === "inline") {
    // 行内板块 = 纸面上一行一条 entry（技能 / 语言）。**每条都要渲染**：修复前写死
    // `section.entries[0]`，其余条目在编辑器里根本不存在（Q06）。
    const inlineTitle =
      section.layout.title_override ||
      section.title ||
      catalogSectionOf(catalog, section.key)?.title ||
      section.key;
    return (
      <div className="document-section" data-document-section={section.key}>
        <span className="document-section-hint">{t("document.section.inlineHint")}</span>
        {section.entries.length === 0 ? (
          <span className="document-group-empty">{t("document.section.inlineEmpty")}</span>
        ) : (
          section.entries.map((entry, index) => (
            <InlineEntryRow
              key={entry.id ?? `inline-entry-${index}`}
              document={document}
              section={section}
              entry={entry}
              entryIndex={index}
              catalog={catalog}
              readOnly={readOnly}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              onChange={onChange}
              onHoverPath={onHoverPath}
              onNotice={onNotice}
            />
          ))
        )}
        {!readOnly ? (
          <div className="document-add-row">
            <Button
              size="small"
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => {
                const created = addEntry(
                  document,
                  section.key,
                  defaultInlineEntry(catalog, section),
                );
                onChange(created.document);
                // 新建后自动选中这一条：行展开、行内添加字段就在手边，不用再找。
                onSelectPath(buildEntryPath(section.key, created.entryId));
                onNotice(t("document.toast.entryAdded"), "info");
              }}
            >
              {t("document.section.inlineAdd", { name: inlineTitle })}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (section.kind === "text") {
    const entry = section.entries[0];
    const entryId = entry?.id ?? "";
    const bodyItems = entry ? entry.items.filter((item) => getItemPlacement(item) === "body") : [];
    return (
      <div className="document-section" data-document-section={section.key}>
        <span className="document-section-hint">{t("document.section.textHint")}</span>
        {entry ? (
          <ItemChipRow
            document={document}
            section={section}
            entryId={entryId}
            items={bodyItems}
            catalog={catalog}
            readOnly={readOnly}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            onChange={onChange}
            onHoverPath={onHoverPath}
            onNotice={onNotice}
          />
        ) : null}
        {!readOnly ? (
          <div className="document-add-row">
            <Button
              size="small"
              type="dashed"
              icon={<PlusOutlined />}
              aria-label={t("document.body.addBlock")}
              onClick={() => {
                if (!entry) return;
                const item = defaultTextItem("", "paragraph");
                onChange(addEntryItem(document, section.key, entryId, item));
                onSelectPath(buildItemPath(section.key, entryId, item.id));
              }}
            >
              {t("document.body.addBlock")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="document-section" data-document-section={section.key}>
      {section.entries.length === 0 ? (
        <span className="document-group-empty">{t("document.entry.empty")}</span>
      ) : (
        section.entries.map((entry, index) => (
          <EntryCard
            key={entry.id ?? `entry-${index}`}
            document={document}
            section={section}
            entry={entry}
            entryIndex={index}
            catalog={catalog}
            readOnly={readOnly}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            onChange={onChange}
            onHoverPath={onHoverPath}
            onNotice={onNotice}
          />
        ))
      )}
      {!readOnly ? (
        <div className="document-add-row">
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => {
              const created = addEntry(document, section.key);
              onChange(created.document);
              onSelectPath(buildEntryPath(section.key, created.entryId));
              onNotice(t("document.toast.entryAdded"), "info");
            }}
          >
            {t("document.entry.add")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
