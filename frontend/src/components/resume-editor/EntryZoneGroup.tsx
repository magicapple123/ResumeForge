// SPDX-License-Identifier: Apache-2.0
/**
 * 一个**位置组**（title / meta / lead / trail / body / hidden）的渲染单元。
 *
 * ## 为什么要单独一个文件
 *
 * `EntryCard` 原本把这一坨（区容器 + 区头 + chips 网格 + 空态 + 添加字段菜单）写成一个本地
 * `renderGroup` 闭包，四处调用；条目卡因此顶到 481 行，加不动 R-05 的四区重整。
 * 抽出来以后：`EntryCard` 只负责"三个域怎么摆"和条目头，组内的布局细节都留在这里。
 *
 * ## 布局契约（R-05）
 *
 * - 组**不再是容器**：没有边框、没有内边距，只有一枚 11px 标签 + 一段 chips 网格；
 *   「标题与元信息 / 灰色短字段 / 正文」三个域才有 `border-left` 竖线与 13px 标题；
 * - 组内是网格：title / meta / body 用 `repeat(auto-fill, minmax(148px, 1fr))`（同组等宽），
 *   lead / trail 用 `--document-columns`（**预览纸面的列数**，不能改）；
 * - 「添加字段」是网格末尾的一枚虚线 `+` 格；空组只剩一行（标签 + `+`），不再三行。
 *
 * ## 不能删的 DOM
 *
 * 每个组的根节点必须保留 `data-document-zone={placement}` 与 `is-dragover` 类：拖拽的
 * 命中判定与高亮都读它们（`documentDrag` 相关测试直接 `querySelector` 这个属性）。
 */
import { memo } from "react";
import type { CSSProperties, DragEvent, ReactNode } from "react";
import type {
  DocumentFieldCatalog,
  Placement,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
} from "../../types/resumeDocument";
import { placementGroup } from "../../features/resume-document";
import AddFieldMenu from "./AddFieldMenu";

/** 灰色短字段（lead / trail）跟 `--document-columns`，其余三组用等宽自适应网格。 */
const COLUMN_GROUPS: readonly Placement[] = ["lead", "trail"];

interface Props {
  document: ResumeDocument;
  sectionKey: string;
  entry: ResumeEntry;
  entryId: string;
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  placement: Placement;
  /** 已 `t()` 过的组名（11px 标签）。 */
  label: string;
  /** 已 `t()` 过的空态说明；空组时作为 `+` 格的提示（`title`）。 */
  emptyText: string;
  /** 已 `t()` 过的「添加字段」按钮名；空串 = 该组不允许加字段。 */
  addLabel?: string;
  /** 分区/条目的列数（只有 lead / trail 用得到）。 */
  columns: number;
  dragOver: boolean;
  onZoneOver: (event: DragEvent<HTMLDivElement>) => void;
  onZoneLeave: (event: DragEvent<HTMLDivElement>) => void;
  onZoneDrop: (event: DragEvent<HTMLDivElement>) => void;
  /** chip 由 `EntryCard` 渲染（需要 catalog 查标签、需要提交回文档）。 */
  renderChip: (item: ResumeItem) => ReactNode;
  onChange: (next: ResumeDocument) => void;
  onSelectPath: (path: string | null) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
  /**
   * 位置组内已分好的 chips（R-30）：上层 `groupByPlacement` 一次遍历给出，
   * 不传时退回自己 filter（独立使用的场景与测试不受影响）。
   */
  items?: readonly ResumeItem[];
}

function EntryZoneGroup({
  document,
  sectionKey,
  entry,
  entryId,
  catalog = null,
  readOnly = false,
  placement,
  label,
  emptyText,
  addLabel = "",
  columns,
  dragOver,
  onZoneOver,
  onZoneLeave,
  onZoneDrop,
  renderChip,
  onChange,
  onSelectPath,
  onNotice,
  items: groupedItems,
}: Props) {
  // R-30：优先用上层分好的结果；只有独立渲染时（没有分组表）才自己 filter。
  const items = groupedItems ?? placementGroup(entry.items, placement);
  const followsColumns = COLUMN_GROUPS.includes(placement);
  const gridClass = `document-group ${followsColumns ? "document-group-lead" : "document-group-cells"}`;
  const gridStyle = followsColumns
    ? ({ "--document-columns": String(columns) } as CSSProperties)
    : undefined;

  const addCell = addLabel ? (
    <AddFieldMenu
      document={document}
      sectionKey={sectionKey}
      entryId={entryId}
      placement={placement}
      catalog={catalog}
      readOnly={readOnly}
      label={addLabel}
      hint={emptyText}
      variant="cell"
      onChange={onChange}
      onSelectPath={onSelectPath}
      onNotice={onNotice}
    />
  ) : null;

  const titleNode = (
    <span className="document-group-block-title">
      {label}
      {items.length > 0 ? <span className="document-group-block-count">{items.length}</span> : null}
    </span>
  );

  return (
    <div
      className={`document-group-block${dragOver ? " is-dragover" : ""}`}
      data-document-zone={placement}
      onDragOver={onZoneOver}
      onDragLeave={onZoneLeave}
      onDrop={onZoneDrop}
    >
      {items.length === 0 ? (
        /* 空组：标签与「+」并排一行（此前是"标签行 + 空态行 + 添加按钮"三行）。 */
        <div className="document-group-block-line">
          {titleNode}
          {addCell}
        </div>
      ) : (
        <>
          {titleNode}
          {/* 「+」格挂在网格**右侧**而不是塞进网格：塞进去时 2 列格子放不下第 3 个单元，
              每个组都会多出一整行只有「+」。 */}
          <div className="document-group-row">
            <div className={gridClass} style={gridStyle}>
              {items.map((item) => renderChip(item))}
            </div>
            {addCell}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * R-30：条目卡里 6 个位置组各自 memo。props 里的回调由 EntryCard 用 useCallback 稳定，
 * 未改动的位置组不会因为兄弟组变化而重渲染（一次输入只重画真正变了的那一组）。
 */
export default memo(EntryZoneGroup);
