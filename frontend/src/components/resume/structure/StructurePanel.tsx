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
import { ArrowDownOutlined, ArrowUpOutlined, SearchOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocale } from "../../../i18n/i18nContext";
import { t, translate } from "../../../i18n";
import type { MessageKey, MessageParams } from "../../../i18n";
import type {
  DocumentFieldCatalog,
  HeaderPlacement,
  Placement,
  ResumeDocument,
} from "../../../types/resumeDocument";
import type { StructureNode } from "../../../features/resume-document/summarize";
import { HEADER_GROUP_KEY } from "../../../features/resume-document/summarize";
import {
  enumLabelOf,
  fieldCatalogLabelResolver,
} from "../../../features/resume-document/fieldCatalog";
import { reorderSections } from "../../../features/resume-document/mutations";
import { parseDocumentPath } from "../../../features/resume-document/paths";
import { sectionDisplayLabel, sectionKeyLabel } from "../sectionLabels";
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
  const locale = useLocale();
  /**
   * 绑定当前语言的取文案函数：这几个标签回调都在 memo 里，只有 `tr` 的引用随语言变化，
   * 依赖链才真实（直接用模块级 `t()` 时 `locale` 会被 lint 判成无用依赖）。
   */
  const tr = useCallback(
    (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    [locale],
  );
  const treeRef = useRef<HTMLDivElement | null>(null);
  const resolveFieldLabel = useMemo(() => fieldCatalogLabelResolver(fieldCatalog), [fieldCatalog]);
  // #11a：枚举字段值显示本地化标签（工作类型 full_time → 全职；无匹配回落原值）。
  // 用 tr（随 locale 重建）保证切语言后树里枚举标签跟着换。
  const resolveEnumValue = useCallback(
    (sectionKey: string, fieldKey: string, value: string) =>
      enumLabelOf(null, sectionKey, fieldKey, value, tr),
    [tr],
  );
  // U7：选择状态归宿主，面板只保留 Shift 连选的"最后点击条目"锚点（当前树视图的交互状态）。
  const multiAnchorRef = useRef<string | null>(null);
  const multiEnabled = Boolean(onMultiSelectedPathsChange) && !readOnly;

  /** 非分组行的显示名（板块 / 条目 / 字段）。 */
  const labelOf = useCallback(
    (node: StructureNode): string => {
      if (node.kind === "section") {
        // 自建板块 title 在文档里；没有 title 时退回「自建板块」而不是 custom:uuid。
        const customTitle = node.label && node.label !== node.sectionKey ? node.label : "";
        return sectionKeyLabel(node.sectionKey ?? "", customTitle);
      }
      const label = node.label.trim();
      if (label) return label;
      if (node.kind === "entry") return tr("structure.badge.untitledEntry");
      if (node.kind === "item") return tr("structure.badge.untitledItem");
      return "";
    },
    [tr],
  );
  /** 分组行的显示名（位置名 / R-09 之后的「基本信息」）。 */
  const placementLabelOf = useCallback(
    (node: StructureNode): string => {
      // R-09：页眉合成**一个**「基本信息」分组（key === `header`）。它的 key 与字段
      // `header.<id>` 是前缀关系而不是同键，所以这里按整键精确判定，不会误伤字段行。
      if (node.key === HEADER_GROUP_KEY) return tr("structure.node.header");
      if (node.headerPlacement) return tr(HEADER_PLACEMENT_LABEL_KEYS[node.headerPlacement]);
      if (node.placement) return tr(PLACEMENT_LABEL_KEYS[node.placement]);
      return node.label;
    },
    [tr],
  );
  /**
   * 搜索文案（R-09）：行上看得见的字 + 行内 Tooltip 的字段名 + 位置名。
   *
   * 页眉合并成一个「基本信息」行之后，位置名（联系方式 / 姓名行 …）不再单独占一行，
   * 只有把它并进搜索文案，"联系方式" 才还能找到那一组字段（就是本次要补的能力）。
   */
  const displayLabelOf = useCallback(
    (node: StructureNode): string => {
      const rowLabel = node.kind === "group" ? placementLabelOf(node) : labelOf(node);
      const placementText = node.headerPlacement
        ? tr(HEADER_PLACEMENT_LABEL_KEYS[node.headerPlacement])
        : node.placement
          ? tr(PLACEMENT_LABEL_KEYS[node.placement])
          : "";
      return [rowLabel, node.fieldLabel ?? "", placementText].filter(Boolean).join(" ");
    },
    [labelOf, placementLabelOf, tr],
  );

  // U7 多选：宿主持有的路径集合 + 出口打包给 hook。Shift 连选的区间计算只在 hook 里
  // 做一次（Shift 点击与 Shift + ↑↓ 两个入口共用），面板不再各写一份。
  // 锚点 ref 只由面板读写（hook 经 getAnchor / setAnchor 转手），避免跨组件直接改对方的 ref。
  const getAnchor = useCallback(() => multiAnchorRef.current, []);
  const setAnchor = useCallback((path: string | null) => {
    multiAnchorRef.current = path;
  }, []);
  const multiSelect = useMemo(
    () =>
      multiEnabled && onMultiSelectedPathsChange
        ? {
            paths: multiSelectedPaths,
            onChange: onMultiSelectedPathsChange,
            getAnchor,
            setAnchor,
          }
        : null,
    [getAnchor, multiEnabled, multiSelectedPaths, onMultiSelectedPathsChange, setAnchor],
  );

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
    enumValue: resolveEnumValue,
    displayLabel: displayLabelOf,
    multiSelect,
  });

  // Shift 连选的"最后点击条目"：普通点击/Shift 点击都会经 useStructurePanel 更新 selectedPath，
  // 把落在条目路径上的选中记为锚点；切换文档由组件卸载或宿主清空状态重置。
  useEffect(() => {
    if (!multiEnabled) return;
    const parsed = parseDocumentPath(selectedPath);
    if (parsed?.kind === "entry") multiAnchorRef.current = selectedPath ?? null;
  }, [multiEnabled, selectedPath]);

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
          {/* R-01：原来三个按钮（展开全部 / 收起全部 / 收起所有条目）合成一个开关。
              图标与 aria-label 都随状态走：全展开时是「收起全部」，否则是「展开全部」。 */}
          <Tooltip
            title={
              api.allExpanded ? t("structure.action.collapseAll") : t("structure.action.expandAll")
            }
          >
            <Button
              type="text"
              size="small"
              aria-label={
                api.allExpanded
                  ? t("structure.action.collapseAll")
                  : t("structure.action.expandAll")
              }
              icon={api.allExpanded ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              onClick={() => api.toggleAll(!api.allExpanded)}
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
          />
        )}
      </div>
      {/* R-12：勾选框已删（它是 Shift 连选的唯一可发现入口），提示里补上键盘/鼠标等价操作。 */}
      <div className="rf-structure-hint">
        <span>{t("structure.drag.keyboardHint")}</span>
        {multiEnabled ? (
          <span className="rf-structure-hint-extra">{t("structure.multi.selectHint")}</span>
        ) : null}
      </div>
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
