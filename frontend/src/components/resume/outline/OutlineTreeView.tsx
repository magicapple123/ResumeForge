// SPDX-License-Identifier: Apache-2.0
/**
 * 「文档大纲」的**树本体**（2026-10-28 从 `OutlinePanel` 拆出：面板贴住 500 行硬预算）。
 *
 * 纯展示 + 事件接线，状态全部来自 `useOutlineState` 的组合结果（选择/展开/排序会话/拖拽）：
 *
 * - **视觉顺序靠 CSS `order`**：DOM 节点顺序稳定（按模型顺序渲染），拖动预览只改每行的
 *   `order` 值。真机实测：把被拖行在 DOM 里挪位置会让 Chromium 认为指针下的元素被替换，
 *   从而**扣掉 drop 事件**（"松手后顺序没变"的主因）；
 * - **拖动中整棵树 pointer-events:none**（见 outline.css）：指针下的元素永远是稳定的树容器，
 *   drop 才会可靠触发；悬停/落点由树容器上的几何计算（`useOutlineDragDrop`）接管；
 * - 行内容画在 `OutlineRows`，这里只负责 treeitem 外壳（key / aria / data-tree-key / 焦点）。
 */
import type { RefObject } from "react";
import EmptyState from "../../common/EmptyState";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  entryKey,
  personalSubtitle,
  selectionKey,
  type OutlineEntry,
  type OutlineModel,
  type OutlinePoint,
  type OutlineSection,
} from "../../../features/resume-outline/model";
import type { OutlineSelection } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import { EntryRowContent, PointRowContent, SectionHeaderContent } from "./OutlineRows";
import { pointTreeKey } from "./outlineTree";
import type { OutlineRowDragApi } from "./useOutlineRowDrag";
import type { OutlineStateApi } from "./useOutlineState";

interface Props {
  /** 结构来源：搜索时是命中模型，否则是完整模型（DOM 顺序按它渲染）。 */
  treeSource: OutlineModel;
  /** 预览模型：只用来取每行的视觉 `order`（拖动中才与 treeSource 不同）。 */
  previewTree: OutlineModel;
  baseContent: ResumeContent | null;
  query: string;
  searching: boolean;
  readonly: boolean;
  state: OutlineStateApi;
  rowDrag: OutlineRowDragApi;
  treeRef: RefObject<HTMLDivElement | null>;
  onTreeScroll: () => void;
  /** 空态：搜索无命中 / 这份简历还没有条目。 */
  showEmpty: boolean;
}

function entrySelectionOf(entry: OutlineEntry): OutlineSelection {
  return { kind: "entry", field: entry.field, objectId: entry.objectId };
}

function pointSelectionOf(entry: OutlineEntry, point: OutlinePoint): OutlineSelection {
  return {
    kind: "point",
    field: entry.field,
    objectId: entry.objectId,
    pointField: point.pointField,
    pointId: point.pointId,
  };
}

export default function OutlineTreeView({
  treeSource,
  previewTree,
  baseContent,
  query,
  searching,
  readonly,
  state,
  rowDrag,
  treeRef,
  onTreeScroll,
  showEmpty,
}: Props) {
  useLocale();
  const selectedKind = state.selection?.kind ?? null;
  const selectedKey = selectionKey(state.selection);

  const renderPoint = (entry: OutlineEntry, point: OutlinePoint, order: number) => {
    const key = pointTreeKey(entry.field, entry.objectId, point.pointField, point.pointId);
    const pointSelection = pointSelectionOf(entry, point);
    const selected = selectedKey === selectionKey(pointSelection);
    const moving =
      state.sortSession?.kind === "point" &&
      state.sortSession.objectId === entry.objectId &&
      state.sortSession.pointId === point.pointId;
    return (
      <div
        key={key}
        role="treeitem"
        aria-selected={selected}
        data-tree-key={key}
        tabIndex={state.activeKey === key ? 0 : -1}
        className="resume-outline-treeitem"
        // 视觉顺序走 CSS order（DOM 保持稳定，drop 才不会被浏览器扣掉）。
        style={{ order }}
      >
        <PointRowContent
          point={point}
          moving={Boolean(moving)}
          dropTarget={state.dropTargetKey === key}
          readOnly={readonly}
          query={query || undefined}
          sortBlockedReason={entry.lockLayout ? t("outline.blocked.locked-layout") : undefined}
          onSelect={() => state.select(pointSelection)}
          onToggleHidden={() => state.setHiddenPoints(entry, [point], !point.hidden)}
          onClone={() => state.clonePoint(entry, point)}
          onSortFocus={() => state.select(pointSelection)}
          onSortStart={() => state.startSort(pointSelection)}
          onSortKeyDown={state.handleSortKeyDown}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer?.setData("text/plain", point.pointId);
            state.beginPointDrag(entry, point);
          }}
          onDragEnd={state.endDrag}
          onDragOver={(event) => state.dragOverPoint(entry, point, event)}
          draggable={!readonly && !entry.lockLayout}
          onRowDragStart={(event) => rowDrag.startPointRowDrag(entry, point, event)}
        />
      </div>
    );
  };

  const renderEntry = (
    entry: OutlineEntry,
    order: number,
    visualEntry: OutlineEntry | undefined,
  ) => {
    const key = entryKey(entry.field, entry.objectId);
    const entrySelection = entrySelectionOf(entry);
    /** 要点在当前**预览**顺序里的位置（DOM 顺序不变，只改 CSS order）。 */
    const pointOrder = (point: OutlinePoint): number => {
      const list = visualEntry?.points ?? entry.points;
      const index = list.findIndex(
        (item) => item.pointField === point.pointField && item.pointId === point.pointId,
      );
      return index >= 0 ? index : 0;
    };
    // 搜索时让命中条目的要点直接展开：命中就在要点里，不展开等于没显示结果。
    const expanded = searching ? entry.points.length > 0 : state.expandedEntries.has(key);
    const selected = selectedKey === selectionKey(entrySelection);
    const moving =
      state.sortSession?.kind === "entry" &&
      state.sortSession.field === entry.field &&
      state.sortSession.objectId === entry.objectId;
    return (
      <div
        key={key}
        role="treeitem"
        aria-expanded={entry.points.length > 0 ? expanded : undefined}
        aria-selected={selected}
        data-tree-key={key}
        tabIndex={state.activeKey === key ? 0 : -1}
        className="resume-outline-treeitem"
        // 视觉顺序走 CSS order（DOM 保持稳定，drop 才不会被浏览器扣掉）。
        style={{ order }}
      >
        <EntryRowContent
          entry={entry}
          expanded={expanded}
          moving={Boolean(moving)}
          dropTarget={state.dropTargetKey === key}
          readOnly={readonly}
          displayName={entry.title || t("outline.entry.untitled")}
          query={query || undefined}
          hiddenPointCount={entry.points.filter((point) => point.hidden).length}
          sortBlockedReason={entry.lockLayout ? t("outline.blocked.locked-layout") : undefined}
          onSelect={() => state.select(entrySelection)}
          onToggle={() => state.toggleEntry(key)}
          onSortFocus={() => state.select(entrySelection)}
          onSortStart={() => state.startSort(entrySelection)}
          onSortKeyDown={state.handleSortKeyDown}
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer?.setData("text/plain", entry.objectId);
            state.beginEntryDrag(entry);
          }}
          onDragEnd={state.endDrag}
          onDragOver={(event) => state.dragOverEntry(entry, event)}
          draggable={!readonly && !entry.lockLayout}
          onRowDragStart={(event) => rowDrag.startEntryRowDrag(entry, event)}
        />
        {expanded && entry.points.length > 0 ? (
          <div role="group" className="resume-outline-group">
            {entry.points.map((point) =>
              point.pointId ? renderPoint(entry, point, pointOrder(point)) : null,
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const renderSection = (section: OutlineSection) => {
    if (section.field === null) {
      const selected = selectedKind === "personal";
      return (
        <div
          key="personal"
          role="treeitem"
          aria-selected={selected}
          data-tree-key="personal"
          tabIndex={state.activeKey === "personal" ? 0 : -1}
          className="resume-outline-treeitem"
          onClick={() => state.select({ kind: "personal" })}
        >
          <SectionHeaderContent
            title={t(section.titleKey)}
            expanded={false}
            collapsible={false}
            subtitle={personalSubtitle(baseContent)}
            query={query || undefined}
            onToggle={() => state.select({ kind: "personal" })}
          />
        </div>
      );
    }
    const field = section.field;
    const sectionKey = `section:${field}`;
    // 搜索时板块恒展开（过滤后的树只有命中行，收起会让用户看不到结果）。
    const expanded = searching ? true : !state.collapsedSections.has(field);
    // 预览里的视觉顺序：DOM 顺序保持稳定，只给每行一个 CSS order（见文件头）。
    const visualSection = previewTree.sections.find((item) => item.field === field);
    const visualEntries = visualSection?.entries ?? section.entries;
    const visualIndex = new Map(visualEntries.map((entry, index) => [entry.objectId, index]));
    return (
      <div
        key={sectionKey}
        role="treeitem"
        aria-expanded={expanded}
        data-tree-key={sectionKey}
        tabIndex={state.activeKey === sectionKey ? 0 : -1}
        className="resume-outline-treeitem"
      >
        <SectionHeaderContent
          title={t(section.titleKey)}
          count={section.entries.length}
          expanded={expanded}
          collapsible
          query={query || undefined}
          onToggle={() => state.toggleSection(field)}
        />
        {expanded ? (
          <div role="group" className="resume-outline-group">
            {section.entries.map((entry) =>
              entry.objectId
                ? renderEntry(
                    entry,
                    visualIndex.get(entry.objectId) ?? 0,
                    visualEntries.find((item) => item.objectId === entry.objectId),
                  )
                : null,
            )}
          </div>
        ) : null}
      </div>
    );
  };

  if (showEmpty) {
    return (
      <EmptyState inline description={t(searching ? "outline.search.noMatch" : "outline.empty")} />
    );
  }
  return (
    <div
      role="tree"
      aria-label={t("outline.tree.label")}
      aria-multiselectable="true"
      // 拖动中行 pointer-events:none：被拖行不会挡在指针下，浏览器就不会扣掉 drop
      // （真机"向下拖一格松手没反应"的根因）。悬停/落点由树容器上的几何计算接管。
      className={`resume-outline-tree${state.dragPayload ? " is-dragging" : ""}`}
      ref={treeRef}
      onScroll={onTreeScroll}
      onKeyDown={state.handleTreeKeyDown}
      // drop 收在树容器上：落点可以是行 / 缝隙 / 板块标题（行级 drop 太窄，真机大部分拖不动）。
      onDragOver={state.handleTreeDragOver}
      onDrop={state.handleTreeDrop}
      onDragEnd={state.handleTreeDragEnd}
    >
      {treeSource.sections.map(renderSection)}
    </div>
  );
}
