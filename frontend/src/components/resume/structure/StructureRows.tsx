// SPDX-License-Identifier: Apache-2.0
/**
 * 结构面板的行渲染（树节点 → 一行）。
 *
 * 交互（点击选中、展开、拖拽落点、键盘焦点）全部来自 `useStructurePanel`；这里只画，
 * 不在 JSX 里改文档。位置分组的名字与板块兜底名由面板传入（面板里有 t()）。
 *
 * U7 多选：条目勾选框与 Shift 连选只在宿主提供 `onMultiSelectedPathsChange` 时渲染/响应——
 * 没有宿主持有的选择状态就不出现控件，避免再次出现"勾了没反应"的死控件。
 */
import { Button, Checkbox, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
  CopyOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { useLocale } from "../../../i18n/i18nContext";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import type { Placement } from "../../../types/resumeDocument";
import type { StructureNode } from "../../../features/resume-document/summarize";
import type { StructurePanelApi } from "./useStructurePanel";

const INDENT_PX = 14;
const BASE_INDENT_PX = 6;

const PLACEMENT_LABEL_KEYS: Record<Placement, MessageKey> = {
  title: "structure.placement.title",
  meta: "structure.placement.meta",
  lead: "structure.placement.lead",
  body: "structure.placement.body",
  trail: "structure.placement.trail",
  hidden: "structure.placement.hidden",
};

const PLACEMENT_OPTIONS: readonly Placement[] = [
  "title",
  "meta",
  "lead",
  "body",
  "trail",
  "hidden",
];

export interface StructureRowsProps {
  api: StructurePanelApi;
  /** 节点显示名（板块/条目/字段；分组行不用它）。 */
  labelOf: (node: StructureNode) => string;
  /** 位置分组行的显示名（标题行 / 正文后灰字 / …）。 */
  placementLabelOf: (node: StructureNode) => string;
  /** 仅素材字段判定（资料目录来源；不传 = 不显示徽标）。 */
  isMaterialOnly?: (node: StructureNode) => boolean;
  multiSelectedPaths?: readonly string[];
  onMultiSelectedPathsChange?: (paths: string[]) => void;
  onShiftSelect?: (node: StructureNode) => void;
}

export default function StructureRows({
  api,
  labelOf,
  placementLabelOf,
  isMaterialOnly,
  multiSelectedPaths = [],
  onMultiSelectedPathsChange,
  onShiftSelect,
}: StructureRowsProps) {
  useLocale();
  return (
    <>
      {api.rows.map(({ node, depth }) => (
        <StructureRow
          key={node.key}
          node={node}
          depth={depth}
          api={api}
          labelOf={labelOf}
          placementLabelOf={placementLabelOf}
          isMaterialOnly={isMaterialOnly}
          multiSelectedPaths={multiSelectedPaths}
          onMultiSelectedPathsChange={onMultiSelectedPathsChange}
          onShiftSelect={onShiftSelect}
        />
      ))}
    </>
  );
}

function rowPadding(depth: number): number {
  return BASE_INDENT_PX + depth * INDENT_PX;
}

function StructureRow({
  node,
  depth,
  api,
  labelOf,
  placementLabelOf,
  isMaterialOnly,
  multiSelectedPaths,
  onMultiSelectedPathsChange,
  onShiftSelect,
}: {
  node: StructureNode;
  depth: number;
  api: StructurePanelApi;
  labelOf: (node: StructureNode) => string;
  placementLabelOf: (node: StructureNode) => string;
  isMaterialOnly?: (node: StructureNode) => boolean;
  multiSelectedPaths: readonly string[];
  onMultiSelectedPathsChange?: (paths: string[]) => void;
  onShiftSelect?: (node: StructureNode) => void;
}) {
  const expandable = (node.children?.length ?? 0) > 0;
  const expanded = expandable && !api.collapsed.has(node.key);
  const isGroup = node.kind === "group";
  const multiSelected =
    Boolean(onMultiSelectedPathsChange) &&
    node.kind === "entry" &&
    Boolean(node.path) &&
    multiSelectedPaths.includes(node.path!);
  const selected = api.selectedKey === node.key || multiSelected;
  const matched = api.matchedKeys.has(node.key) && api.query.trim().length > 0;
  const dropSide = api.drag?.overKey === node.key ? api.drag.side : null;
  const selectable = Boolean(node.path);
  const isHeaderItem = node.key.startsWith("header.");
  const draggable =
    !api.readOnly && Boolean(node.path) && (node.kind === "item" || node.kind === "entry");
  const materialOnly = isMaterialOnly?.(node) ?? false;
  const label = isGroup ? placementLabelOf(node) : labelOf(node);
  /** 字段行显示值或目录标签；值显示在行上时用本地化字段名作 Tooltip，不露英文 key。 */
  const fieldLabel = node.fieldLabel ?? node.itemKey ?? "";
  const showKeyHint = Boolean(fieldLabel) && fieldLabel !== label;
  /**
   * Q08：条目级断页标记（数据来自 summarize 的 entry.layout，不在这里读文档）。
   * 两个开关合成一个行内徽标，Tooltip 说明具体设了哪个。
   */
  const pageBreaks = [
    node.startOnNewPage ? t("structure.badge.pageBreak.newPage") : "",
    node.keepTogether ? t("structure.badge.pageBreak.keep") : "",
  ].filter(Boolean);
  const hasPageBreak = node.kind === "entry" && pageBreaks.length > 0;

  const rowClass = [
    "rf-structure-row",
    `rf-structure-row-${node.kind}`,
    isGroup ? "is-group" : "",
    selected ? "is-selected" : "",
    matched ? "is-matched" : "",
    node.hidden ? "is-hidden" : "",
    dropSide ? `is-drop-${dropSide}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isGroup) {
      if (expandable) api.toggleCollapse(node.key);
      return;
    }
    if (event.shiftKey && node.kind === "entry" && onMultiSelectedPathsChange) {
      onShiftSelect?.(node);
    }
    api.selectNode(node);
  };

  const computeSide = (event: React.DragEvent<HTMLElement>): "before" | "after" | "inside" => {
    if (isGroup || node.kind === "section") return "inside";
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY - rect.top > rect.height / 2 ? "after" : "before";
  };

  return (
    <div
      className={rowClass}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selectable ? selected : undefined}
      aria-expanded={expandable ? expanded : undefined}
      data-tree-key={node.key}
      data-tree-kind={node.kind}
      data-tree-path={node.path ?? undefined}
      data-tree-hidden={node.hidden ? "true" : undefined}
      data-tree-page-break={hasPageBreak ? "true" : undefined}
      tabIndex={api.activeKey === node.key ? 0 : -1}
      style={{ paddingLeft: rowPadding(depth) }}
      onClick={handleClick}
      onMouseEnter={() => api.handleRowHover(node)}
      onMouseLeave={() => api.handleRowHover(null)}
      onFocus={() => api.handleRowHover(node)}
      draggable={draggable || undefined}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.path ?? "");
        api.handlePointerDragStart(node);
      }}
      onDragEnd={api.handlePointerDragEnd}
      onDragOver={(event) => {
        if (api.readOnly) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        api.handleDragOver(node, computeSide(event));
      }}
      onDrop={(event) => {
        if (api.readOnly) return;
        event.preventDefault();
        api.handlePointerDrop(node, computeSide(event));
      }}
    >
      <span className="rf-structure-row-caret" aria-hidden="true">
        {expandable ? (
          <Button
            type="text"
            size="small"
            className="rf-structure-caret-button"
            tabIndex={-1}
            aria-label={expanded ? t("structure.action.collapse") : t("structure.action.expand")}
            onClick={(event) => {
              event.stopPropagation();
              api.toggleCollapse(node.key);
            }}
          >
            {expanded ? "▾" : "▸"}
          </Button>
        ) : (
          <span className="rf-structure-caret-spacer" />
        )}
      </span>
      {node.kind === "item" ? (
        <span
          className={`rf-structure-dot rf-structure-dot-${node.source ?? "manual"}`}
          aria-hidden="true"
          title={
            node.source === "profile" ? t("structure.source.profile") : t("structure.source.manual")
          }
        />
      ) : null}
      {showKeyHint ? (
        <Tooltip title={fieldLabel}>
          <span className="rf-structure-row-label">{label}</span>
        </Tooltip>
      ) : (
        <span className="rf-structure-row-label">{label}</span>
      )}
      {isGroup ? (
        <span className="rf-structure-row-count">{node.children?.length ?? 0}</span>
      ) : null}
      {!api.readOnly && onMultiSelectedPathsChange && node.kind === "entry" && node.path ? (
        <Checkbox
          className="rf-structure-multi-check"
          checked={multiSelected}
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const next = new Set(multiSelectedPaths);
            if (event.target.checked) next.add(node.path!);
            else next.delete(node.path!);
            onMultiSelectedPathsChange([...next]);
          }}
        />
      ) : null}
      {hasPageBreak ? (
        <Tooltip title={pageBreaks.join(" · ")}>
          <span className="rf-structure-badge rf-structure-badge-page-break">
            {t("structure.badge.pageBreak")}
          </span>
        </Tooltip>
      ) : null}
      {node.hidden ? (
        <span className="rf-structure-badge">{t("structure.badge.hidden")}</span>
      ) : null}
      {node.lock === "content" ? (
        <span className="rf-structure-badge">{t("structure.badge.lockContent")}</span>
      ) : null}
      {node.lock === "layout" ? (
        <span className="rf-structure-badge">{t("structure.badge.lockLayout")}</span>
      ) : null}
      {materialOnly ? (
        <Tooltip title={t("structure.badge.materialOnly.title")}>
          <span className="rf-structure-badge rf-structure-badge-material">
            {t("structure.badge.materialOnly")}
          </span>
        </Tooltip>
      ) : null}
      {!api.readOnly && node.kind === "entry" && node.path ? (
        <EntryActions node={node} api={api} />
      ) : null}
      {!api.readOnly && node.kind === "item" && node.path ? (
        <ItemActions node={node} api={api} allowMove={!isHeaderItem} />
      ) : null}
    </div>
  );
}

function EntryActions({ node, api }: { node: StructureNode; api: StructurePanelApi }) {
  const lockItems: MenuProps["items"] = [
    {
      key: "content",
      label:
        node.lock === "content"
          ? t("structure.action.unlockContent")
          : t("structure.action.lockContent"),
    },
    {
      key: "layout",
      label:
        node.lock === "layout"
          ? t("structure.action.unlockLayout")
          : t("structure.action.lockLayout"),
    },
  ];
  return (
    <span className="rf-structure-row-actions">
      <Tooltip title={t("structure.action.copyEntry")}>
        <Button
          type="text"
          size="small"
          aria-label={t("structure.action.copyEntry")}
          icon={<CopyOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            api.copyEntry(node);
          }}
        />
      </Tooltip>
      <Tooltip title={node.hidden ? t("structure.action.show") : t("structure.action.hide")}>
        <Button
          type="text"
          size="small"
          aria-label={node.hidden ? t("structure.action.show") : t("structure.action.hide")}
          icon={node.hidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            api.toggleHidden(node);
          }}
        />
      </Tooltip>
      <Dropdown
        trigger={["click"]}
        menu={{
          items: lockItems,
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            api.toggleLock(node, key === "content" ? "content" : "layout");
          },
        }}
      >
        <Button
          type="text"
          size="small"
          aria-label={t("structure.action.more")}
          icon={node.lock ? <LockOutlined /> : <UnlockOutlined />}
          onClick={(event) => event.stopPropagation()}
        />
      </Dropdown>
    </span>
  );
}

function ItemActions({
  node,
  api,
  allowMove,
}: {
  node: StructureNode;
  api: StructurePanelApi;
  allowMove: boolean;
}) {
  const placementItems: MenuProps["items"] = PLACEMENT_OPTIONS.map((placement) => ({
    key: placement,
    label: t(PLACEMENT_LABEL_KEYS[placement]),
    disabled: node.placement === placement,
  }));
  return (
    <span className="rf-structure-row-actions">
      <Tooltip title={node.hidden ? t("structure.action.show") : t("structure.action.hide")}>
        <Button
          type="text"
          size="small"
          aria-label={node.hidden ? t("structure.action.show") : t("structure.action.hide")}
          icon={node.hidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            api.toggleHidden(node);
          }}
        />
      </Tooltip>
      {allowMove ? (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: placementItems,
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              api.moveToPlacement(node, key);
            },
          }}
        >
          <Button
            type="text"
            size="small"
            aria-label={t("structure.action.more")}
            onClick={(event) => event.stopPropagation()}
          >
            ⇅
          </Button>
        </Dropdown>
      ) : null}
    </span>
  );
}
