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
import { useDocumentDrag } from "./documentDragContext";
import { useDocumentChipMenu } from "./documentChipMenuContext";
import { useChipExpandGesture } from "./useChipExpandGesture";

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
  const canMove = item.kind !== "text" && !readOnly;

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
    drag.setDraggedPath(path);
  };

  return (
    <>
      <div
        className={[
          "document-chip",
          selected ? "is-selected" : "",
          grabbed ? "is-grabbed" : "",
          hidden ? "is-hidden" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-document-path={path}
        data-item-kind={item.kind}
        role="group"
        aria-label={`${label}${value ? `\uFF1A${value}` : ""}`}
      >
        <button
          type="button"
          className="document-chip-main"
          aria-pressed={selected}
          aria-expanded={expanded}
          aria-describedby={grabbed ? `${path}-drag-hint` : undefined}
          draggable={canMove}
          onDragStart={handleDragStart}
          onDragEnd={() => drag.setDraggedPath(null)}
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
          {canMove ? <HolderOutlined className="document-chip-drag" aria-hidden="true" /> : null}
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
