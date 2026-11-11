// SPDX-License-Identifier: Apache-2.0
/**
 * 一个 item 的 chip（可拖动、可键盘移动；隐藏/移除在右键菜单）。
 *
 * ## 键盘等价物（必须有，不能只有鼠标拖拽）
 *
 * 聚焦 chip 后按 Enter / 空格「拿起」，方向键移动：
 * - ↑ / ↓：同一位置组内上/下移一位，到边界给可读提示；
 * - ← / →：在允许的位置之间循环切换（field 六个、list/authors 三个）；
 * - Enter：确认（退出拿起态）；Esc：取消并恢复到拿起时的那份文档。
 *
 * 拿起期间每次方向键都通过 `onChange` 写回新文档（工作台据此记历史），Esc 用快照恢复；
 * 这样"取消"在界面上看得见，也不依赖编辑器自己维护第二份文档。
 */
import { HolderOutlined } from "@ant-design/icons";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";

type DragSourceEvent = DragEvent<HTMLElement>;
type ChipKeyEvent = KeyboardEvent<HTMLElement>;
import { useRef, useState } from "react";
import { useI18n } from "../../i18n/i18nContext";
import type { ResumeDocument, ResumeItem } from "../../types/resumeDocument";
import { itemDisplayLabel, itemDisplayValue } from "../../features/resume-document/format";
import { enumLabelOf } from "../../features/resume-document/fieldCatalog";
import { getItemPlacement, moveItem } from "../../features/resume-document";
import { keyboardMoveTarget, slotOf } from "../../features/resume-document/drag";
import { itemPath as buildItemPath } from "../../features/resume-document/paths";
import { DRAG_REJECT_COPY } from "./dragRejectCopy";
import { useDocumentDrag } from "./documentDragContext";
import { useDocumentChipMenu } from "./documentChipMenuContext";
import { useBlockSelectStart } from "./useBlockSelectStart";
import { useChipExpandGesture } from "./useChipExpandGesture";
import { resolveFactAnnotation, useFactAnnotations } from "./factSourceContext";
import FactSourceBadge from "../resume/FactSourceBadge";

interface Props {
  document: ResumeDocument;
  path: string;
  item: ResumeItem;
  /** 目录标签（后端目录的 label；item.label 非空时优先 item.label）。 */
  catalogLabel?: string;
  materialOnly?: boolean;
  selected: boolean;
  readOnly?: boolean;
  sectionKey: string;
  entryId: string;
  /** 点击已选中的 chip 再次上报 null，让宿主收起编辑器（Q 与“条目标题展开”同一语义）。 */
  onSelect: (path: string | null) => void;
  onChange: (next: ResumeDocument) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
  /** 选中时渲染在 chip 下方的编辑器（EntryCard 传入）。 */
  children?: ReactNode;
}

export default function ItemChip({
  document,
  path,
  item,
  catalogLabel = "",
  materialOnly = false,
  selected,
  readOnly = false,
  sectionKey,
  entryId,
  onSelect,
  onChange,
  onNotice,
  children,
}: Props) {
  const { t } = useI18n();
  const drag = useDocumentDrag();
  /**
   * #24 24E：这一栏的**来源徽标**。标注由中栏宿经 context 一次给全（`factSourceContext`），
   * 这里只按自己的路径解析；解析不到（页眉式字段 / 旧记录没有标注）就**不渲染徽标**，
   * 绝不显示"未知来源"。
   */
  const factAnnotations = useFactAnnotations();
  const factAnnotation = resolveFactAnnotation(document, path, factAnnotations);
  const [grabbed, setGrabbed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // R-30：菜单不在这里，交给编辑器那一份（见 documentChipMenuContext）。
  const chipMenuHost = useDocumentChipMenu();
  // #8：展开态与手势判定来自编辑器级 context（单击选中 / 双击展开分离）。
  // 双击的第二下 click 自己就是展开/收起，不再依赖 dblclick 是否送达，
  // 原因见 useChipExpandGesture 的文件注释。
  const { expanded, consumePairSecondClick, handleDoubleClick, toggleFromKeyboard, setExpanded } =
    useChipExpandGesture(path, onSelect);
  // 指针按下时的选中态：focus 会先于 click 触发并选中这一行，若 click 再读实时
  // selected，就会“第一次点开、同一帧又收起”。click 只认按下前的那一刻。
  const selectedAtPointerDownRef = useRef<boolean | null>(null);
  // 右键菜单/拖拽也会让 button 获得焦点；焦点只给键盘 Tab 打开字段，不替鼠标右键打开。
  const pointerFocusRef = useRef(false);
  const snapshotRef = useRef<ResumeDocument | null>(null);
  const hidden = getItemPlacement(item) === "hidden";
  const label = itemDisplayLabel(item, catalogLabel);
  // #11a：枚举字段显示本地化标签（后端纸面渲染同源），目录没有时回落原值。
  const value = itemDisplayValue(item, {
    resolveEnum:
      item.kind === "field" && item.format === "enum"
        ? (raw) => enumLabelOf(null, sectionKey, item.key, raw, t)
        : undefined,
  });
  // 问题 12：正文块也能拖了。但它的正文区是可编辑文本，整块 draggable 会把「拖选一句话里
  // 的几个字」变成「拖走整块」——所以正文块的 draggable 只挂在独立把手上，字段 chip 维持
  // 整块可拖（原有手感不变）。
  const canMove = !readOnly;
  const dragOnHandleOnly = item.kind === "text";
  // 这枚 chip 里永远不许有选区：有选区时 Chrome 会把"按住拖动"判成"拖动选中文字"
  // （顶部弹「松开鼠标以搜索文本」），拖动排序就失效了。CSS 只管"从零框选"，
  // 拦不住"按下落在既有选区里"，所以容器上再补一层（见 useBlockSelectStart）。
  const chipRef = useBlockSelectStart<HTMLDivElement>();

  const startGrab = () => {
    if (!canMove) return;
    snapshotRef.current = document;
    setGrabbed(true);
    setAnnouncement(t("document.drag.grabbed"));
  };

  const finishGrab = () => {
    snapshotRef.current = null;
    setGrabbed(false);
    setAnnouncement("");
  };

  const handleKeyDown = (event: ChipKeyEvent) => {
    // Shift+F10 / 菜单键是右键菜单的键盘等价物：字段的隐藏/删除不再有可见按钮。
    if (!readOnly && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      event.preventDefault();
      // 键盘等价物也走同一份菜单：拿 chip 自己的矩形中心当锚点，位置和右键点差不多。
      const box = event.currentTarget.getBoundingClientRect();
      chipMenuHost.request?.({
        path,
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      });
      return;
    }
    if (!grabbed) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        startGrab();
      }
      // #8：F2 = 键盘的「展开/收起字段编辑器」（与双击同路）。
      if (event.key === "F2") {
        event.preventDefault();
        toggleFromKeyboard();
        return;
      }
      // A3：Esc 分层——先收字段编辑器（焦点留在 chip 上），再收选中；只有两者都不在时
      // 才把事件放行给 antd Modal（它会关掉整个制作台）。stopPropagation 是必须的：
      // Modal 的 Esc 监听在 window 冒泡阶段，不拦就会"收编辑器"和"关制作台"一起发生。
      if (event.key === "Escape") {
        if (expanded) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(null);
          return;
        }
        if (selected) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(null);
          return;
        }
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      onNotice(t("document.drag.moved"), "info");
      finishGrab();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (snapshotRef.current) onChange(snapshotRef.current);
      onNotice(t("document.drag.canceled"), "info");
      finishGrab();
      return;
    }
    const direction =
      event.key === "ArrowUp"
        ? "up"
        : event.key === "ArrowDown"
          ? "down"
          : event.key === "ArrowLeft"
            ? "left"
            : event.key === "ArrowRight"
              ? "right"
              : null;
    if (!direction) return;
    event.preventDefault();
    const located = document.sections
      .find((section) => section.key === sectionKey)
      ?.entries.find((candidate) => candidate.id === entryId);
    const currentItem = located?.items.find((candidate) => candidate.id === item.id);
    const slot = currentItem ? slotOf(located?.items ?? [], currentItem) : null;
    if (!slot || !currentItem) return;
    const target = keyboardMoveTarget(located?.items ?? [], currentItem, slot, direction);
    if (!target) {
      onNotice(t("document.drag.boundary"), "warning");
      return;
    }
    const next = moveItem(document, buildItemPath(sectionKey, entryId, currentItem.id), {
      placement: target.placement,
      toIndex: target.index,
    });
    if (next === document) {
      onNotice(t("document.drag.invalid"), "warning");
      return;
    }
    onChange(next);
    setAnnouncement(t("document.drag.grabbed"));
  };

  const handleDragStart = (event: DragSourceEvent) => {
    if (!canMove) {
      event.preventDefault();
      onNotice(t("document.drag.unsupported"), "warning");
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", path);
    // 上一次拖拽的判断不能漏到这一次：先清空，等目标位的 dragover 重新写。
    drag.markRejected(null);
    drag.setDraggedPath(path);
  };

  /**
   * 问题 13：`dragend` 是**唯一**能兜底的地方。
   *
   * 非法落点会把 `dropEffect` 设成 `"none"`（用户要的禁止光标），浏览器因此不派发 `drop`，
   * `EntryCard` 的 `onDrop` 里那些文案永远说不出口——退回"拖了一下，什么都没发生"。
   * 所以原因由目标位记进来（`drag.markRejected`），这里在松手后补一条提示。
   *
   * 判据只认我们自己记的 ref，不读 `event.dataTransfer.dropEffect`：Chrome 里成功与失败
   * 都可能读到 `none`，读它会把"已移动"误判成"被拒"。
   */
  const handleDragEnd = () => {
    const reason = drag.takeRejectReason();
    drag.setDraggedPath(null);
    if (reason) onNotice(t(DRAG_REJECT_COPY[reason]), "warning");
  };

  return (
    <>
      <div
        ref={chipRef}
        className={[
          "document-chip",
          selected ? "is-selected" : "",
          grabbed ? "is-grabbed" : "",
          hidden ? "is-hidden" : "",
          // 问题 13：拖动源要明显弱化，否则用户看不到"被拿起来的是哪一条"。
          drag.draggedPath === path ? "is-dragging" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-document-path={path}
        data-item-kind={item.kind}
        role="group"
        aria-label={`${label}${value ? `\uFF1A${value}` : ""}`}
      >
        {/* 正文块：draggable 只挂这个把手（见 canMove 上面的注释）。 */}
        {canMove && dragOnHandleOnly ? (
          <button
            type="button"
            className="document-chip-handle"
            draggable
            aria-label={t("document.item.drag")}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            /* 这里**不能** `onMouseDown` 里 `preventDefault()`：那会连 HTML5 拖拽的起点
               一起吃掉，表现为"按住把手拖不动"（2026-11-04 用户实测）。
               防选区交给 `user-select: none` 与容器上的 `selectstart` 拦截（见
               `useBlockSelectStart`），它们不碰默认拖拽行为。 */
          >
            <HolderOutlined aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="document-chip-main"
          aria-pressed={selected}
          aria-expanded={expanded}
          aria-describedby={grabbed ? `${path}-drag-hint` : undefined}
          draggable={canMove && !dragOnHandleOnly}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onPointerDown={() => {
            selectedAtPointerDownRef.current = selected;
            pointerFocusRef.current = true;
            window.setTimeout(() => {
              pointerFocusRef.current = false;
            }, 0);
          }}
          // #8：单击只选中（高亮/结构树联动），双击/F2 才展开字段编辑器——
          // 扫视字段时点一下就弹出一大块编辑器，容易误触。焦点事件只负责选中。
          onClick={(event) => {
            const wasSelected = selectedAtPointerDownRef.current ?? selected;
            selectedAtPointerDownRef.current = null;
            // 双击的第二下 = 展开/收起，并且**不**翻转选中——否则「没展开 + 取消选中」。
            if (consumePairSecondClick(event.detail)) return;
            onSelect(wasSelected ? null : path);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            handleDoubleClick();
          }}
          onFocus={() => {
            if (!selected && !pointerFocusRef.current) onSelect(path);
          }}
          onKeyDown={handleKeyDown}
        >
          {canMove && !dragOnHandleOnly ? (
            <HolderOutlined className="document-chip-drag" aria-hidden="true" />
          ) : null}
          {label ? <span className="document-chip-label">{label}</span> : null}
          <span
            className={`document-chip-value${value ? "" : " document-chip-placeholder"}`}
            title={value || undefined}
          >
            {value || t("document.item.untitled")}
          </span>
        </button>
        {materialOnly ? (
          <span className="document-chip-badge is-material">{t("document.item.materialOnly")}</span>
        ) : null}
        {/* #24 24E：来源徽标（资料库 / AI 生成 / 手动）。放在 `.document-chip-main` **外面**：
            主按钮是"选中 / 双击展开"的热区，把这些行为挤进按钮里会连带改变它的可点区域。 */}
        {factAnnotation ? (
          <FactSourceBadge annotation={factAnnotation} document={document} />
        ) : null}
        {hidden ? (
          <span className="document-chip-badge">{t("document.item.hiddenBadge")}</span>
        ) : null}
      </div>
      {grabbed ? (
        <div className="document-drag-hint" role="status">
          {t("document.drag.aria")}
        </div>
      ) : null}
      <span className="document-live-region" role="status" aria-live="polite">
        {announcement}
      </span>
      {expanded ? children : null}
    </>
  );
}
