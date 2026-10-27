// SPDX-License-Identifier: Apache-2.0
/**
 * 列表行操作的菜单项定义与构造。
 *
 * 单独成文件而不是和 `RowActions` 放一起：那个文件只导出组件，才能让 React
 * Fast Refresh 在开发时正常工作（同时导出 hook 会让热更新退化成整页刷新）。
 *
 * 删除后果的文案**不在本文件**：软删除（进回收站、可恢复）与硬删除（不进回收站、无法恢复）
 * 分别由语言包的 `common.note.trashRecovery` / `common.note.hardDelete` 提供，调用点在
 * 渲染 / 事件期用 `t()` 取；本文件不导出任何中文常量，否则英文界面会夹中文。
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
  /** 有值时点击后弹出二次确认，确认文案即此标题（动作 + 对象，≤12 字，带问号）。 */
  confirm?: string;
  /**
   * 软删类删除：**不弹确认**，由调用方用 `useDeleteUndo` 在 Toast 里给 5 秒撤销。
   *
   * 与 `confirm` 互斥（`undo` 优先）。判据只有一条：这件事能不能被 `restoreTrashItems`
   * 撤销。不能撤销的（彻底删除 / 清空 / 结束会话）继续用 `confirm`。
   */
  undo?: boolean;
  /**
   * 二次确认的**正文**：后果与可逆性，如 `会移入回收站，之后可以在「回收站」里恢复。`。
   *
   * 只传 `confirm` 不传它，弹窗就只有标题没有后果段——§4.4 的三段式（动作 + 对象 + 后果）
   * 会缺一段。软删除类一律传 `t("common.note.trashRecovery")`，硬删除类传
   * `t("common.note.hardDelete")`，不要在调用点各写一份。
   */
  confirmBody?: string;
  /**
   * 二次确认的**确认按钮**文案：写具体动作与对象（如「删除这份简历」）。
   * 缺省不传时保持 antd 默认「确定」——存量列表不动，只有被明确修到的调用点才给。
   */
  confirmOkText?: string;
  /** 二次确认的**取消按钮**文案（如「先不删」）；缺省保持 antd 默认。 */
  confirmCancelText?: string;
  /**
   * 子菜单（如「复制」下面的一组字段）。
   *
   * 加了它之后行操作可以「一类动作一个入口」：右键菜单本来就窄，把"复制标题 / 复制岗位 /
   * 复制整行"三条平铺进去，会把真正要点的「重命名 / 删除」挤到菜单下半页。
   * 子项只支持普通动作（不嵌套 divider、不再套一层 children）。
   */
  children?: RowActionItem[];
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
  /**
   * 递归构造菜单项：`children` 支持一层子菜单（见 `RowActionItem.children`）。
   * 子项与顶层共用同一套语义（二次确认、danger、disabled），所以两边必须是同一段代码——
   * 复制一份迟早漂成两种行为。
   */
  const toMenuItem = (
    item: RowMenuItem,
    options: BuildOptions,
  ): NonNullable<MenuProps["items"]>[number] => {
    if (item.type === "divider") {
      return { key: item.key, type: "divider" as const };
    }
    // 解构成 const：嵌套 onClick 闭包里拿不到参数的收窄类型，解构后没问题。
    const {
      key,
      danger,
      disabled,
      icon,
      label,
      confirm,
      confirmBody,
      confirmOkText,
      confirmCancelText,
      undo,
      onClick,
      children,
    } = item;
    return {
      key,
      danger,
      disabled,
      icon,
      label,
      ...(children && children.length > 0
        ? { children: children.map((child) => toMenuItem(child, options)) }
        : {}),
      onClick: () => {
        if (undo) {
          // 直接执行：撤销入口由调用方在 Toast 上给（见 useDeleteUndo）。
          onClick?.();
          options.onDone?.();
          return;
        }
        if (confirm) {
          modal.confirm({
            title: confirm,
            // 正文放后果与可逆性（§4.4 三段式的第三段）；没有就不传，别输出空段落。
            content: confirmBody,
            // 按钮写具体动作（AGENTS 禁用「确定/取消」泛动词）；未指定时沿用 antd 默认。
            okText: confirmOkText,
            cancelText: confirmCancelText,
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
  };
  return (items: RowMenuItem[], options: BuildOptions = {}): MenuProps["items"] =>
    items.map((item) => toMenuItem(item, options));
}
