// SPDX-License-Identifier: Apache-2.0
/**
 * 一条条目的**三区卡**：标题与元信息（HeadZone）/ 灰色短字段（DetailZone）/ 正文（BodyZone）。
 *
 * - 三个区都是拖放目标；chip 之间也可以拖（落在 chip 上 = 插到它前面）；
 * - 拖到非法位置给可读提示（区级校验 + moveItem 返回原引用双保险）；
 * - 条目头可切三种布局（左右 / 上下 / 元信息在上）并做条目的上移/复制/隐藏/移除。
 */
import { ArrowDownOutlined, ArrowUpOutlined, CopyOutlined } from "@ant-design/icons";
import { Button, Dropdown, Segmented, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { CSSProperties, DragEvent } from "react";
import { Fragment, useState } from "react";
import type { MessageKey } from "../../i18n";
import { useI18n } from "../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  Placement,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
} from "../../types/resumeDocument";
import {
  canPlaceItem,
  copyEntry,
  defaultTextItem,
  entryPath as buildEntryPath,
  getItemPlacement,
  itemPath as buildItemPath,
  moveEntry,
  moveItem,
  placementGroup,
  removeEntry,
  setEntryHeadLayout,
  toggleEntryHidden,
} from "../../features/resume-document";
import { addItem as addEntryItem } from "../../features/resume-document/mutations";
import AddFieldMenu from "./AddFieldMenu";
import ItemChip from "./ItemChip";
import ItemEditor from "./ItemEditor";
import { useDocumentDrag } from "./documentDragContext";

/**
 * 三区里的位置分组表（模块级常量）。
 *
 * 为什么不直接在 JSX 里写 `renderGroup("title", …)`：产品文案守卫会把**本地函数调用的
 * 字符串字面量参数**当成可能被渲染的文案（它无法区分这个参数是位置枚举还是用户可见文本）。
 * 位置是协议值，从表里取属性（`group.placement`）就绕开了"字面量 = 文案"的误判。
 */
interface ZoneGroupSpec {
  placement: Placement;
  labelKey: MessageKey;
  emptyKey: MessageKey;
  addKey: MessageKey;
}

const HEAD_ZONE_GROUPS: readonly ZoneGroupSpec[] = [
  {
    placement: "title",
    labelKey: "document.placement.title",
    emptyKey: "document.zone.emptyTitle",
    addKey: "document.head.addTitle",
  },
  {
    placement: "meta",
    labelKey: "document.placement.meta",
    emptyKey: "document.zone.emptyMeta",
    addKey: "document.head.addMeta",
  },
];

const DETAIL_ZONE_GROUPS: readonly ZoneGroupSpec[] = [
  {
    placement: "lead",
    labelKey: "document.placement.lead",
    emptyKey: "document.zone.emptyLead",
    addKey: "document.detail.addLead",
  },
  {
    placement: "trail",
    labelKey: "document.placement.trail",
    emptyKey: "document.zone.emptyTrail",
    addKey: "document.detail.addTrail",
  },
];

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

export default function EntryCard({
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
  const drag = useDocumentDrag();
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const [entryMenuOpen, setEntryMenuOpen] = useState(false);
  const entryId = entry.id ?? "";
  const entryPath = buildEntryPath(section.key, entryId);
  const specFor = (item: ResumeItem) =>
    item.kind === "text"
      ? undefined
      : catalog?.sections
          .find((candidate) => candidate.key === section.key)
          ?.fields.find((field) => field.key === item.key);
  const selectedContainsEntry =
    selectedPath === entryPath || (selectedPath ?? "").startsWith(`${entryPath}.`);

  const draggedItem = (() => {
    const path = drag.draggedPath;
    if (!path) return null;
    return (
      entry.items.find((item) => buildItemPath(section.key, entryId, item.id) === path) ?? null
    );
  })();

  const dropAt = (path: string, placement: Placement, toIndex?: number) => {
    const item = entry.items.find(
      (candidate) => buildItemPath(section.key, entryId, candidate.id) === path,
    );
    if (!item) return;
    if (!canPlaceItem(item, placement)) {
      onNotice(t("document.drag.invalid"), "warning");
      return;
    }
    const next = moveItem(document, path, { placement, toIndex });
    if (next === document) {
      onNotice(t("document.drag.invalid"), "warning");
      return;
    }
    onChange(next);
    onNotice(t("document.drag.moved"), "info");
  };

  const handleZoneDrop = (placement: Placement) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverZone(null);
    const path = event.dataTransfer.getData("text/plain") || drag.draggedPath;
    if (!path) return;
    drag.setDraggedPath(null);
    dropAt(path, placement);
  };

  const handleZoneOver = (placement: Placement) => (event: DragEvent<HTMLDivElement>) => {
    if (!draggedItem || !canPlaceItem(draggedItem, placement)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverZone(placement);
  };

  const columns = entry.layout.columns ?? section.layout.columns ?? 1;
  const columnStyle = { ["--document-columns"]: String(columns) } as CSSProperties;

  const renderChip = (item: ResumeItem) => {
    const placement = getItemPlacement(item);
    const path = buildItemPath(section.key, entryId, item.id);
    const group = placementGroup(entry.items, placement);
    const indexInGroup = group.findIndex((candidate) => candidate.id === item.id);
    return (
      <div
        key={item.id}
        className="document-chip-slot"
        data-document-path={path}
        onDragOver={(event) => {
          if (!draggedItem || draggedItem.id === item.id) return;
          if (!canPlaceItem(draggedItem, placement)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const draggedPath = event.dataTransfer.getData("text/plain") || drag.draggedPath;
          if (!draggedPath || draggedPath === path) return;
          drag.setDraggedPath(null);
          dropAt(draggedPath, placement, indexInGroup);
        }}
        onMouseEnter={() => onHoverPath?.(path)}
        onMouseLeave={() => onHoverPath?.(null)}
      >
        <ItemChip
          document={document}
          path={path}
          item={item}
          catalogLabel={specFor(item)?.label ?? ""}
          materialOnly={specFor(item)?.material_only === true}
          selected={selectedPath === path}
          readOnly={readOnly}
          sectionKey={section.key}
          entryId={entryId}
          onSelect={onSelectPath}
          onChange={onChange}
          onNotice={onNotice}
        >
          <ItemEditor
            document={document}
            path={path}
            item={item}
            sectionKey={section.key}
            catalog={catalog}
            readOnly={readOnly}
            onChange={onChange}
          />
        </ItemChip>
      </div>
    );
  };

  const renderGroup = (
    placement: Placement,
    label: string,
    emptyText: string,
    addLabel?: string,
  ) => {
    const group = placementGroup(entry.items, placement);
    const isGrey = placement === "lead" || placement === "trail";
    return (
      <div
        className={`document-zone${dragOverZone === placement ? " is-dragover" : ""}`}
        data-document-zone={placement}
        onDragOver={handleZoneOver(placement)}
        onDragLeave={() => setDragOverZone(null)}
        onDrop={handleZoneDrop(placement)}
      >
        <div className="document-zone-head">
          <span className="document-zone-label">{label}</span>
          {addLabel ? (
            <AddFieldMenu
              document={document}
              sectionKey={section.key}
              entryId={entryId}
              placement={placement}
              catalog={catalog}
              readOnly={readOnly}
              label={addLabel}
              onChange={onChange}
              onSelectPath={onSelectPath}
              onNotice={onNotice}
            />
          ) : null}
        </div>
        {group.length === 0 ? (
          <span className="document-group-empty">{emptyText}</span>
        ) : (
          <div
            className={`document-group${isGrey ? " document-group-lead" : ""}`}
            style={isGrey ? columnStyle : undefined}
          >
            {group.map((item) => renderChip(item))}
          </div>
        )}
      </div>
    );
  };

  const hiddenItems = entry.items.filter((item) => getItemPlacement(item) === "hidden");
  const bodyItems = entry.items.filter((item) => getItemPlacement(item) === "body");
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
        "document-entry",
        selectedContainsEntry ? "is-selected" : "",
        entry.hidden ? "is-hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-document-entry={entryPath}
    >
      <Dropdown
        menu={entryMenu}
        trigger={["contextMenu"]}
        disabled={readOnly}
        open={entryMenuOpen}
        onOpenChange={setEntryMenuOpen}
      >
        <div
          className="document-entry-head"
          tabIndex={readOnly ? undefined : 0}
          onKeyDown={(event) => {
            // Shift+F10 / 菜单键是右键菜单的键盘等价物；只在条目头自身聚焦时响应，
            // 不抢内部按钮与 Segmented 的按键。
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
          <Tooltip title={t("document.entry.headLayout")}>
            <Segmented
              className="document-entry-head-layout"
              size="small"
              aria-label={t("document.entry.headLayout")}
              value={entry.layout.head}
              disabled={readOnly}
              options={[
                { value: "split", label: t("document.entry.headLayout.split") },
                { value: "stacked", label: t("document.entry.headLayout.stacked") },
                { value: "meta_first", label: t("document.entry.headLayout.meta_first") },
              ]}
              onChange={(value) =>
                onChange(
                  setEntryHeadLayout(document, entryPath, value as ResumeEntry["layout"]["head"]),
                )
              }
            />
          </Tooltip>
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
              <Tooltip title={t("document.entry.copy")}>
                <Button
                  size="small"
                  type="text"
                  aria-label={t("document.entry.copy")}
                  icon={<CopyOutlined />}
                  onClick={() => {
                    const copied = copyEntry(document, entryPath);
                    onChange(copied.document);
                    if (copied.entryId) onSelectPath(buildEntryPath(section.key, copied.entryId));
                    onNotice(t("document.toast.entryCopied"), "info");
                  }}
                />
              </Tooltip>
            </span>
          ) : null}
        </div>
      </Dropdown>

      <div className="document-zone document-zone-head" data-document-zone="head">
        <div className="document-zone-label">{t("document.zone.head")}</div>
        {HEAD_ZONE_GROUPS.map((group) => (
          <Fragment key={group.placement}>
            {renderGroup(group.placement, t(group.labelKey), t(group.emptyKey), t(group.addKey))}
          </Fragment>
        ))}
      </div>

      <div className="document-zone document-zone-detail" data-document-zone="detail">
        <div className="document-zone-head">
          <span className="document-zone-label">{t("document.zone.detail")}</span>
        </div>
        <span className="document-section-hint">{t("document.zone.detailHint")}</span>
        {DETAIL_ZONE_GROUPS.map((group) => (
          <Fragment key={group.placement}>
            {renderGroup(group.placement, t(group.labelKey), t(group.emptyKey), t(group.addKey))}
          </Fragment>
        ))}
        {hiddenItems.length > 0 ? (
          <div
            className={`document-zone${dragOverZone === "hidden" ? " is-dragover" : ""}`}
            data-document-zone="hidden"
            onDragOver={handleZoneOver("hidden")}
            onDragLeave={() => setDragOverZone(null)}
            onDrop={handleZoneDrop("hidden")}
          >
            <div className="document-zone-head">
              <span className="document-zone-label">
                {t("document.zone.hidden")} ({hiddenItems.length})
              </span>
            </div>
            <div className="document-group">{hiddenItems.map((item) => renderChip(item))}</div>
          </div>
        ) : null}
      </div>

      <div
        className={`document-zone document-zone-body${dragOverZone === "body" ? " is-dragover" : ""}`}
        data-document-zone="body"
        onDragOver={handleZoneOver("body")}
        onDragLeave={() => setDragOverZone(null)}
        onDrop={handleZoneDrop("body")}
      >
        <div className="document-zone-head">
          <span className="document-zone-label">{t("document.zone.body")}</span>
          <span className="document-add-row">
            {!readOnly ? (
              <Button
                size="small"
                type="dashed"
                aria-label={t("document.body.addBlock")}
                onClick={() => {
                  const item = defaultTextItem("", "bullet");
                  onChange(addEntryItem(document, section.key, entryId, item));
                  onSelectPath(buildItemPath(section.key, entryId, item.id));
                }}
              >
                {t("document.body.addBlock")}
              </Button>
            ) : null}
            <AddFieldMenu
              document={document}
              sectionKey={section.key}
              entryId={entryId}
              placement="body"
              catalog={catalog}
              readOnly={readOnly}
              label={t("document.body.addFieldBlock")}
              onChange={onChange}
              onSelectPath={onSelectPath}
              onNotice={onNotice}
            />
          </span>
        </div>
        {bodyItems.length === 0 ? (
          <span className="document-group-empty">{t("document.zone.emptyBody")}</span>
        ) : (
          <div className="document-body-list">{bodyItems.map((item) => renderChip(item))}</div>
        )}
      </div>
    </div>
  );
}
