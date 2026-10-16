/**
 * 列表行操作的菜单项定义与构造。
 *
 * 单独成文件而不是和 `RowActions` 放一起：那个文件只导出组件，才能让 React
 * Fast Refresh 在开发时正常工作（同时导出 hook 会让热更新退化成整页刷新）。
 */

import { App } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode } from "react";
import { layer } from "../../theme/tokens";

export interface RowActionItem {
  key: string;
  label: string;
  /** 判别字段：普通操作项永不携带 divider，仅为了让 RowMenuItem 成为可判别联合。 */
  type?: undefined;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  /** 有值时点击后弹出二次确认，确认文案即此字符串。 */
  confirm?: string;
}

/** 菜单分组用的分隔线占位（不渲染成可点项）。 */
export interface RowActionDivider {
  key: string;
  type: "divider";
}

/** 「查看/编辑」与「批量/删除」这类分组之间用分隔线隔开（备选岗位右键菜单等）。 */
export type RowMenuItem = RowActionItem | RowActionDivider;

interface BuildOptions {
  onDone?: () => void;
}

/** 把 `RowMenuItem` 列表转成 antd 菜单项（含二次确认；divider 原样透传）。 */
export function useRowActionMenu() {
  const { modal } = App.useApp();
  return (items: RowMenuItem[], options: BuildOptions = {}): MenuProps["items"] =>
    items.map((item) => {
      if (item.type === "divider") {
        return { key: item.key, type: "divider" as const };
      }
      // 解构成 const：嵌套 onClick 闭包里拿不到参数的收窄类型，解构后没问题。
      const { key, danger, disabled, icon, label, confirm, onClick } = item;
      return {
        key,
        danger,
        disabled,
        icon,
        label,
        onClick: () => {
          if (confirm) {
            modal.confirm({
              title: confirm,
              // confirm 的 holder 挂在根 <AntdApp>，不经过卡片内的局部 ConfigProvider，
              // 默认 z（3100）落在投投卡（3400/3500）与简历编辑器 Modal（3110）之后，
              // 看起来就是"点了删除没反应"。统一抬到卡片内弹层基准 3550。
              zIndex: layer.cardPopup,
              okButtonProps: { danger },
              onOk: () => {
                onClick?.();
                options.onDone?.();
              },
            });
            return;
          }
          onClick?.();
          options.onDone?.();
        },
      };
    });
}
