// SPDX-License-Identifier: Apache-2.0
/**
 * 「本份简历结构」面板（替换旧「文档大纲」，计划 §9.3）。
 *
 * 树 = 页眉/板块 → 条目 → 位置分组（标题行/元信息/正文前灰字/正文/正文后灰字/隐藏）→ 字段。
 * 每行显示来源（资料/手动圆点）、隐藏/锁定徽标；支持拖拽排序、跨组移动、显示/隐藏、
 * 复制条目、锁内容/锁排版、顶部搜索，并与右栏画布联动（选中高亮、纸面点击反选、hover 描边）。
 *
 * 所有写操作都走 `features/resume-document` 的不可变实现（见 `structureCommands.ts`），
 * 面板只把新文档交给宿主的 `onChange`——历史 / 保存仍由工作台统一负责。
 */
import { Button, Input, Tooltip } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  NodeCollapseOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useRef } from "react";
import { useLocale } from "../../../i18n/i18nContext";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import type {
  DocumentFieldCatalog,
  HeaderPlacement,
  Placement,
  ResumeDocument,
} from "../../../types/resumeDocument";
import type { StructureNode } from "../../../features/resume-document/summarize";
import { fieldCatalogLabelResolver } from "../../../features/resume-document/fieldCatalog";
import { reorderSections } from "../../../features/resume-document/mutations";
import { parseDocumentPath } from "../../../features/resume-document/paths";
import { sectionDisplayLabel, sectionKeyLabel } from "../sectionLabels";
import { entryIdFromPath, entryIdsFromPaths } from "../typography/v2Selection";
import SectionOrderControl from "../SectionOrderControl";
import StructureRows from "./StructureRows";
import { useStructurePanel } from "./useStructurePanel";
import "./structure.css";

const PLACEMENT_LABEL_KEYS: Record<Placement, MessageKey> = {
  title: "structure.placement.title",
  meta: "structure.placement.meta",
  lead: "structure.placement.lead",
  body: "structure.placement.body",
  trail: "structure.placement.trail",
  hidden: "structure.placement.hidden",
};

const HEADER_PLACEMENT_LABEL_KEYS: Record<HeaderPlacement, MessageKey> = {
  name: "structure.placement.name",
  name_meta: "structure.placement.name_meta",
  subtitle: "structure.placement.subtitle",
  contact: "structure.placement.contact",
  photo: "structure.placement.photo",
  hidden: "structure.placement.hidden",
};

export interface StructurePanelProps {
  document: ResumeDocument;
  onChange: (next: ResumeDocument) => void;
  selectedPath?: string | null;
  onSelectPath?: (path: string | null) => void;
  onHoverPath?: (path: string | null) => void;
  onNotify?: (message: string) => void;
  /** 纸面点击目标（与中栏同一份 `{path, nonce}`）。 */
  pickTarget?: { path: string; nonce: number } | null;
  /** 右栏画布容器：面板向其中的 iframe 注入高亮样式。 */
  canvasContainer?: HTMLElement | null;
  /** 仅素材字段判定（字段目录 material_only）；用于红色「仅素材」徽标。 */
  isMaterialOnlyField?: (key: string) => boolean;
  /**
   * 字段目录（Q20）：树行在字段没有值时显示目录里的中文标签，不再显示英文 key。
   * 制作台本来就取过这份目录，这里只消费、不自己发请求。
   */
  fieldCatalog?: DocumentFieldCatalog | null;
  pagesNeeded?: number | null;
  /** 当前「我的资料」的板块顺序（已翻成文档 key）；用于「顺序」面板里的同步动作。 */
  profileSectionOrder?: readonly string[];
  readOnly?: boolean;
  className?: string;
  /**
   * U7 结构树多选：宿主持有的条目路径（section.entryId，与排版工具的批量目标同一份状态）。
   * 不传 = 不启用多选（勾选框不渲染）。
   */
  multiSelectedPaths?: readonly string[];
  /** 多选变化出口；不传 = 勾选框不渲染（防死控件）。 */
  onMultiSelectedPathsChange?: (paths: string[]) => void;
}

export default function StructurePanel({
  document,
  onChange,
  selectedPath,
  onSelectPath,
  onHoverPath,
  onNotify,
  pickTarget,
  canvasContainer,
  isMaterialOnlyField,
  fieldCatalog = null,
  pagesNeeded,
  profileSectionOrder,
  readOnly = false,
  className,
  multiSelectedPaths = [],
  onMultiSelectedPathsChange,
}: StructurePanelProps) {
  useLocale();
  const treeRef = useRef<HTMLDivElement | null>(null);
  const resolveFieldLabel = useMemo(() => fieldCatalogLabelResolver(fieldCatalog), [fieldCatalog]);
  // U7：选择状态归宿主，面板只保留 Shift 连选的"最后点击条目"锚点（当前树视图的交互状态）。
  const multiAnchorRef = useRef<string | null>(null);
  const multiEnabled = Boolean(onMultiSelectedPathsChange) && !readOnly;
  const api = useStructurePanel({
    treeRef,
    document,
    onChange,
    selectedPath,
    onSelectPath,
    onHoverPath,
    pickTarget,
    canvasContainer,
    onNotify,
    readOnly,
    fieldLabel: resolveFieldLabel,
  });

  // Shift 连选的"最后点击条目"：普通点击/Shift 点击都会经 useStructurePanel 更新 selectedPath，
  // 把落在条目路径上的选中记为锚点；切换文档由组件卸载或宿主清空状态重置。
  useEffect(() => {
    if (!multiEnabled) return;
    const parsed = parseDocumentPath(selectedPath);
    if (parsed?.kind === "entry") multiAnchorRef.current = selectedPath ?? null;
  }, [multiEnabled, selectedPath]);

  /** 勾选框变化：新增的条目成为下一次 Shift 连选的锚点（取消锚点自身则丢弃过期锚点）。 */
  const handleMultiSelectedPathsChange = (paths: string[]) => {
    if (!onMultiSelectedPathsChange) return;
    const current = new Set(multiSelectedPaths);
    const added = paths.find((path) => !current.has(path));
    if (added) multiAnchorRef.current = added;
    else {
      const removed = [...current].find((path) => !paths.includes(path));
      if (removed && removed === multiAnchorRef.current) multiAnchorRef.current = null;
    }
    onMultiSelectedPathsChange(paths);
  };

  /**
   * Shift 连选：在**可见条目行顺序**上取「最后点击条目 → 当前条目」区间并并入已有选择。
   * 只合并不替换：批量样式是增量目标集合，Shift 不应悄悄丢掉之前勾选的条目。
   */
  const handleShiftSelect = (node: StructureNode) => {
    if (!multiEnabled || !onMultiSelectedPathsChange || !node.path) return;
    const entryPaths: string[] = [];
    for (const row of api.rows) {
      if (row.node.kind === "entry" && row.node.path) entryPaths.push(row.node.path);
    }
    const currentIndex = entryPaths.indexOf(node.path);
    if (currentIndex < 0) return;
    const anchorIndex = multiAnchorRef.current ? entryPaths.indexOf(multiAnchorRef.current) : -1;
    const from = anchorIndex < 0 ? currentIndex : Math.min(anchorIndex, currentIndex);
    const to = anchorIndex < 0 ? currentIndex : Math.max(anchorIndex, currentIndex);
    // 路径先经既有 helper 清洗（只认合法条目路径），再回到可见行里的规范路径。
    const pathById = new Map<string, string>();
    for (const path of entryPaths) {
      const id = entryIdFromPath(path);
      if (id) pathById.set(id, path);
    }
    const next = new Set(multiSelectedPaths);
    for (const id of entryIdsFromPaths(entryPaths.slice(from, to + 1))) {
      const path = pathById.get(id);
      if (path) next.add(path);
    }
    onMultiSelectedPathsChange([...next]);
  };

  const labelOf = (node: StructureNode): string => {
    if (node.kind === "section") {
      // 自建板块 title 在文档里；没有 title 时退回「自建板块」而不是 custom:uuid。
      const customTitle = node.label && node.label !== node.sectionKey ? node.label : "";
      return sectionKeyLabel(node.sectionKey ?? "", customTitle);
    }
    const label = node.label.trim();
    if (label) return label;
    if (node.kind === "entry") return t("structure.badge.untitledEntry");
    if (node.kind === "item") return t("structure.badge.untitledItem");
    return "";
  };
  const placementLabelOf = (node: StructureNode): string => {
    if (node.headerPlacement) return t(HEADER_PLACEMENT_LABEL_KEYS[node.headerPlacement]);
    if (node.placement) return t(PLACEMENT_LABEL_KEYS[node.placement]);
    return node.label;
  };
  const isMaterialOnly = (node: StructureNode): boolean => {
    if (node.kind !== "item" || !isMaterialOnlyField) return false;
    const key = keyOfNode(document, node);
    return key ? isMaterialOnlyField(key) : false;
  };

  const overview = t("structure.panel.overviewCounts", {
    sections: api.counts.sections,
    entries: api.counts.entries,
    items: api.counts.items,
  });
  const pages =
    typeof pagesNeeded === "number" && Number.isFinite(pagesNeeded)
      ? t("structure.panel.overviewPages", { pages: pagesNeeded })
      : t("structure.panel.overviewPagesUnknown");
  const searching = api.query.trim().length > 0;
  const empty = api.rows.length === 0;

  return (
    <div className={`rf-structure-panel${className ? ` ${className}` : ""}`}>
      <div className="rf-structure-panel-head">
        <div className="rf-structure-panel-title">
          <h3>{t("structure.panel.title")}</h3>
          <div className="rf-structure-panel-meta">
            <span>{overview}</span>
            <span className="rf-structure-panel-meta-sep">·</span>
            <span>{pages}</span>
          </div>
        </div>
        <div className="rf-structure-panel-tools">
          <Tooltip title={t("structure.action.expandAll")}>
            <Button
              type="text"
              size="small"
              aria-label={t("structure.action.expandAll")}
              icon={<ArrowDownOutlined />}
              onClick={() => api.toggleAll(true)}
            />
          </Tooltip>
          <Tooltip title={t("structure.action.collapseAll")}>
            <Button
              type="text"
              size="small"
              aria-label={t("structure.action.collapseAll")}
              icon={<ArrowUpOutlined />}
              onClick={() => api.toggleAll(false)}
            />
          </Tooltip>
          <Tooltip title={t("structure.action.collapseEntries")}>
            <Button
              type="text"
              size="small"
              aria-label={t("structure.action.collapseEntries")}
              icon={<NodeCollapseOutlined />}
              onClick={() => api.collapseEntries()}
            />
          </Tooltip>
          {!readOnly ? (
            <SectionOrderControl
              items={document.sections.map((section) => ({
                key: section.key,
                label: sectionDisplayLabel(section),
              }))}
              order={document.sections.map((section) => section.key)}
              onChange={(next) => onChange(reorderSections(document, next))}
              onSyncProfile={
                profileSectionOrder?.length
                  ? () => onChange(reorderSections(document, profileSectionOrder))
                  : undefined
              }
            />
          ) : null}
        </div>
      </div>
      <Input
        allowClear
        size="small"
        className="rf-structure-search"
        value={api.query}
        placeholder={t("structure.search.placeholder")}
        aria-label={t("structure.search.aria")}
        prefix={<SearchOutlined />}
        onChange={(event) => api.setQuery(event.target.value)}
      />
      {searching ? (
        <div className="rf-structure-search-hint">
          {api.matchedKeys.size > 0
            ? t("structure.search.count", { count: api.matchedKeys.size })
            : t("structure.search.empty")}
        </div>
      ) : null}
      <div
        className="rf-structure-tree"
        role="tree"
        aria-label={t("structure.panel.aria")}
        ref={treeRef}
        onKeyDown={api.handleKeyDown}
        onMouseLeave={() => api.handleRowHover(null)}
      >
        {empty ? (
          <div className="rf-structure-empty">
            {searching ? t("structure.search.empty") : t("structure.empty")}
          </div>
        ) : (
          <StructureRows
            api={api}
            labelOf={labelOf}
            placementLabelOf={placementLabelOf}
            isMaterialOnly={isMaterialOnlyField ? isMaterialOnly : undefined}
            multiSelectedPaths={multiSelectedPaths}
            onMultiSelectedPathsChange={multiEnabled ? handleMultiSelectedPathsChange : undefined}
            onShiftSelect={multiEnabled ? handleShiftSelect : undefined}
          />
        )}
      </div>
      <div className="rf-structure-hint">{t("structure.drag.keyboardHint")}</div>
    </div>
  );
}

/** 从文档定位节点对应的 item key（仅素材徽标判定用）。 */
function keyOfNode(document: ResumeDocument, node: StructureNode): string | null {
  if (node.kind !== "item") return null;
  if (node.key.startsWith("header.")) {
    return document.header.items.find((item) => item.id === node.itemId)?.key ?? null;
  }
  const section = document.sections.find((candidate) => candidate.key === node.sectionKey);
  const entry = section?.entries.find((candidate) => candidate.id === node.entryId);
  const item = entry?.items.find((candidate) => candidate.id === node.itemId);
  if (!item) return null;
  return item.kind === "text" ? null : item.key;
}
