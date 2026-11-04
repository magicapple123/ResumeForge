// SPDX-License-Identifier: Apache-2.0
/**
 * 基本信息（页眉）字段的 chip（#10）。
 *
 * 与正文板块的 `ItemChip` **同一套交互形态**：单击选中、双击 / F2 展开字段编辑器、
 * 右键出菜单（隐藏 / 删除）、拖拽或方向键换位置。为什么不是直接复用 `ItemChip`：
 * 页眉位置枚举是 `HeaderPlacement`（name / name_meta / subtitle / contact / photo /
 * hidden），与正文的 `Placement` 不同，槽位计算与移动函数也不是同一份；共用组件会让
 * 两边的类型与分支互相拖累。共用的是**样式类与 context 通道**（菜单 / 展开 / 拖拽），
 * 因此观感与键盘约定与正文完全一致。
 *
 * #25：照片字段（`basic_info.photo`，值是 data URL）在这里渲染成**缩略图**，绝不把
 * base64 当文本铺出来；缩略图缺失（还没上传）时退回占位文案。
 */
import { HolderOutlined } from "@ant-design/icons";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { useRef, useState } from "react";
import { useI18n } from "../../i18n/i18nContext";
import type { HeaderItem, ResumeDocument } from "../../types/resumeDocument";
import { isPhotoDataUrl, moveHeaderItem } from "../../features/resume-document/headerOrder";
import { headerSlotOf, keyboardHeaderMoveTarget } from "../../features/resume-document/headerOrder";
import { enumLabelOf } from "../../features/resume-document/fieldCatalog";
import { useDocumentChipMenu } from "./documentChipMenuContext";
import { useDocumentDrag } from "./documentDragContext";
import { useBlockSelectStart } from "./useBlockSelectStart";
import { useChipExpandGesture } from "./useChipExpandGesture";
import CroppedPhotoThumb from "./CroppedPhotoThumb";
import type { PhotoCropParams } from "../../features/resume-proview/photoCrop";

type ChipDragEvent = DragEvent<HTMLElement>;
type ChipKeyEvent = KeyboardEvent<HTMLElement>;

interface Props {
  document: ResumeDocument;
  path: string;
  item: HeaderItem;
  /** 已解析的字段显示名（item.label / 目录 / 语言包兜底都在父级算好）。 */
  label: string;
  selected: boolean;
  readOnly?: boolean;
  onSelect: (path: string | null) => void;
  onChange: (next: ResumeDocument) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
  /** 拖到本 chip 上：父级按"插到这一格之前"换算落点。 */
  onDropItem?: (draggedPath: string) => void;
  /**
   * 任务 6：照片字段的裁剪参数（`format_config.photo_crop`）。
   *
   * 非破坏裁剪后 `item.value` 永远是**原图**，缩略图必须按这个参数取景，否则用户裁完
   * 看到 chip 里还是整张原图，会以为没生效。非照片字段传 `null` 即可。
   */
  photoCrop?: PhotoCropParams | null;
  /** 展开态渲染的字段编辑器。 */
  children?: ReactNode;
}

export default function HeaderChip({
  document,
  path,
  item,
  label,
  selected,
  readOnly = false,
  onSelect,
  onChange,
  onNotice,
  onDropItem,
  photoCrop = null,
  children,
}: Props) {
  const { t } = useI18n();
  const drag = useDocumentDrag();
  // 同 ItemChip：页眉 chip 里也不许起选区，否则拖动会被判成"拖动选中文字"。
  const chipRef = useBlockSelectStart<HTMLDivElement>();
  const chipMenuHost = useDocumentChipMenu();
  // #10：双击的第二下 click 自己就是展开/收起（不再依赖 dblclick 是否送达），
  // 原因见 useChipExpandGesture 的文件注释。
  const { expanded, consumePairSecondClick, handleDoubleClick, toggleFromKeyboard, setExpanded } =
    useChipExpandGesture(path, onSelect);
  const [grabbed, setGrabbed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const selectedAtPointerDownRef = useRef<boolean | null>(null);
  const pointerFocusRef = useRef(false);
  const snapshotRef = useRef<ResumeDocument | null>(null);
  const hidden = item.placement === "hidden";
  const canMove = !readOnly;
  // #25：只要值是 data URL 就画缩略图（页眉照片以外的自定义字段也不该铺 base64）。
  const photo = isPhotoDataUrl(item.value) ? item.value : "";
  // #11b：枚举格式的页眉字段同样走目录 / 语言包（与正文 chip 同一 resolver），
  // 不裸显 `male` / `full_time` 这类原始码；目录没有该枚举时回落原值。
  const valueText = photo
    ? ""
    : item.format === "enum"
      ? enumLabelOf(null, "basic_info", item.key, item.value, t)
      : item.value;
  // 照片 chip 的可读名只有字段名（不把几百 KB 的 data URL 读出来），图另有 alt。
  const accessibleName = photo ? label : `${label}${valueText ? `\uFF1A${valueText}` : ""}`;

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
    if (!readOnly && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      event.preventDefault();
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
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        toggleFromKeyboard();
        return;
      }
      // A3：Esc 分层——先收字段编辑器（焦点留在 chip 上），再收选中；都不在时放行给
      // antd Modal 关制作台。stopPropagation 见 ItemChip 同名分支的说明。
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
    const items = document.header.items;
    const current = items.find((candidate) => candidate.id === item.id);
    const slot = current ? headerSlotOf(items, current) : null;
    if (!current || !slot) return;
    const target = keyboardHeaderMoveTarget(items, slot, direction);
    if (!target) {
      onNotice(t("document.drag.boundary"), "warning");
      return;
    }
    const next = moveHeaderItem(document, current.id, target);
    if (next === document) {
      onNotice(t("document.drag.invalid"), "warning");
      return;
    }
    onChange(next);
    setAnnouncement(t("document.drag.grabbed"));
  };

  const handleDragStart = (event: ChipDragEvent) => {
    if (!canMove) {
      event.preventDefault();
      onNotice(t("document.drag.unsupported"), "warning");
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", path);
    drag.setDraggedPath(path);
  };

  const handleDragOver = (event: ChipDragEvent) => {
    if (readOnly || !draggedHeaderPath(drag.draggedPath, path)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (event: ChipDragEvent) => {
    const dragged = draggedHeaderPath(drag.draggedPath, path);
    if (!dragged) return;
    event.preventDefault();
    onDropItem?.(dragged);
    drag.setDraggedPath(null);
  };

  return (
    <>
      <div
        ref={chipRef}
        className={[
          "document-chip",
          "document-chip-header",
          photo ? "is-photo" : "",
          selected ? "is-selected" : "",
          grabbed ? "is-grabbed" : "",
          hidden ? "is-hidden" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-document-path={path}
        data-item-kind={item.kind}
        role="group"
        aria-label={accessibleName}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
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
          {photo ? (
            <CroppedPhotoThumb
              photo={photo}
              crop={photoCrop}
              className="document-chip-photo"
              alt={t("document.photo.thumbnail")}
            />
          ) : (
            <span
              className={`document-chip-value${valueText ? "" : " document-chip-placeholder"}`}
              title={valueText || undefined}
            >
              {valueText || t("document.item.untitled")}
            </span>
          )}
        </button>
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

/** 只接受"页眉字段 → 另一个页眉字段"的拖放（正文 chip 拖进页眉不是合法落点）。 */
function draggedHeaderPath(draggedPath: string | null, ownPath: string): string | null {
  if (!draggedPath || draggedPath === ownPath) return null;
  return draggedPath.startsWith("header.") ? draggedPath : null;
}
