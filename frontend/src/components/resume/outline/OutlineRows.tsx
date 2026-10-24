// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲的行内容（分组头 / 条目行 / 要点行）。**只负责画一行**：`role="treeitem"` 的外壳、
 * 展开组、焦点与 aria-selected 在 `OutlinePanel`，这里只管行里的文字、徽标、排序手柄与拖拽事件。
 *
 * 拆出来的理由：三行各自都有"看起来一样、行为不同"的细节（条目能拖动、要点只能在自己的
 * 分组内排、分组头只负责展开），混在面板里改一处很容易碰到另一处。
 *
 * 无障碍约定：
 * - 排序手柄是**真正的按钮**（Tab 可达、Enter/空格激活），Tooltip 说清"拖动或键盘"两种方式；
 * - 分组/条目的展开用 `aria-expanded`（在面板外壳上），行内的展开箭头是装饰（aria-hidden），
 *   键盘等价物是树上的 ←/→；
 * - 徽标是可见文字徽标（不是只有颜色的圆点），色盲用户也能读出来。
 */
import { HolderOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import type { DragEvent, KeyboardEvent } from "react";
import { t } from "../../../i18n";
import type { OutlineEntry, OutlinePoint } from "../../../features/resume-outline/model";

/** 条目行需要的外壳状态（面板算好，行只照画）。 */
export interface EntryRowContentProps {
  entry: OutlineEntry;
  expanded: boolean;
  /** 键盘排序会话正落在这条上（高亮 + 播报都靠它）。 */
  moving: boolean;
  /** 拖拽悬停在这条上（只做视觉反馈；落点语义 = 移动到目标行当前下标）。 */
  dropTarget: boolean;
  readOnly: boolean;
  displayName: string;
  /** 锁排版等原因导致不能排序时的说明；有值 = 手柄不 draggable、激活时播报原因。 */
  sortBlockedReason?: string;
  onSelect: () => void;
  onToggle: () => void;
  /** 手柄获得焦点即选中这一行：键盘用户 Tab 到手柄后直接按 Enter 就能排"这一条"。 */
  onSortFocus: () => void;
  onSortStart: () => void;
  onSortKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}

function rowClassNames(base: string, moving: boolean, dropTarget: boolean, extra = ""): string {
  return [base, moving ? "is-moving" : "", dropTarget ? "is-drop-target" : "", extra]
    .filter(Boolean)
    .join(" ");
}

function Caret({
  expanded,
  hasChildren,
  onToggle,
}: {
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
}) {
  if (!hasChildren) return <span className="resume-outline-caret is-empty" aria-hidden="true" />;
  return (
    <span
      className={"resume-outline-caret" + (expanded ? " is-expanded" : "")}
      aria-hidden="true"
      onClick={(event) => {
        // 展开箭头不改变选中：点箭头只展开/收起，点标题才选中（避免误触选择）。
        event.stopPropagation();
        onToggle();
      }}
    >
      ▸
    </span>
  );
}

function SortHandle({
  label,
  hint,
  draggable,
  active,
  onFocus,
  onStart,
  onKeyDown,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  hint: string;
  draggable: boolean;
  /** 这条正处在键盘排序会话里（aria-pressed 的表达，读屏可感知"已抓起"）。 */
  active: boolean;
  onFocus: () => void;
  onStart: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <Tooltip title={hint}>
      <Button
        className="resume-outline-handle"
        type="text"
        size="small"
        icon={<HolderOutlined />}
        aria-label={label}
        aria-pressed={active}
        draggable={draggable}
        onFocus={onFocus}
        onClick={(event) => {
          event.stopPropagation();
          onStart();
        }}
        onKeyDown={onKeyDown}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    </Tooltip>
  );
}

export function EntryRowContent({
  entry,
  expanded,
  moving,
  dropTarget,
  readOnly,
  displayName,
  sortBlockedReason,
  onSelect,
  onToggle,
  onSortFocus,
  onSortStart,
  onSortKeyDown,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: EntryRowContentProps) {
  const hasPoints = entry.points.length > 0;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘等价物在外层 treeitem 上（Enter/Space 选中）
    <div
      className={rowClassNames(
        "resume-outline-row",
        moving,
        dropTarget,
        entry.hidden ? "is-hidden" : "",
      )}
      onClick={onSelect}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Caret expanded={expanded} hasChildren={hasPoints} onToggle={onToggle} />
      {readOnly ? null : (
        <SortHandle
          label={t("outline.sort.handle", { name: displayName })}
          hint={sortBlockedReason ?? t("outline.sort.handle.hint")}
          draggable={!sortBlockedReason}
          active={moving}
          onFocus={onSortFocus}
          onStart={onSortStart}
          onKeyDown={onSortKeyDown}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      )}
      <div className="resume-outline-main">
        <span className="resume-outline-title">{displayName}</span>
        {entry.subtitle ? <span className="resume-outline-subtitle">{entry.subtitle}</span> : null}
        {entry.hidden ? (
          <span className="resume-outline-badge is-hidden">{t("outline.hidden.badge")}</span>
        ) : null}
        {entry.lockContent ? (
          <span className="resume-outline-badge">{t("outline.lock.content.badge")}</span>
        ) : null}
        {entry.lockLayout ? (
          <span className="resume-outline-badge">{t("outline.lock.layout.badge")}</span>
        ) : null}
      </div>
      {hasPoints ? (
        <span className="resume-outline-point-count">
          {t("outline.entry.lineCount", { count: entry.points.length })}
        </span>
      ) : null}
    </div>
  );
}

export interface PointRowContentProps {
  point: OutlinePoint;
  moving: boolean;
  dropTarget: boolean;
  readOnly: boolean;
  sortBlockedReason?: string;
  onSelect: () => void;
  /** 手柄获得焦点即选中这一行（见 EntryRowContentProps.onSortFocus）。 */
  onSortFocus: () => void;
  onSortStart: () => void;
  onSortKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}

export function PointRowContent({
  point,
  moving,
  dropTarget,
  readOnly,
  sortBlockedReason,
  onSelect,
  onSortFocus,
  onSortStart,
  onSortKeyDown,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: PointRowContentProps) {
  const displayText = point.text || t("outline.point.empty");
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 键盘等价物在外层 treeitem 上（Enter/Space 选中）
    <div
      className={rowClassNames("resume-outline-row is-point", moving, dropTarget)}
      onClick={onSelect}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {readOnly ? null : (
        <SortHandle
          label={t("outline.sort.pointHandle")}
          hint={sortBlockedReason ?? t("outline.sort.handle.hint")}
          draggable={!sortBlockedReason}
          active={moving}
          onFocus={onSortFocus}
          onStart={onSortStart}
          onKeyDown={onSortKeyDown}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      )}
      <span className={"resume-outline-point-text" + (point.text ? "" : " is-empty")}>
        {displayText}
      </span>
    </div>
  );
}

export interface SectionHeaderContentProps {
  title: string;
  count?: number;
  expanded: boolean;
  collapsible: boolean;
  subtitle?: string;
  onToggle: () => void;
}

export function SectionHeaderContent({
  title,
  count,
  expanded,
  collapsible,
  subtitle,
  onToggle,
}: SectionHeaderContentProps) {
  return (
    // 整行点击只在这里处理（外层 treeitem 不挂 onClick）：否则点条目行会冒泡到分组把整组收起。
    <div className="resume-outline-section" onClick={() => (collapsible ? onToggle() : undefined)}>
      <Caret expanded={expanded} hasChildren={collapsible} onToggle={onToggle} />
      <span className="resume-outline-section-title">{title}</span>
      {typeof count === "number" ? (
        <span className="resume-outline-section-count">{count}</span>
      ) : null}
      {subtitle ? <span className="resume-outline-subtitle">{subtitle}</span> : null}
    </div>
  );
}
