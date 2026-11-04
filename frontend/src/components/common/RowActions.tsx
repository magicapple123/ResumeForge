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
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";
import { useRowActionMenu, type RowActionItem, type RowMenuItem } from "./rowActionMenu";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useDropdownContextMenu } from "../../features/context-menu/useDropdownContextMenu";

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

/** 宿主元素（`<tr>` / `<li>` / `<div>`…）自带的键盘槽位：能直接挂 `tabIndex`，不用包一层。 */
function isHostElement(
  node: ReactNode,
): node is React.ReactElement<{ tabIndex?: number; onKeyDown?: unknown }> {
  return isValidElement(node) && typeof node.type === "string";
}

/**
 * 整行的右键菜单：与「更多」下拉共用同一份菜单项。
 *
 * 键盘可达性（问题 25 修）：右键没有键盘等价物，聚焦行内任意元素时按菜单键或
 * Shift+F10（Windows 标准的"键盘右键"）打开同一份菜单。原来的实现用 `cloneElement`
 * 把 `onKeyDown` 注进宿主 props，`ListyItem` 这类不转发该 prop 的组件会静默失效——
 * 现在默认**包一层 `tabIndex=0` 的容器**自己接管按键；宿主元素（`<tr>` / `<li>` /
 * `<div>`）没有可插槽的外壳时直接注到它自己身上，避免多出一层破坏表格/列表结构。
 *
 * 位置语义（问题 25 起）：指针打开贴鼠标、键盘打开回落到该行附近——由
 * `useDropdownContextMenu` 在受控打开时切 trigger 实现（antd 对 contextMenu 恒开
 * alignPoint，键盘打开没有鼠标坐标）。
 */
export function RowContextMenu({ items, children, disabled = false }: RowContextMenuProps) {
  const buildMenu = useRowActionMenu();
  const menu = useDropdownContextMenu();
  if (disabled || items.length === 0) return <>{children}</>;

  const trigger = isHostElement(children) ? (
    cloneElement(children, {
      tabIndex: children.props.tabIndex ?? 0,
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        // 不覆盖宿主（antd 行）自带的 onKeyDown，只做追加。
        const original = children.props.onKeyDown as
          ((e: ReactKeyboardEvent<HTMLElement>) => void) | undefined;
        original?.(event);
        menu.handleKeyDown(event);
      },
    })
  ) : (
    <div className="rf-row-ctx-trigger" tabIndex={0} onKeyDown={menu.handleKeyDown}>
      {children}
    </div>
  );

  return (
    <Dropdown
      {...menu.dropdownProps}
      menu={{ items: buildMenu(items), onClick: menu.close }}
      placement="bottomLeft"
    >
      {trigger}
    </Dropdown>
  );
}
