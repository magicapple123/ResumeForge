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
 *   content={content}                       // 当前内容（含未保存编辑；没有 id 时面板内部 ensureIds）
 *   onCommand={(command, baseContent) => …} // 结构命令；baseContent 是命令基于的快照
 *   pickTarget={pickTarget}                 // 纸面点击目标（反向选中）
 *   canvasContainer={canvasNode}            // 右栏画布节点（向 iframe 注入高亮）
 *   onStructurePreview={(next) => …}        // 拖动中的临时内容（右栏画布实时重排；只读）
 * />
 * ```
 *
 * 没有 `onCommand` = 只读（生成流程预览等宿主）：结构按钮/手柄不渲染，键盘导航仍可用。
 */
import { Button } from "antd";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import EmptyState from "../../common/EmptyState";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
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
import { selectionPath } from "../../../features/resume-outline/model";
import type { OutlineCommand, OutlineSelection } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlineInspector from "./OutlineInspector";
import { EntryRowContent, PointRowContent, SectionHeaderContent } from "./OutlineRows";
import OutlineSearchBar from "./OutlineSearchBar";
import { pointTreeKey } from "./outlineTree";
import { useOutlineCanvasHighlight } from "./useOutlineCanvasHighlight";
import { useOutlineHostBridge } from "./useOutlineHostBridge";
import type { OutlineMultiEntry, OutlineMultiSelectionApi } from "./useOutlineHostBridge";
import { useOutlineSearch } from "./useOutlineSearch";
import { useOutlineState } from "./useOutlineState";
import "./outline.css";

export type { OutlineMultiEntry, OutlineMultiSelectionApi };

export interface OutlinePanelProps {
  /** 当前简历内容（制作台传含未保存编辑的草稿版）；缺 id 时面板内部 ensureIds（只补内存）。 */
  content?: ResumeContent | null;
  /** 结构命令出口。缺省 = 只读。 */
  onCommand?: (command: OutlineCommand, baseContent: ResumeContent) => void;
  /**
   * 排序结构预览出口：拖动中按新顺序算出的内容（右栏画布实时重排用）。
   * 只读不写——松手时仍走 `onCommand` 提交；结束（松手 / 取消 / 拖出条目）时回调 null。
   */
  onStructurePreview?: (content: ResumeContent | null) => void;
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
  /**
   * 多选集合变化（W07 多选工具条消费）：每次按条目的稳定 id 变化时上报一次。
   * 宿主据此挂载 MultiStyleBar（格式刷/批量应用间距），本面板不实现那套 UI。
   * 形状是工具条直接用的小对象：id=稳定 objectId、label=条目标题、meta=次行信息。
   */
  onMultiSelectionChange?: (entries: OutlineMultiEntry[]) => void;
  /**
   * 让宿主拿到"清空多选"的动作（工具条关掉/应用完一批后调用），避免把 clear 也塞进
   * 每次变化的回调里。面板卸载时自动置回 null。
   */
  multiSelectionApiRef?: RefObject<OutlineMultiSelectionApi | null>;
  /**
   * 显式"定位到对象"（搜索 Enter / 点定位）：宿主可据此把中栏表单滚到对应字段。
   * 画布高亮/滚动已在面板内完成；path 是当前下标路径，找不到对象时为 null。
   */
  onLocateSelection?: (selection: OutlineSelection, path: string | null) => void;
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
  onStructurePreview,
  pickTarget,
  canvasContainer,
  canvasContainerRef,
  readOnly = false,
  onSelectionChange,
  onMultiSelectionChange,
  multiSelectionApiRef,
  onLocateSelection,
  className,
}: OutlinePanelProps) {
  useLocale();
  const treeRef = useRef<HTMLDivElement>(null);
  // 读取/编辑都基于"补齐过 id"的内存副本；不写库、不覆盖入参（W01 的读取适配）。
  const baseContent = useMemo(() => (content ? ensureIds(content) : null), [content]);
  const model = useMemo(() => buildOutline(baseContent), [baseContent]);
  const sectionLabel = useCallback((section: OutlineSection) => t(section.titleKey), []);
  const search = useOutlineSearch({
    model,
    baseContent,
    treeRef,
    canvasContainer,
    canvasContainerRef,
    sectionLabel,
  });
  // 搜索时只画命中行（+祖先）；选中/命令仍按 id 指向原对象（模型只是"显示哪些行"）。
  const displayedModel = search.query ? search.result.model : model;
  const readonly = readOnly || !onCommand || !baseContent;
  const state = useOutlineState({
    baseContent,
    model: displayedModel,
    onCommand,
    pickTarget,
    onSelectionChange,
    treeRef,
    onStructurePreview,
  });
  const targets = useMemo(
    () => resolveHighlightTargets(baseContent, state.selection),
    [baseContent, state.selection],
  );
  useOutlineCanvasHighlight({
    targets,
    container: canvasContainer,
    containerRef: canvasContainerRef,
    reveal: search.reveal,
  });

  // 多选集合上报 + 「清空多选」宿主句柄（拆到 hook，见文件头）。
  useOutlineHostBridge({
    entries: state.multiSelectedEntries,
    onMultiSelectionChange,
    multiSelectionApiRef,
    clearMultiSelect: state.clearMultiSelect,
  });

  // 纸面点击跳进大纲：先记住"跳之前"的位置，用户可用「回到之前位置」复原。
  const lastPickNonce = useRef<number | null>(null);
  useEffect(() => {
    const nonce = pickTarget?.nonce ?? null;
    if (nonce === null || nonce === lastPickNonce.current) return;
    lastPickNonce.current = nonce;
    search.rememberBeforeJump();
  }, [pickTarget?.nonce, search]);

  /** 展开命中的板块/条目，保证定位的树行真的在 DOM 里。 */
  const ensureExpanded = (target: { selection: OutlineSelection }) => {
    if (target.selection.kind === "personal") return;
    const field = target.selection.field;
    if (state.collapsedSections.has(field)) state.toggleSection(field);
    if (target.selection.kind === "point") {
      const key = entryKey(field, target.selection.objectId);
      if (!state.expandedEntries.has(key)) state.toggleEntry(key);
    }
  };

  /** 搜索命中 → 选中 + 展开 + 滚到树行（上下键与 Enter 共用）。 */
  const goToMatch = (match: ReturnType<typeof search.currentMatch>) => {
    if (!match) return;
    ensureExpanded(match);
    state.select(match.selection);
    // 展开状态在本次渲染之后才生效；下一帧再滚，避免行还不存在时滚不到。
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => search.scrollMatchIntoView(match));
    } else {
      search.scrollMatchIntoView(match);
    }
  };

  const stepMatch = (delta: number) => {
    const match = search.step(delta);
    if (match) goToMatch(match);
  };

  const locateMatch = () => {
    const match = search.currentMatch();
    if (!match) return;
    ensureExpanded(match);
    state.select(match.selection);
    // 树行也要滚到可视区（与上下键同一套；展开后下一帧再滚）。
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => search.scrollMatchIntoView(match));
    } else {
      search.scrollMatchIntoView(match);
    }
    const path = selectionPath(baseContent, match.selection);
    search.requestReveal(path);
    if (path) onLocateSelection?.(match.selection, path);
    state.announce(t("outline.search.located", { name: match.text || t("outline.panel.title") }));
  };

  const restoreScroll = () => {
    if (search.restore()) state.announce(t("outline.search.restored"));
  };

  const clearSearch = () => {
    search.clear();
    state.announce(t("outline.search.restored"));
  };

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
          query={search.query || undefined}
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
          onDrop={(event) => state.dropOnPoint(entry, point, event)}
        />
      </div>
    );
  };

  const renderEntry = (entry: OutlineEntry) => {
    const key = entryKey(entry.field, entry.objectId);
    const entrySelection = entrySelectionOf(entry);
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
      >
        <EntryRowContent
          entry={entry}
          expanded={expanded}
          moving={Boolean(moving)}
          dropTarget={state.dropTargetKey === key}
          readOnly={readonly}
          displayName={entry.title || t("outline.entry.untitled")}
          query={search.query || undefined}
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
            query={search.query || undefined}
            onToggle={() => state.select({ kind: "personal" })}
          />
        </div>
      );
    }
    const field = section.field;
    const sectionKey = `section:${field}`;
    // 搜索时板块恒展开（过滤后的树只有命中行，收起会让用户看不到结果）。
    const expanded = searching ? true : !state.collapsedSections.has(field);
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
          query={search.query || undefined}
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

  const searching = search.query !== "";
  // 搜索时"没有命中"与"这份简历还没有条目"是两种空：前者说明换个词，后者引导去中栏添加。
  const showEmpty = searching
    ? displayedModel.entryCount === 0 &&
      !displayedModel.sections.some((section) => section.field === null)
    : model.entryCount === 0;
  return (
    <div className={`resume-outline${className ? ` ${className}` : ""}`}>
      <div className="resume-outline-head">
        <span className="resume-outline-head-title">{t("outline.panel.title")}</span>
        <span className="resume-outline-head-count">
          {t("outline.count.summary", {
            entries: displayedModel.entryCount,
            points: displayedModel.pointCount,
          })}
        </span>
      </div>
      {baseContent ? (
        <OutlineSearchBar
          value={search.query}
          matchCount={search.result.matchCount}
          activeIndex={search.activeIndex}
          onChange={search.setQuery}
          onStep={stepMatch}
          onLocate={locateMatch}
          onClear={clearSearch}
          canRestore={search.canRestore}
          onRestore={restoreScroll}
          onFocus={search.rememberBeforeSearch}
        />
      ) : null}
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
      {showEmpty ? (
        <EmptyState
          inline
          description={t(searching ? "outline.search.noMatch" : "outline.empty")}
        />
      ) : (
        <div
          role="tree"
          aria-label={t("outline.tree.label")}
          aria-multiselectable="true"
          className="resume-outline-tree"
          ref={treeRef}
          onScroll={search.onTreeScroll}
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
