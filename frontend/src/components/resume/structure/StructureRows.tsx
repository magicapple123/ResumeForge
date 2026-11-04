// SPDX-License-Identifier: Apache-2.0
/**
 * 结构面板的行渲染（树节点 → 一行）。
 *
 * 交互（点击选中、展开、拖拽落点、键盘焦点）全部来自 `useStructurePanel`；这里只画，
 * 不在 JSX 里改文档。位置分组的名字与板块兜底名由面板传入（面板里有 t()）。
 *
 * U7 多选（R-12 起）：勾选框已删除，Shift 点击 / Shift + ↑↓ 是唯一的连选方式，
 * 选中行靠 `is-multi-selected`（左侧 2px 色条）标识；状态与出口都在 `useStructurePanel`
 * （`multiSelectEnabled` / `multiSelectedPaths` / `extendSelectionTo` / `clearSelection`）。
 */
import { Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import {
  CopyOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  MoreOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { useLocale } from "../../../i18n/i18nContext";
import { useState } from "react";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import type { Placement } from "../../../types/resumeDocument";
import type { StructureNode } from "../../../features/resume-document/summarize";
import { buildEntryMenuItems, type EntryMenuKey } from "../../resume-editor/entryMenuItems";
import { useDropdownContextMenu } from "../../../features/context-menu/useDropdownContextMenu";
import type { StructurePanelApi } from "./useStructurePanel";

/** R-08 行密度：缩进从 14px 收到 12px（4 层缩进少用 8px，窄栏留给字段名）。 */
const INDENT_PX = 12;
const BASE_INDENT_PX = 6;

const PLACEMENT_LABEL_KEYS: Record<Placement, MessageKey> = {
  title: "structure.placement.title",
  meta: "structure.placement.meta",
  lead: "structure.placement.lead",
  body: "structure.placement.body",
  trail: "structure.placement.trail",
  hidden: "structure.placement.hidden",
};

/**
 * 位置菜单的候选（`ItemActions` 的「移动位置」下拉）。
 *
 * **不含 `body`**：正文只放正文块（`TextItem`），字段进正文会变成"中栏长出两套控件、
 * 纸面 `_body_blocks` 静默丢弃"（2026-11-02，与 `placement.ts` 的 field 白名单同一口径）。
 * 这条菜单是位置下拉的第二个入口，两份候选必须一致——只在这里删 `body` 就够，
 * 白名单本身由 `allowedPlacementsForItem` 守着。
 */
const PLACEMENT_OPTIONS: readonly Placement[] = ["title", "meta", "lead", "trail", "hidden"];

export interface StructureRowsProps {
  api: StructurePanelApi;
  /** 节点显示名（板块/条目/字段；分组行不用它）。 */
  labelOf: (node: StructureNode) => string;
  /** 位置分组行的显示名（标题行 / 正文后灰字 / 基本信息 …）。 */
  placementLabelOf: (node: StructureNode) => string;
  /** 仅素材字段判定（资料目录来源；不传 = 不显示徽标）。 */
  isMaterialOnly?: (node: StructureNode) => boolean;
}

export default function StructureRows({
  api,
  labelOf,
  placementLabelOf,
  isMaterialOnly,
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
}: {
  node: StructureNode;
  depth: number;
  api: StructurePanelApi;
  labelOf: (node: StructureNode) => string;
  placementLabelOf: (node: StructureNode) => string;
  isMaterialOnly?: (node: StructureNode) => boolean;
}) {
  const expandable = (node.children?.length ?? 0) > 0;
  const expanded = expandable && !api.collapsed.has(node.key);
  const isGroup = node.kind === "group";
  // R-12：多选不再有勾选框——Shift 点击 / Shift + ↑↓ 选中的条目靠左侧 2px 色条标识。
  const multiSelected =
    api.multiSelectEnabled &&
    node.kind === "entry" &&
    Boolean(node.path) &&
    api.multiSelectedPaths.includes(node.path!);
  const selected = api.selectedKey === node.key || multiSelected;
  const ancestorOfSelected = api.selectedAncestorKeys.has(node.key);
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
    multiSelected ? "is-multi-selected" : "",
    ancestorOfSelected ? "is-ancestor-of-selected" : "",
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
    // R-12：Shift 点击 = 连选（增量并入）；普通点击清空多选（没有勾选框后的唯一清空入口）。
    if (event.shiftKey && api.multiSelectEnabled && node.kind === "entry") {
      api.extendSelectionTo(node);
    } else {
      api.clearSelection();
    }
    api.selectNode(node);
  };

  const computeSide = (event: React.DragEvent<HTMLElement>): "before" | "after" | "inside" => {
    if (isGroup || node.kind === "section") return "inside";
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY - rect.top > rect.height / 2 ? "after" : "before";
  };

  /**
   * #7：条目行的右键菜单与画布条目卡是**同一份**（6 项，见 `entryMenuItems`）：
   * 排版整条… ｜ 上移 / 下移 / 复制 ｜ 隐藏 / 移除。只读时整块不接（不弹空菜单）。
   * 右键落点存进 state（不是 ref：渲染期要把它带进菜单项的回调，ref 在渲染期读会被
   * `react-hooks/refs` 判红），供「排版整条…」当浮层锚点。
   */
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  /**
   * 条目行菜单的键盘等价物（问题 25）：`role="treeitem"` 的行本来就是可聚焦的，但
   * 之前只有右键能打开。Shift+F10 / 菜单键走同一份菜单，键盘打开时回落到行锚点。
   */
  const entryMenuState = useDropdownContextMenu();
  const entryMenu: MenuProps | null =
    node.kind === "entry" && node.path && !api.readOnly
      ? {
          items: buildEntryMenuItems(
            {
              style: t("document.entry.styleWhole"),
              moveUp: t("document.entry.moveUp"),
              moveDown: t("document.entry.moveDown"),
              copy: t("document.entry.copy"),
              toggle: node.hidden ? t("document.entry.show") : t("document.entry.hide"),
              remove: t("document.entry.remove"),
            },
            {
              canMoveUp: api.canMoveEntry(node, -1),
              canMoveDown: api.canMoveEntry(node, 1),
            },
          ),
          onClick: ({ key, domEvent }) => {
            // 行本身点一下就选中：菜单项的点击不能再冒泡成一次选中。
            domEvent.stopPropagation();
            const path = node.path ?? "";
            if (!path) return;
            const action = key as EntryMenuKey;
            if (action === "style") {
              api.requestEntryStyle({ path, x: anchor.x, y: anchor.y });
              return;
            }
            if (action === "moveUp") api.moveEntryUp(node);
            else if (action === "moveDown") api.moveEntryDown(node);
            else if (action === "copy") api.copyEntry(node);
            else if (action === "toggle") api.toggleHidden(node);
            else if (action === "remove") api.removeEntry(node);
          },
        }
      : null;

  const row = (
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
      onContextMenuCapture={(event) => {
        setAnchor({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={entryMenu ? entryMenuState.handleKeyDown : undefined}
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
        // 这一行是 `text-overflow: ellipsis` 的落点（窄栏下几乎每行长值都会被截）：
        // R-33 的 R3 要求"省略号必须配 title"，否则用户没有任何办法看到全文。
        // 用原生 title 而不是 Tooltip：树里有 300+ 行，每行挂一个 Tooltip 会为该
        // 行多渲染一层 Portal 监听（R-30 的卡顿清单里就有这一条）。
        <span className="rf-structure-row-label" title={label}>
          {label}
        </span>
      )}
      {isGroup ? (
        <span className="rf-structure-row-count">{node.children?.length ?? 0}</span>
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

  // 条目行多一层右键菜单（Dropdown 不额外产生 DOM，树结构不变）；其余行原样返回。
  if (!entryMenu) return row;
  return (
    <Dropdown {...entryMenuState.dropdownProps} menu={entryMenu}>
      {row}
    </Dropdown>
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
          aria-label={t("structure.action.lockMenu")}
          title={t("structure.action.lockMenu")}
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
  const placementItems: MenuProps["items"] = [
    {
      // #14：菜单第一行是不可点的分组标题——点开就知道这是"改位置"，不靠图标猜语义。
      type: "group",
      label: t("structure.action.moveTo"),
      children: PLACEMENT_OPTIONS.map((placement) => ({
        key: placement,
        label: t(PLACEMENT_LABEL_KEYS[placement]),
        disabled: node.placement === placement,
      })),
    },
  ];
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
          {/* #14：图标换 MoreOutlined（···），aria 用「移动位置」——不再是字面量 ⇅ 与
              同名的「更多结构动作」（读屏时与锁按钮无法区分）。 */}
          <Button
            type="text"
            size="small"
            aria-label={t("structure.action.moveTo")}
            title={t("structure.action.moveTo")}
            icon={<MoreOutlined aria-hidden="true" />}
            onClick={(event) => event.stopPropagation()}
          />
        </Dropdown>
      ) : null}
    </span>
  );
}
