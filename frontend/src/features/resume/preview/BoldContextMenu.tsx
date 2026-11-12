// SPDX-License-Identifier: Apache-2.0
/**
 * 纸面上「选中一小段文字 → 右键」的菜单：加粗 / 取消加粗、分隔线、编辑这一栏。
 *
 * ## 为什么自己画一份，而不是放行原生菜单
 *
 * 纸面是后端渲染的 HTML，浏览器原生右键菜单里没有任何"改内容"的入口；而用户此刻的意图
 * 极其明确——把这段字加粗。原生菜单里能做的（复制、检查元素）对简历编辑没有价值。
 *
 * ## 只声明"有哪些项"，渲染交给全局唯一宿主（问题 25）
 *
 * 原来这个文件自己渲染 `<ContextMenuSurface>`，和 `ai-polish/SelectionContextMenu`
 * 各自一份、再加宿主一份，同一次右键会叠出两张卡片。现在这里**不渲染任何浮层**，
 * 只把 items 交给 `openContextMenu`；浮层由 `AppShell` 里的 `ContextMenuHost` 唯一渲染，
 * 后开的那份直接替换前一份。
 *
 * `keepSelection` 必须开：`mousedown.preventDefault()` 挡住"按下鼠标 → 选区消失"，
 * 否则点下去时"要加粗的那一段"已经没了。
 */
import { useEffect, useMemo } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { openContextMenu } from "../../context-menu/contextMenuStore";
import type { RowMenuItem } from "../../../components/common/rowActionMenu";

/** 调用方（`ResumePreview`）通过这一条 import 同时拿到菜单与契约类型，省一行行数预算。 */
export type { RichTextEditAdapter } from "./richText";

export interface BoldContextMenuProps {
  /** 指针位置（父页面视口坐标），浮层会据此贴边落位并夹进视口。 */
  x: number;
  y: number;
  /** 当前选区是否整段已加粗：决定第一项显示「加粗」还是「取消加粗」。 */
  isBold: boolean;
  /** 切换加粗（写入新的源串，并由宿主把内容标脏）。 */
  onToggle: () => void;
  /** 等价于左键点击那一栏：打开中栏/弹窗里对应的输入框。 */
  onPick: () => void;
  /** 浮层被关掉（Esc / 点外部 / 点某一项）时回调，父级据此卸载本组件。 */
  onClose: () => void;
}

export default function BoldContextMenu({
  x,
  y,
  isBold,
  onToggle,
  onPick,
  onClose,
}: BoldContextMenuProps) {
  const locale = useLocale();
  const items = useMemo<RowMenuItem[]>(
    () => [
      {
        key: "bold",
        label: isBold ? t("rich.menu.unbold") : t("rich.menu.bold"),
        onClick: onToggle,
      },
      { key: "divider", type: "divider" },
      { key: "edit", label: t("rich.menu.edit"), onClick: onPick },
    ],
    // `locale` 只为在切语言后重建文案；`t()` 本身是模块级的。
    [isBold, onToggle, onPick, locale],
  );

  useEffect(() => {
    openContextMenu({
      x,
      y,
      items,
      ariaLabel: t("rich.menu.label"),
      keepSelection: true,
      onClose,
    });
  }, [x, y, items, onClose]);

  return null;
}
