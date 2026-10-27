// SPDX-License-Identifier: Apache-2.0
/**
 * 列表行的操作区：少量主操作直接显示，其余收进「更多」下拉。
 *
 * 之前的列表把 6 个操作（含红色的删除）全部平铺在右侧，视觉上很吵、也容易误点删除。
 * 现在主操作最多两个，其余进菜单；删除一律放在菜单里并二次确认。
 *
 * 同一个 `RowActionItem` 列表同时供两点使用：表格行内的「更多」按钮，以及整行的
 * 右键菜单（`RowContextMenu`），保证两处菜单项完全一致。
 */

import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space } from "antd";
import type { ReactNode } from "react";
import { cloneElement, isValidElement, useState } from "react";
import { useRowActionMenu, type RowActionItem, type RowMenuItem } from "./rowActionMenu";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

// 类型从工具模块转发出去：调用方只认 `RowActions` 这一个入口，不必知道菜单项
// 与 hook 被拆到了另一个文件。
export type { RowActionItem, RowMenuItem } from "./rowActionMenu";

interface RowActionsProps {
  /** 直接显示的主操作（建议不超过 2 个）。 */
  primary?: RowActionItem[];
  /** 收进「更多」下拉的操作，含删除等危险项；可用 divider 分组。 */
  more?: RowMenuItem[];
  disabled?: boolean;
}

export function RowActions({ primary = [], more = [], disabled = false }: RowActionsProps) {
  useLocale();
  const buildMenu = useRowActionMenu();
  const menuItems = buildMenu(more);
  return (
    <Space size={4} className="row-actions">
      {primary.map((item) => (
        <Button
          key={item.key}
          type="link"
          size="small"
          disabled={disabled || item.disabled || undefined}
          danger={item.danger}
          icon={item.icon}
          onClick={item.onClick}
        >
          {item.label}
        </Button>
      ))}
      {more.length > 0 && (
        <Dropdown menu={{ items: menuItems }} trigger={["click"]} placement="bottomRight">
          <Button
            type="text"
            size="small"
            className="row-actions-more"
            aria-label={t("common.rowActions.more")}
            disabled={disabled || undefined}
            icon={<MoreOutlined />}
          />
        </Dropdown>
      )}
    </Space>
  );
}

interface RowContextMenuProps {
  items: RowMenuItem[];
  children: ReactNode;
  disabled?: boolean;
}

/** 整行的右键菜单：与「更多」下拉共用同一份菜单项。
 * 键盘可达性：右键没有键盘等价物，聚焦行内任意元素时按 ContextMenu 键或
 * Shift+F10（Windows 标准的"键盘右键"）可以打开同一份菜单——三点按钮被移除后
 * 这条是键盘用户触达删除/编辑等次级操作的唯一入口。 */
export function RowContextMenu({ items, children, disabled = false }: RowContextMenuProps) {
  const buildMenu = useRowActionMenu();
  const [open, setOpen] = useState(false);
  if (disabled || items.length === 0) return <>{children}</>;
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      setOpen(true);
    }
  };
  const wrapped = isValidElement(children)
    ? cloneElement(children as React.ReactElement<{ onKeyDown?: unknown }>, {
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          // 不覆盖宿主（如 antd 行）自带的 onKeyDown，只做追加。
          const original = (children as React.ReactElement<{ onKeyDown?: unknown }>).props
            .onKeyDown as ((e: React.KeyboardEvent<HTMLElement>) => void) | undefined;
          original?.(event);
          handleKeyDown(event);
        },
      })
    : children;
  return (
    <Dropdown
      menu={{ items: buildMenu(items) }}
      trigger={["contextMenu"]}
      open={open}
      onOpenChange={setOpen}
    >
      {wrapped}
    </Dropdown>
  );
}
