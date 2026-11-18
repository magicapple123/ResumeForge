// SPDX-License-Identifier: Apache-2.0
/**
 * Chip context menu of the v2 document editor: one delegated menu per editor plus the
 * entry-level style popover it can open. Split out of `./DocumentEditor.tsx` to keep
 * both files under the line budget; pure move, no behaviour change.
 */
import type { MenuProps } from "antd";
import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { hasActiveTextSelection } from "../../context-menu/selectionGuard";
import { locatePath } from "../document";
import { isPhotoDataUrl } from "../document/headerOrder";
import { removeItem, toggleItemHidden } from "../document/mutations";
import { headerFieldIsPhoto } from "../layout/v2Selection";
import type { ChipMenuRequest } from "./documentChipMenuContext";
import type { ChipStylePopoverState } from "./ChipStylePopover";
import type { PhotoFramePopoverState } from "./PhotoFramePopover";
import { useChipMenuDismiss } from "./useChipMenuDismiss";

interface Options {
  document: ResumeDocument;
  readOnly: boolean;
  onChange: (next: ResumeDocument) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
  onLayoutChange?: (next: ResumeLayout) => void;
  onCollectAsset?: (path: string) => void;
  /** I-04：任何浮层（右键菜单 / 排版浮层 / 照片框浮层）要开时先收字段编辑器。 */
  onOverlayOpen?: () => void;
}

export function useEditorChipMenu({
  document,
  readOnly,
  onChange,
  onNotice,
  onLayoutChange,
  onCollectAsset,
  onOverlayOpen,
}: Options) {
  /**
   * 字段右键菜单的当前目标（R-30 第 5 项）：整个编辑器只有这一份菜单，
   * 不再每个 chip 各包一个 Dropdown。null = 关着。
   */
  const [chipMenu, setChipMenu] = useState<ChipMenuRequest | null>(null);
  // #7：右键「调整排版」浮层（layout 通道存在时才有这项）。
  const [stylePopover, setStylePopover] = useState<ChipStylePopoverState | null>(null);
  // I-01：照片字段的「照片框…」浮层（与排版浮层互斥，同一时刻只会有一个）。
  const [photoFramePopover, setPhotoFramePopover] = useState<PhotoFramePopoverState | null>(null);

  /** chip 请求开菜单（键盘 Shift+F10 / 菜单键走这条）；只读时不弹。 */
  const requestChipMenu = useCallback(
    (request: ChipMenuRequest) => {
      if (readOnly) return;
      // I-04 第 1 条边：菜单一开，正展开的字段编辑器必须收起（两者锚点在同一块像素上）。
      onOverlayOpen?.();
      setChipMenu(request);
    },
    [onOverlayOpen, readOnly],
  );
  /**
   * #7：条目卡右键菜单的「排版整条…」——范围锁定为**整条**（`objects[<entryId>]`），
   * 走的还是同一个排版浮层；没有 layout 通道（宿主没给 onLayoutChange）时不接。
   */
  const requestEntryStyle = useCallback(
    (request: ChipMenuRequest) => {
      if (readOnly || !onLayoutChange) return;
      onOverlayOpen?.();
      setPhotoFramePopover(null);
      setStylePopover({ path: request.path, x: request.x, y: request.y });
    },
    [onLayoutChange, onOverlayOpen, readOnly],
  );
  const chipMenuHost = useMemo(
    () => ({ request: requestChipMenu, requestStyle: requestEntryStyle }),
    [requestChipMenu, requestEntryStyle],
  );

  /** 右键事件委托：命中最近的、带 `data-document-path` 的字段 chip 才接管。 */
  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const node = (event.target as HTMLElement | null)?.closest?.("[data-document-path]");
    const path = node?.getAttribute("data-document-path");
    if (!path) return;
    /**
     * I-04 第 3 条边：展开中的字段编辑器内部**放行原生菜单**。
     *
     * 编辑器里的 chip 也带 `data-document-path`，`closest` 分不出"chip"与"编辑器"。
     * `InlineMarkContextMenu` 空选区时本来就"原样放行"，但它只 `return` 不拦冒泡，
     * 事件到 `.document-editor` 仍会被这里 `preventDefault` —— 副作用是编辑器里
     * **右键无法粘贴**，且那张菜单必定压在编辑器上。选择器与 `DocumentEditor` 的
     * Esc 收口共用同一串，不写第三份。
     */
    if (node?.closest("[data-document-item-editor], .document-header-editor")) return;
    /**
     * 选中了文字就让位给选区菜单（AI 润色那一层）：两套监听都处理同一个 `contextmenu`
     * 时，屏幕上会叠出两张卡片（2026-11-04 用户实测）。字段动作（收藏/排版/隐藏/移除）
     * 是"没选字时对整块的操作"，选字后用户要的是剪切/复制/润色。
     */
    if (hasActiveTextSelection()) return;
    event.preventDefault();
    // I-04 第 1 条边：菜单与展开的字段编辑器同屏 = 两张卡互相遮挡。
    onOverlayOpen?.();
    setPhotoFramePopover(null);
    setChipMenu({ path, x: event.clientX, y: event.clientY });
  };

  const closeChipMenu = useCallback(() => setChipMenu(null), []);
  const closeStylePopover = useCallback(() => setStylePopover(null), []);
  const closePhotoFramePopover = useCallback(() => setPhotoFramePopover(null), []);
  const chipMenuTarget = chipMenu ? locatePath(document, chipMenu.path) : null;
  // #6：滚动/resize/失焦也关菜单（antd 只覆盖点外面与 Esc；浮层锚点滚走会错位）。
  useChipMenuDismiss(chipMenu !== null, closeChipMenu, { closeOnOutsidePointer: true });
  const chipMenuItem =
    chipMenuTarget && (chipMenuTarget.kind === "item" || chipMenuTarget.kind === "header")
      ? chipMenuTarget.item
      : null;
  // 页眉字段与板块内字段的 `placement` 枚举不同（HeaderPlacement vs Placement），
  // 但"隐藏"在两边的取值都是 `"hidden"`；TextItem 没有 placement，只带一个 hidden 布尔。
  const chipMenuHidden = chipMenuItem
    ? chipMenuItem.kind === "text"
      ? chipMenuItem.hidden
      : chipMenuItem.placement === "hidden"
    : false;
  /**
   * I-01：这个右键目标是不是照片（`placement=photo` 的页眉字段，或值是图片 data URL 的
   * 字段）。判据与 `HeaderChip.tsx` / `headerFieldFromPath` 同一套——照片没有字段级排版
   * 落点，菜单项换成「照片框…」。
   */
  const chipMenuIsPhoto = (() => {
    if (!chipMenuTarget) return false;
    if (chipMenuTarget.kind === "header") return headerFieldIsPhoto(chipMenuTarget.item);
    if (chipMenuTarget.kind === "item") {
      const item = chipMenuTarget.item;
      return item.kind === "field" && isPhotoDataUrl(item.value);
    }
    return false;
  })();
  const canStyle = onLayoutChange !== undefined;
  const chipMenuItems: MenuProps["items"] = [
    // #19 双入口之一：宿主接了收藏回调时，正文 item（含要点文本块）多一项「收藏为资产」。
    ...(onCollectAsset && chipMenuTarget?.kind === "item"
      ? [
          { key: "collect", label: t("assets.action.collect") },
          { type: "divider" as const, key: "collect-divider" },
        ]
      : []),
    // I-01：照片字段收掉「调整排版」——那一层对照片一条规则都命中不了（纸面是
    // `<img class="profile-photo">`，不带 `data-resume-path`），改开「照片框…」。
    ...(canStyle && chipMenuIsPhoto
      ? [
          { key: "photoFrame", label: t("resume.photo.frame.menu") },
          { type: "divider" as const, key: "photoFrame-divider" },
        ]
      : []),
    // #7 的「调整排版」对正文 item 与页眉字段都有语义（QW-6 起页眉字段也能逐字段调
    // 字段名/字段值）；条目/板块路径没有字段级落点，不出现这一项。
    ...(canStyle &&
    !chipMenuIsPhoto &&
    (chipMenuTarget?.kind === "item" || chipMenuTarget?.kind === "header")
      ? [
          { key: "style", label: t("document.editor.styleEntry") },
          { type: "divider" as const, key: "style-divider" },
        ]
      : []),
    { key: "toggle", label: chipMenuHidden ? t("document.item.show") : t("document.item.hide") },
    { key: "remove", label: t("document.item.remove"), danger: true },
  ];
  const onChipMenuClick: MenuProps["onClick"] = ({ key }) => {
    const path = chipMenu?.path;
    const anchor = chipMenu;
    setChipMenu(null);
    if (!path) return;
    if (key === "collect") {
      onCollectAsset?.(path);
      return;
    }
    if (key === "style" && anchor) {
      setPhotoFramePopover(null);
      setStylePopover({ path, x: anchor.x, y: anchor.y });
      return;
    }
    if (key === "photoFrame" && anchor) {
      setStylePopover(null);
      setPhotoFramePopover({ x: anchor.x, y: anchor.y });
      return;
    }
    if (key === "toggle") {
      onChange(toggleItemHidden(document, path));
      onNotice(chipMenuHidden ? t("document.toast.shown") : t("document.toast.hidden"), "info");
      return;
    }
    if (key === "remove") {
      onChange(removeItem(document, path));
      onNotice(t("document.toast.fieldRemoved"), "info");
    }
  };

  /** A3：Esc 的层级——菜单/浮层 → 编辑器 → 选中 → 最后才放行给 antd Modal 关制作台。 */
  const handleEscCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    if (chipMenu) {
      event.preventDefault();
      event.stopPropagation();
      closeChipMenu();
      return;
    }
    if (stylePopover) {
      event.preventDefault();
      event.stopPropagation();
      setStylePopover(null);
      return;
    }
    if (photoFramePopover) {
      event.preventDefault();
      event.stopPropagation();
      setPhotoFramePopover(null);
    }
  };

  return {
    chipMenu,
    stylePopover,
    photoFramePopover,
    closeChipMenu,
    closeStylePopover,
    closePhotoFramePopover,
    chipMenuHost,
    chipMenuItems,
    onChipMenuClick,
    handleContextMenu,
    handleEscCapture,
  };
}
