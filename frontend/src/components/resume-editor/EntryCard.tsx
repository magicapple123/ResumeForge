// SPDX-License-Identifier: Apache-2.0
/**
 * 一条条目的**三域卡**：标题与元信息 / 灰色短字段 / 正文。
 *
 * - 三个域都是拖放目标；chip 之间也可以拖（落在 chip 上 = 插到它前面）；非法目标给可读提示；
 * - 条目头（序号 / 隐藏徽标 / 「⋯」菜单）在 `EntryCardHead`；「标题布局」三个图标
 *   在 `EntryHeadLayoutSwitch`，挂在「标题与元信息」域标题行右端（问题 6）；
 * - R-05 的四区重整：域 = 带 `border-left` 竖线的三块（13px 标题 + 计数），域内每个位置组
 *   是 `EntryZoneGroup`（11px 标签 + 等宽 chips 网格 + 右侧虚线 `+` 格）。"组"不再是容器，
 *   一个 4 字段条目比改前少 3 行以上。
 */
import type { DragEvent, ReactNode } from "react";
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
  defaultTextItem,
  dropRejectReason,
  entryPath as buildEntryPath,
  getItemPlacement,
  groupByPlacement,
  itemPath as buildItemPath,
  locatePath,
  moveItem,
  placementGroup,
  resolveDropIndex,
} from "../../features/resume-document";
import type { DropSide } from "../../features/resume-document";
import { addItem as addEntryItem } from "../../features/resume-document/mutations";
import { DRAG_REJECT_COPY } from "./dragRejectCopy";
import EntryCardHead from "./EntryCardHead";
import EntryHeadLayoutSwitch from "./EntryHeadLayoutSwitch";
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
  // #9-B：被拿起的 item 从**整份文档**解析，不只看本条目。拖拽源可能在同板块的别的条目里，
  // 只在本条目里找会拿不到 item → 既不判合法性、也给不出提示，表现为"拖了没反应"。
  const draggedLocated = draggedPath ? locatePath(document, draggedPath) : null;
  const draggedItem = draggedLocated?.kind === "item" ? draggedLocated.item : null;

  // #26：高亮从"正在拖拽"这一事实派生，不再依赖 dragleave 成对出现——空白处松手、
  // Esc 取消（只有 dragend）、拖去别的卡片时本卡都收不到 dragleave，虚线框因此残留。
  useEffect(() => {
    if (!draggedPath) {
      setDragOverZone(null);
      setDropTarget(null);
    }
  }, [draggedPath]);

  const dropAt = (path: string, placement: Placement, toIndex?: number) => {
    // 从整份文档解析：目标 item 可能与拖拽源同条目，也可能在别的条目里（同板块内拖动）。
    const located = locatePath(document, path);
    if (!located || located.kind !== "item") return;
    const item = located.item;
    // 问题 13：三种拒绝原因的文案在这里统一出口（跨方框 / 正文块区 / 位置不允许），
    // 与 `dragend` 兜底用的是同一张 `DRAG_REJECT_COPY` 表——同一个原因不会有两种说法。
    const reject = dropRejectReason(item, placement);
    if (reject) {
      onNotice(t(DRAG_REJECT_COPY[reject]), "warning");
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

  /**
   * 落在大框空白处 = 追加到该位置组末尾。
   *
   * 问题 13 只改了"非法落点"这一半：目标方框本身允许拖入时，整组 `is-dragover` 淡蓝底 +
   * 虚线已经足够明确，不改成禁止光标；但"本来就在末尾"必须明说，否则静默等于功能坏了。
   */
  const handleZoneDrop = (placement: Placement) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOverZone(null);
    const path = event.dataTransfer.getData("text/plain") || drag.draggedPath;
    // `drop` 真的到达 → 文案由这里给，`dragend` 不能再补一条（否则两条提示打架）。
    drag.markRejected(null);
    if (!path) return;
    drag.setDraggedPath(null);
    if (draggedItem) {
      const group = placementGroup(entry.items, placement);
      const indexInGroup = group.findIndex((candidate) => candidate.id === draggedItem.id);
      if (indexInGroup >= 0 && indexInGroup === group.length - 1) {
        onNotice(t("document.drag.samePosition"), "warning");
        return;
      }
    }
    dropAt(path, placement);
  };

  const handleZoneOver = (placement: Placement) => (event: DragEvent<HTMLDivElement>) => {
    // 没有"我们发起的拖拽"就什么都不做（外部文件拖进来交给浏览器默认行为）。
    if (!draggedItem) return;
    // 2026-11-02 返工曾把 `dropEffect="none"` 全部去掉（它会让浏览器**不派发 drop**，
    // 于是非法落点既没有动作也没有提示）。问题 13 把它请回来，但**只给真正非法的方框**：
    // 原因记进来，松手后由拖拽源的 `dragend` 补一条可读提示。
    event.preventDefault();
    const reject = dropRejectReason(draggedItem, placement);
    if (reject) {
      drag.markRejected(reject);
      event.dataTransfer.dropEffect = "none";
      setDragOverZone(null);
      return;
    }
    drag.markRejected(null);
    event.dataTransfer.dropEffect = "move";
    // 高亮只在能落下的方框上亮：指示"松手会发生什么"，不能连拒绝的位置也描边。
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
          // 外部拖拽（没有 dragstart 来自 chip）不接管。
          if (!draggedItem) return;
          // 问题 13：落点是**插入排序**（左半边 = 插到它前面，右半边 = 插到它后面），
          // 于是"插到右邻的前面"必然等于没动。以前 dragover 只判"是不是自己 / 能不能跨方框"，
          // no-op 落点照样得到一条明确的蓝色指示，松手却什么都没发生——本次改成：
          // 位置非法或插完不动 → 禁止光标 + 不画线，原因记进 ref 由 dragend 说。
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          const side: DropSide = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
          const reject = dropRejectReason(draggedItem, placement);
          if (reject) {
            drag.markRejected(reject);
            event.dataTransfer.dropEffect = "none";
            setDropTarget(null);
            return;
          }
          // `toIndex` 只有这一份实现（resolveDropIndex）；dragover 与 drop 共用它的输出，
          // 各算一份一定会漂移，表现就是"线画在右边、落点却在左边"。
          const resolution = resolveDropIndex(
            group.map((candidate) => candidate.id),
            draggedItem.id,
            indexInGroup,
            side,
          );
          if (resolution.noop) {
            drag.markRejected("samePosition");
            event.dataTransfer.dropEffect = "none";
            setDropTarget(null);
            return;
          }
          drag.markRejected(null);
          event.dataTransfer.dropEffect = "move";
          setDropTarget({ path, side });
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const droppedPath = event.dataTransfer.getData("text/plain") || drag.draggedPath;
          setDropTarget(null);
          // `drop` 真的到达 → 文案由这里给，`dragend` 不能再补一条。
          drag.markRejected(null);
          if (!droppedPath) return;
          drag.setDraggedPath(null);
          // 落点侧**用事件坐标现算**（读 React state `dropTarget` 在同一个事件里可能还是
          // 上一帧的值，会永远退回 "before"）——与 dragover 里同一个判据。
          const rect = event.currentTarget.getBoundingClientRect();
          const side: DropSide = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
          const resolution = resolveDropIndex(
            group.map((candidate) => candidate.id),
            draggedItem?.id ?? "",
            indexInGroup,
            side,
          );
          if (droppedPath === path || resolution.noop) {
            // 落在自己原来的槽位：静默等于"功能坏了"，明确告诉用户没变化
            // （与「已经到边界了」不是一件事，用专门的 samePosition 文案）。
            onNotice(t("document.drag.samePosition"), "warning");
            return;
          }
          // 跨方框不在这里拦：交给 dropAt 统一判定并给"不能放到这里"的文案
          // （位置不允许 / 跨方框两条拒绝原因各用各的措辞）。
          dropAt(droppedPath, placement, Math.max(0, resolution.toIndex));
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
            sectionKind={section.kind}
            catalog={catalog}
            readOnly={readOnly}
            onChange={onChange}
          />
        </ItemChip>
      </div>
    );
  };

  /**
   * 一个域的标题行：13px 名称 + 计数（R-05 ②），可选的行尾插槽。
   *
   * `trailing` 是给「标题与元信息」域用的：那三个「标题布局」按钮就改这一域的排法，
   * 所以必须和它的标题在同一行（问题 6）。其它域不传，行尾自然留白。
   */
  const domainTitle = (labelKey: MessageKey, count: number, trailing?: ReactNode) => (
    <div className="document-zone-title-row">
      <span className="document-zone-title">{t(labelKey)}</span>
      <span className="document-zone-count">{count}</span>
      {trailing}
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
        {domainTitle(
          "document.zone.head",
          countOf(HEAD_ZONE_GROUPS),
          // 问题 6：三个「标题布局」按钮跟着它们控制的那一域走（空域也照样渲染）。
          <EntryHeadLayoutSwitch
            document={document}
            entry={entry}
            entryPath={entryPath}
            readOnly={readOnly}
            onChange={onChange}
          />,
        )}
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
          {/* 正文区只留「添加正文块」：字段一旦进正文，中栏会同时长出字段控件与正文控件，
              纸面 `_body_blocks` 只认 TextItem，于是中栏有、纸面没有（2026-11-02 缺陷 9-B）。 */}
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
