// SPDX-License-Identifier: Apache-2.0
/**
 * 一条条目的**三域卡**：标题与元信息 / 灰色短字段 / 正文。
 *
 * - 三个域都是拖放目标；chip 之间也可以拖（落在 chip 上 = 插到它前面）；非法目标给可读提示；
 * - 条目头（序号 / 布局图标 / 「⋯」菜单）在 `EntryCardHead`；
 * - R-05 的四区重整：域 = 带 `border-left` 竖线的三块（13px 标题 + 计数），域内每个位置组
 *   是 `EntryZoneGroup`（11px 标签 + 等宽 chips 网格 + 右侧虚线 `+` 格）。"组"不再是容器，
 *   一个 4 字段条目比改前少 3 行以上。
 */
import type { DragEvent } from "react";
import { memo, useEffect, useState } from "react";
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
  defaultTextItem,
  entryPath as buildEntryPath,
  getItemPlacement,
  groupByPlacement,
  itemPath as buildItemPath,
  moveItem,
  placementGroup,
} from "../../features/resume-document";
import { addItem as addEntryItem } from "../../features/resume-document/mutations";
import AddFieldMenu from "./AddFieldMenu";
import EntryCardHead from "./EntryCardHead";
import EntryZoneGroup from "./EntryZoneGroup";
import ItemChip from "./ItemChip";
import ItemEditor from "./ItemEditor";
import { useDocumentDrag } from "./documentDragContext";
import { useDocumentExpand } from "./documentExpandContext";

/**
 * 位置分组表（模块级常量）。
 *
 * 为什么不直接在 JSX 里写 `placement: "title"`：产品文案守卫会把**本地函数调用的
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

function EntryCard({
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
  // #8 返工：占满整行的 `is-editing` 只在**编辑器真的展开**时生效。之前它跟着"选中"走，
  // 而单击就会选中——格子从半宽变成整行、相邻 chip 跟着换位，真实双击（两下间隔 ~100ms）
  // 的第二下因此落到别的 chip 上（也就是"先单击选中再双击展不开"的根因）。
  const { expandedPath } = useDocumentExpand();
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  // #27：落点侧（插入线画在目标 chip 的前/后边缘）。与 draggedPath 同源清理。
  const [dropTarget, setDropTarget] = useState<{ path: string; side: "before" | "after" } | null>(
    null,
  );
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

  const draggedPath = drag.draggedPath;
  const draggedItem = draggedPath
    ? (entry.items.find((item) => buildItemPath(section.key, entryId, item.id) === draggedPath) ??
      null)
    : null;

  // #26：高亮从"正在拖拽"这一事实派生，不再依赖 dragleave 成对出现——空白处松手、
  // Esc 取消（只有 dragend）、拖去别的卡片时本卡都收不到 dragleave，虚线框因此残留。
  useEffect(() => {
    if (!draggedPath) {
      setDragOverZone(null);
      setDropTarget(null);
    }
  }, [draggedPath]);

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
    if (!draggedItem || !canPlaceItem(draggedItem, placement)) {
      // #26：不允许放置时显式清掉上一个高亮（此前直接 return，旧高亮定格残留）。
      setDragOverZone(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverZone(placement);
  };

  const columns = entry.layout.columns ?? section.layout.columns ?? 1;

  const renderChip = (item: ResumeItem) => {
    const placement = getItemPlacement(item);
    const path = buildItemPath(section.key, entryId, item.id);
    const group = placementGroup(entry.items, placement);
    const indexInGroup = group.findIndex((candidate) => candidate.id === item.id);
    // 展开（编辑器可见）决定槽位是否跨整行；选中只影响 chip 自己的边框/aria-pressed，
    // 两者必须分开——之前 `is-editing` 跟着选中走，单击就会让格子变宽、相邻 chip 换位。
    const expanded = expandedPath === path;
    const selectedItem = selectedPath === path;
    const dropSide = dropTarget?.path === path ? dropTarget.side : null;
    return (
      <div
        key={item.id}
        className={`document-chip-slot${expanded ? " is-editing" : ""}${dropSide ? ` is-drop-${dropSide}` : ""}`}
        data-document-path={path}
        onDragOver={(event) => {
          if (!draggedItem || draggedItem.id === item.id) return;
          if (!canPlaceItem(draggedItem, placement)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          // #27：按光标与 chip 中线的关系判定落点侧，画出"插到哪一行"的插入线。
          const rect = event.currentTarget.getBoundingClientRect();
          const side: "before" | "after" =
            event.clientX < rect.left + rect.width / 2 ? "before" : "after";
          setDropTarget({ path, side });
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const draggedPath = event.dataTransfer.getData("text/plain") || drag.draggedPath;
          setDropTarget(null);
          if (!draggedPath || draggedPath === path) return;
          drag.setDraggedPath(null);
          // #27：moveItem 的 toIndex 是"摘除后"的组内下标；鼠标落点语义是可见下标，
          // 同组且被拖项在目标之前时补回摘除偏移（拖 A 到 C 前/后不得差一位）。
          const draggedVisibleIndex = group.findIndex(
            (candidate) => candidate.id === draggedItem?.id,
          );
          const sameGroup = draggedVisibleIndex >= 0 && draggedItem !== null;
          const shift = sameGroup && draggedVisibleIndex < indexInGroup ? 1 : 0;
          const targetAfterRemoval = indexInGroup - shift;
          const side = dropTarget?.path === path ? dropTarget.side : "before";
          const toIndex = side === "after" ? targetAfterRemoval + 1 : targetAfterRemoval;
          dropAt(draggedPath, placement, Math.max(0, toIndex));
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
          selected={selectedItem}
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

  /** 一个域的标题行：13px 名称 + 计数（R-05 ②）。 */
  const domainTitle = (labelKey: MessageKey, count: number) => (
    <div className="document-zone-title-row">
      <span className="document-zone-title">{t(labelKey)}</span>
      <span className="document-zone-count">{count}</span>
    </div>
  );

  /** 一个位置组的完整 props：位置枚举 + 三条已 `t()` 的文案 + 拖拽回调。 */
  const zoneProps = (spec: ZoneGroupSpec) => ({
    document,
    sectionKey: section.key,
    entry,
    entryId,
    catalog,
    readOnly,
    placement: spec.placement,
    label: t(spec.labelKey),
    emptyText: t(spec.emptyKey),
    addLabel: readOnly ? "" : t(spec.addKey),
    columns,
    // #27：chip 级插入线出现时，分组大框降级为无——两种指示同时出现会互相打架。
    dragOver: dropTarget === null && dragOverZone === spec.placement,
    onZoneOver: handleZoneOver(spec.placement),
    onZoneLeave: () => setDragOverZone(null),
    onZoneDrop: handleZoneDrop(spec.placement),
    renderChip,
    onChange,
    onSelectPath,
    onNotice,
    items: grouped[spec.placement],
  });

  // R-30：一次遍历分成 6 组，渲染期只查表（以前 6 个组各 filter 一遍、计数再 filter 一遍）。
  // 一次遍历就够便宜，不需要 useMemo：条目内字段量级是 10 上下，而 memo 化这张表
  // 会让 `zoneProps` 闭包读到的值无法被 React Compiler 保持（eslint 的 preserve-manual-memoization）。
  const grouped = groupByPlacement(entry.items);
  const hiddenItems = grouped.hidden;
  const bodyItems = grouped.body;
  /** 域的计数：该域里真正会显示出来的 chip 数（不含隐藏字段）。 */
  const countOf = (specs: readonly ZoneGroupSpec[]) =>
    specs.reduce((sum, spec) => sum + grouped[spec.placement].length, 0);
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
      <EntryCardHead
        document={document}
        section={section}
        entry={entry}
        entryIndex={entryIndex}
        entryPath={entryPath}
        readOnly={readOnly}
        onChange={onChange}
        onSelectPath={onSelectPath}
        onNotice={onNotice}
      />

      <div className="document-zone document-zone-head" data-document-zone="head">
        {domainTitle("document.zone.head", countOf(HEAD_ZONE_GROUPS))}
        {HEAD_ZONE_GROUPS.map((spec) => (
          <EntryZoneGroup key={spec.placement} {...zoneProps(spec)} />
        ))}
      </div>

      <div className="document-zone document-zone-detail" data-document-zone="detail">
        {domainTitle("document.zone.detail", countOf(DETAIL_ZONE_GROUPS))}
        <span className="document-section-hint">{t("document.zone.detailHint")}</span>
        {DETAIL_ZONE_GROUPS.map((spec) => (
          <EntryZoneGroup key={spec.placement} {...zoneProps(spec)} />
        ))}
        {hiddenItems.length > 0 ? (
          <div
            className={`document-zone document-zone-hidden${
              dragOverZone === "hidden" ? " is-dragover" : ""
            }`}
            data-document-zone="hidden"
            onDragOver={handleZoneOver("hidden")}
            onDragLeave={() => setDragOverZone(null)}
            onDrop={handleZoneDrop("hidden")}
          >
            <div className="document-zone-title-row">
              <span className="document-zone-title">{t("document.zone.hidden")}</span>
              <span className="document-zone-count">{hiddenItems.length}</span>
            </div>
            <div className="document-group document-group-cells">
              {hiddenItems.map((item) => renderChip(item))}
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={`document-zone document-zone-body${
          dragOverZone === "body" ? " is-dragover" : ""
        }`}
        data-document-zone="body"
        onDragOver={handleZoneOver("body")}
        onDragLeave={() => setDragOverZone(null)}
        onDrop={handleZoneDrop("body")}
      >
        {domainTitle("document.zone.body", bodyItems.length)}
        <div className="document-group-row">
          <div className="document-group document-group-cells">
            {bodyItems.map((item) => renderChip(item))}
            {!readOnly ? (
              <button
                type="button"
                className="document-add-cell is-wide"
                aria-label={t("document.body.addBlock")}
                title={t("document.body.addBlock")}
                onClick={() => {
                  const item = defaultTextItem("", "bullet");
                  onChange(addEntryItem(document, section.key, entryId, item));
                  onSelectPath(buildItemPath(section.key, entryId, item.id));
                }}
              >
                {t("document.body.addBlock")}
              </button>
            ) : null}
          </div>
          <AddFieldMenu
            document={document}
            sectionKey={section.key}
            entryId={entryId}
            placement="body"
            catalog={catalog}
            readOnly={readOnly}
            label={t("document.body.addFieldBlock")}
            hint={t("document.zone.emptyBody")}
            variant="cell"
            onChange={onChange}
            onSelectPath={onSelectPath}
            onNotice={onNotice}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * R-30：条目卡 memo。props 里的 `document` 每次编辑都是新引用，所以真正的收益来自
 * 上层对未变条目/未变位置组的跳过；这里先把边界稳定住，避免兄弟条目一动就整列重画。
 */
export default memo(EntryCard);
