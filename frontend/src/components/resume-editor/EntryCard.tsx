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
import type { ReactNode } from "react";
import { memo } from "react";
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
  placementGroup,
  resolveDropIndex,
} from "../../features/resume-document";
import type { DropSide } from "../../features/resume-document";
import { addItem as addEntryItem } from "../../features/resume-document/mutations";
import EntryCardHead from "./EntryCardHead";
import EntryHeadLayoutSwitch from "./EntryHeadLayoutSwitch";
import EntryZoneGroup from "./EntryZoneGroup";
import ItemChip from "./ItemChip";
import ItemEditor from "./ItemEditor";
import { useDocumentDrag } from "./documentDragContext";
import { useDocumentExpand } from "./documentExpandContext";
import { useEntryDragDrop } from "./useEntryDragDrop";

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
  // 问题 21：三种落点指示（蓝条 / 禁用色描边 / 整框虚线）的状态机整体在
  // `useEntryDragDrop` 里，由一组动作成套写入，避免"只复位一半"。
  const {
    draggedItem,
    dropTarget,
    rejectPath,
    dropAt,
    chipOver,
    chipReject,
    chipLeave,
    chipDrop,
    zoneDragOver,
    handleZoneOver,
    handleZoneDrop,
    handleZoneLeave,
  } = useEntryDragDrop({ document, entry, onChange, onNotice });
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
    // 问题 21a：拒绝态与蓝条互斥——同一个 `onDragOver` 分支里二选一，这里只读结果。
    const rejected = rejectPath === path;
    return (
      <div
        key={item.id}
        className={`document-chip-slot${expanded ? " is-editing" : ""}${
          dropSide ? ` is-drop-${dropSide}` : ""
        }${rejected ? " is-drop-rejected" : ""}`}
        data-document-path={path}
        onDragLeave={(event) => chipLeave(path, event)}
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
            chipReject(path);
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
            chipReject(path);
            return;
          }
          drag.markRejected(null);
          event.dataTransfer.dropEffect = "move";
          chipOver(path, side);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const droppedPath = event.dataTransfer.getData("text/plain") || drag.draggedPath;
          chipDrop();
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
    // 问题 21a：整框虚线只在**没有任何 chip 级指示**时才亮（chip 蓝条 / 拒绝描边都算），
    // 门控是兜底，`useEntryDragDrop` 里的成套复位才是根治。
    dragOver: zoneDragOver(spec.placement),
    onZoneOver: handleZoneOver(spec.placement),
    onZoneLeave: handleZoneLeave,
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
              zoneDragOver("hidden") ? " is-dragover" : ""
            }`}
            data-document-zone="hidden"
            onDragOver={handleZoneOver("hidden")}
            onDragLeave={handleZoneLeave}
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
          zoneDragOver("body") ? " is-dragover" : ""
        }`}
        data-document-zone="body"
        onDragOver={handleZoneOver("body")}
        onDragLeave={handleZoneLeave}
        onDrop={handleZoneDrop("body")}
      >
        {domainTitle("document.zone.body", bodyItems.length)}
        {/* 问题 21b：正文块的可拖区域是左侧那枚把手（正文区要留给选文字），
            与灰字区的 `detailHint` 同构补一句提示；只有一个块时无顺序可调，不显示。 */}
        {bodyItems.length > 1 && !readOnly ? (
          <span className="document-section-hint">{t("document.zone.bodyHint")}</span>
        ) : null}
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
