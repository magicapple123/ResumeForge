// SPDX-License-Identifier: Apache-2.0
/**
 * 「文档大纲」面板（W06 / P1-01、D01）：左栏可切换到的语义大纲。
 *
 * ## 这个文件只负责"把状态画出来"
 *
 * 状态机在 `useOutlineState`（选择/展开/焦点/排序会话/拖拽/写操作），行内容在
 * `OutlineRows`，最小属性区在 `OutlineInspector`，画布高亮在
 * `useOutlineCanvasHighlight`。这里只做三件事：组装树、接纸面点击的反向选中、把播报
 * 文本挂到一个 `aria-live` 出口。
 *
 * ## 挂载契约（wb-core 只需给这四样）
 *
 * ```tsx
 * <OutlinePanel
 *   content={content}                       // 当前内容（含 id；没有 id 时面板内部 ensureIds）
 *   onCommand={(command, baseContent) => …} // 结构命令；baseContent 是命令基于的快照
 *   pickTarget={pickTarget}                 // 纸面点击目标（反向选中）
 *   canvasContainer={canvasNode}            // 右栏画布节点（向 iframe 注入高亮）
 * />
 * ```
 *
 * 没有 `onCommand` = 只读（生成流程预览等宿主）：结构按钮/手柄不渲染，键盘导航仍可用。
 */
import { Button } from "antd";
import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import EmptyState from "../../common/EmptyState";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import {
  buildOutline,
  entryKey,
  personalSubtitle,
  selectionKey,
  type OutlineEntry,
  type OutlinePoint,
  type OutlineSection,
} from "../../../features/resume-outline/model";
import { resolveHighlightTargets } from "../../../features/resume-outline/highlight";
import type { OutlineCommand, OutlineSelection } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlineInspector from "./OutlineInspector";
import { EntryRowContent, PointRowContent, SectionHeaderContent } from "./OutlineRows";
import { pointTreeKey } from "./outlineTree";
import { useOutlineCanvasHighlight } from "./useOutlineCanvasHighlight";
import { useOutlineState } from "./useOutlineState";

export interface OutlinePanelProps {
  /** 当前简历内容；缺 id 时面板内部 ensureIds（只补内存，不发请求）。 */
  content?: ResumeContent | null;
  /** 结构命令出口。缺省 = 只读。 */
  onCommand?: (command: OutlineCommand, baseContent: ResumeContent) => void;
  /** 纸面点击的 `{path, nonce}`（与制作台现有 pickTarget 同型）：用来反选大纲对象。 */
  pickTarget?: { path: string; nonce: number } | null;
  /** 右栏画布容器节点：给了就向其中 iframe 注入选中高亮。 */
  canvasContainer?: HTMLElement | null;
  /** 兼容传 ref 的宿主（容器晚一帧就绪时有界重试）。 */
  canvasContainerRef?: RefObject<HTMLElement | null>;
  /** 宿主层面强制只读（没有 onCommand 时也会自动只读）。 */
  readOnly?: boolean;
  /** 选中对象变化（宿主可用于联动属性区；大纲自己的高亮/属性区不依赖它）。 */
  onSelectionChange?: (selection: OutlineSelection | null) => void;
  className?: string;
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

export default function OutlinePanel({
  content,
  onCommand,
  pickTarget,
  canvasContainer,
  canvasContainerRef,
  readOnly = false,
  onSelectionChange,
  className,
}: OutlinePanelProps) {
  const treeRef = useRef<HTMLDivElement>(null);
  // 读取/编辑都基于"补齐过 id"的内存副本；不写库、不覆盖入参（W01 的读取适配）。
  const baseContent = useMemo(() => (content ? ensureIds(content) : null), [content]);
  const model = useMemo(() => buildOutline(baseContent), [baseContent]);
  const readonly = readOnly || !onCommand || !baseContent;
  const state = useOutlineState({
    baseContent,
    model,
    onCommand,
    pickTarget,
    onSelectionChange,
    treeRef,
  });
  const targets = useMemo(
    () => resolveHighlightTargets(baseContent, state.selection),
    [baseContent, state.selection],
  );
  useOutlineCanvasHighlight({
    targets,
    container: canvasContainer,
    containerRef: canvasContainerRef,
  });

  const selectedKind = state.selection?.kind ?? null;
  const inspectorEntry = selectedKind === "entry" ? state.selectedEntry : null;
  const inspectorPoint = selectedKind === "point" ? state.selectedPoint : null;
  const parentEntry = selectedKind === "point" ? state.selectedEntry : null;
  const multi = state.multiSelectedEntries;
  const allHidden = multi.length > 0 && multi.every((entry) => entry.hidden);
  const selectedKey = selectionKey(state.selection);

  const renderPoint = (entry: OutlineEntry, point: OutlinePoint) => {
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
      >
        <PointRowContent
          point={point}
          moving={Boolean(moving)}
          dropTarget={state.dropTargetKey === key}
          readOnly={readonly}
          sortBlockedReason={entry.lockLayout ? t("outline.blocked.locked-layout") : undefined}
          onSelect={() => state.select(pointSelection)}
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
          onDrop={(event) => state.dropOnPoint(entry, point, event)}
        />
      </div>
    );
  };

  const renderEntry = (entry: OutlineEntry) => {
    const key = entryKey(entry.field, entry.objectId);
    const entrySelection = entrySelectionOf(entry);
    const expanded = state.expandedEntries.has(key);
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
      >
        <EntryRowContent
          entry={entry}
          expanded={expanded}
          moving={Boolean(moving)}
          dropTarget={state.dropTargetKey === key}
          readOnly={readonly}
          displayName={entry.title || t("outline.entry.untitled")}
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
          onDrop={(event) => state.dropOnEntry(entry, event)}
        />
        {expanded && entry.points.length > 0 ? (
          <div role="group" className="resume-outline-group">
            {entry.points.map((point) => (point.pointId ? renderPoint(entry, point) : null))}
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
            onToggle={() => state.select({ kind: "personal" })}
          />
        </div>
      );
    }
    const field = section.field;
    const sectionKey = `section:${field}`;
    const expanded = !state.collapsedSections.has(field);
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
          onToggle={() => state.toggleSection(field)}
        />
        {expanded ? (
          <div role="group" className="resume-outline-group">
            {section.entries.map((entry) => (entry.objectId ? renderEntry(entry) : null))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={`resume-outline${className ? ` ${className}` : ""}`}>
      <div className="resume-outline-head">
        <span className="resume-outline-head-title">{t("outline.panel.title")}</span>
        <span className="resume-outline-head-count">
          {t("outline.count.summary", { entries: model.entryCount, points: model.pointCount })}
        </span>
      </div>
      {readonly && baseContent ? (
        <div className="resume-outline-readonly">{t("outline.readonly")}</div>
      ) : null}
      {multi.length > 0 ? (
        <div
          className="resume-outline-batch"
          role="toolbar"
          aria-label={t("outline.batch.toolbar")}
        >
          <span className="resume-outline-batch-count">
            {t("outline.batch.selected", { count: multi.length })}
          </span>
          <Button size="small" onClick={() => state.batchSetHidden(!allHidden)}>
            {allHidden ? t("outline.batch.show") : t("outline.batch.hide")}
          </Button>
          <Button size="small" type="text" onClick={state.clearMultiSelect}>
            {t("outline.batch.clear")}
          </Button>
        </div>
      ) : null}
      {model.entryCount === 0 ? (
        <EmptyState inline description={t("outline.empty")} />
      ) : (
        <div
          role="tree"
          aria-label={t("outline.tree.label")}
          aria-multiselectable="true"
          className="resume-outline-tree"
          ref={treeRef}
          onKeyDown={state.handleTreeKeyDown}
        >
          {state.previewTree.sections.map(renderSection)}
        </div>
      )}
      {readonly ? null : <p className="resume-outline-hint">{t("outline.batch.hint")}</p>}
      <OutlineInspector
        selection={state.selection}
        entry={inspectorEntry}
        point={inspectorPoint}
        parentEntry={parentEntry}
        readOnly={readonly}
        onSetHidden={(entry, hidden) => state.setHidden([entry], hidden)}
        onSetLock={state.setLock}
        onClone={state.cloneEntry}
      />
      <div className="rf-sr-only" role="status" aria-live="polite">
        {state.announcement}
      </div>
    </div>
  );
}
