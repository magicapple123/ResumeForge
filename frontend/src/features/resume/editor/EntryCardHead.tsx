// SPDX-License-Identifier: Apache-2.0
/**
 * 条目头：序号 / 隐藏徽标 /「⋯」菜单。
 *
 * ## 为什么单独成文件
 *
 * 六种条目动作（排版整条 / 上移 / 下移 / 复制 / 隐藏 / 移除）在 R-05、#7 之后收进了
 * **同一个菜单**，右键与「⋯」按钮指向它；这段菜单定义 + 图标按钮组 + 键盘等价物
 * （Shift+F10）加起来一百多行，留在 `EntryCard` 里会把那个文件顶到 500 行预算边缘。
 *
 * ## 交互契约（不要删）
 *
 * - 菜单由 `open` / `onOpenChange` **受控**：右键（`trigger: contextMenu`）、`⋯` 按钮、
 *   Shift+F10 / 菜单键三条入口都只是把 `open` 置 true；
 * - `⋯` 按钮要 `stopPropagation`：它挂在右键菜单的触发区里，不拦的话点一下会同时打开菜单；
 * - 可访问名仍是「更多条目操作」（`aria-label`），测试与读屏都靠它，图标本身 `aria-hidden`。
 * - #7：菜单第一项「排版整条…」把**整条**交给编辑器宿主的排版浮层（走
 *   `documentChipMenuContext.requestStyle`），范围固定 `objects[<entryId>]`。
 *
 * ## 这里**不再**放「标题布局」三个图标（问题 6）
 *
 * 那三个按钮只改「标题与元信息」这一域的排法（`EntryLayout.head`），却和卡片级动作
 * （`#1` / 徽标 / `⋯`）同级摆着，位置暗示了错误的作用域。现在它们在
 * `EntryHeadLayoutSwitch` 里、由 `EntryCard` 渲染到域标题行。
 */
import { EllipsisOutlined } from "@ant-design/icons";
import { Button, Dropdown, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useRef } from "react";
import { useI18n } from "../../../i18n/i18nContext";
import { useDropdownContextMenu } from "../../context-menu/useDropdownContextMenu";
import type { ResumeDocument, ResumeEntry, ResumeSection } from "../../../types/resumeDocument";
import {
  copyEntry,
  entryPath as buildEntryPath,
  moveEntry,
  removeEntry,
  toggleEntryHidden,
} from "../document";
import { useDocumentChipMenu } from "./documentChipMenuContext";
import { buildEntryMenuItems, type EntryMenuKey, type EntryMenuLabels } from "./entryMenuItems";

interface Props {
  document: ResumeDocument;
  section: ResumeSection;
  entry: ResumeEntry;
  entryIndex: number;
  entryPath: string;
  readOnly?: boolean;
  onChange: (next: ResumeDocument) => void;
  onSelectPath: (path: string | null) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function EntryCardHead({
  document,
  section,
  entry,
  entryIndex,
  entryPath,
  readOnly = false,
  onChange,
  onSelectPath,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const { requestStyle } = useDocumentChipMenu();
  /** 受控打开 + 键盘等价物（问题 25）：键盘打开回落到元素锚点，指针打开贴鼠标。 */
  const menuState = useDropdownContextMenu();
  const headRef = useRef<HTMLDivElement>(null);
  /**
   * 「排版整条…」要一个浮层锚点。#7 的两种入口各有一个落点：
   * - 右键：`onContextMenuCapture` 在捕获阶段先记下 `clientX/clientY`（antd 的
   *   `trigger: contextMenu` 监听在冒泡阶段，读到的一定是这次落点）；
   * - `⋯` 按钮 / Shift+F10：没有鼠标落点，用条目头元素右下角兜底（与菜单自身
   *   `bottomRight` 的弹出方向一致）。
   */
  const anchorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const rememberPointer = (event: ReactMouseEvent<HTMLElement>) => {
    anchorRef.current = { x: event.clientX, y: event.clientY };
  };
  const rememberHeadCorner = () => {
    const rect = headRef.current?.getBoundingClientRect();
    if (rect) anchorRef.current = { x: rect.right, y: rect.bottom };
  };

  /** 六种条目动作共用一份菜单：`⋯` 按钮与右键菜单指向同一个 `entryMenuItems`。 */
  const entryActions: Record<EntryMenuKey, () => void> = {
    style: () => {
      const anchor = anchorRef.current;
      requestStyle?.({ path: entryPath, x: anchor.x, y: anchor.y });
    },
    moveUp: () => onChange(moveEntry(document, entryPath, "up")),
    moveDown: () => onChange(moveEntry(document, entryPath, "down")),
    copy: () => {
      const copied = copyEntry(document, entryPath);
      onChange(copied.document);
      if (copied.entryId) onSelectPath(buildEntryPath(section.key, copied.entryId));
      onNotice(t("document.toast.entryCopied"), "info");
    },
    toggle: () => {
      onChange(toggleEntryHidden(document, entryPath));
      onNotice(entry.hidden ? t("document.toast.shown") : t("document.toast.hidden"), "info");
    },
    remove: () => {
      onChange(removeEntry(document, entryPath));
      onNotice(t("document.toast.entryRemoved"), "info");
    },
  };

  const entryMenuLabels: EntryMenuLabels = {
    style: t("document.entry.styleWhole"),
    moveUp: t("document.entry.moveUp"),
    moveDown: t("document.entry.moveDown"),
    copy: t("document.entry.copy"),
    toggle: entry.hidden ? t("document.entry.show") : t("document.entry.hide"),
    remove: t("document.entry.remove"),
  };

  const entryMenuItems = buildEntryMenuItems(entryMenuLabels, {
    canMoveUp: entryIndex > 0,
    canMoveDown: entryIndex < section.entries.length - 1,
  });

  const runAction = (key: string) => {
    entryActions[key as EntryMenuKey]?.();
  };

  const menu: MenuProps = {
    items: entryMenuItems,
    onClick: ({ key }) => {
      menuState.close();
      runAction(key);
    },
  };

  return (
    <Dropdown {...menuState.dropdownProps} menu={menu} disabled={readOnly}>
      <div
        ref={headRef}
        className="document-entry-head"
        tabIndex={readOnly ? undefined : 0}
        onContextMenuCapture={rememberPointer}
        onKeyDown={(event) => {
          // Shift+F10 / 菜单键是右键菜单的键盘等价物；只在条目头自身聚焦时响应，
          // 不抢内部按钮（`⋯`）的按键。
          if (event.target !== event.currentTarget) return;
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            // 键盘没有鼠标落点：先记下条目头右下角，给「排版整条…」的浮层当锚点。
            rememberHeadCorner();
            menuState.handleKeyDown(event);
          }
        }}
      >
        <span className="document-entry-index">#{entryIndex + 1}</span>
        {entry.hidden ? (
          <span className="document-chip-badge">{t("document.entry.hidden")}</span>
        ) : null}
        {!readOnly ? (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
              items: entryMenuItems,
              onClick: ({ key }) => runAction(key),
            }}
          >
            <Tooltip title={t("document.entry.more")}>
              <Button
                size="small"
                type="text"
                className="document-entry-more"
                aria-label={t("document.entry.more")}
                aria-haspopup="menu"
                icon={<EllipsisOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  // #7：菜单项的浮层锚点用条目头右下角（按钮收起后仍能定位）。
                  rememberHeadCorner();
                }}
              />
            </Tooltip>
          </Dropdown>
        ) : null}
      </div>
    </Dropdown>
  );
}
