// SPDX-License-Identifier: Apache-2.0
/**
 * 纸面上「选中一小段文字 → 右键」的菜单：加粗 / 字号 / 颜色 / 清除行内格式 / 编辑这一栏。
 *
 * ## 为什么自己画一份，而不是放行原生菜单
 *
 * 纸面是后端渲染的 HTML，浏览器原生右键菜单里没有任何"改内容"的入口；而用户此刻的意图
 * 极其明确——把这段字加粗、换个字号或颜色。原生菜单里能做的（复制、检查元素）对简历编辑
 * 没有价值。
 *
 * ## I-13：能力与中栏编辑器对齐（链接除外）
 *
 * 以前这里只有「加粗 / 小一号 / 强调色 / 编辑这一栏」：字号写死 0.9、颜色写死 `#c0392b`，
 * 想换别的只能跳到中栏。现在字号给 5 档 + 清除，颜色给 6 个预设 + 清除，
 * 与编辑器工具条（`InlineMarkButtons`）**同一批常量**（`INLINE_SIZE_STEPS` / `COLOR_PRESETS`）。
 * 链接仍走「编辑这一栏」：纸面没有输入 URL 的落点。
 *
 * ## 写的是 runs，不是标记串
 *
 * 菜单只把回调交出去；真正的改动在 `useClickToEditPreview` 里作用在 `RichValue` 上
 * （`toggleBoldRuns` / `toggleSizeRuns` / `toggleColorRuns` / `clearRunStyles`），
 * 宿主拿到的是结构化值。磁盘上不再出现 `**` / `{@`。
 *
 * ## 只声明"有哪些项"，渲染交给全局唯一宿主（问题 25）
 *
 * 这里**不渲染任何浮层**，只把 items 交给 `openContextMenu`；浮层由 `AppShell` 里的
 * `ContextMenuHost` 唯一渲染。`keepSelection` 必须开：`mousedown.preventDefault()` 挡住
 * "按下鼠标 → 选区消失"，否则点下去时"要改的那一段"已经没了。
 */
import { useEffect, useMemo } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { openContextMenu } from "../../context-menu/contextMenuStore";
import type { RowActionItem, RowMenuItem } from "../../../components/common/rowActionMenu";
import { COLOR_PRESETS, INLINE_SIZE_STEPS } from "../layout/inlineMarks";

/** 调用方（`ResumePreview`）通过这一条 import 同时拿到菜单与契约类型，省一行行数预算。 */
export type { RichTextEditAdapter } from "./richText";

export interface BoldContextMenuProps {
  /** 指针位置（父页面视口坐标），浮层会据此贴边落位并夹进视口。 */
  x: number;
  y: number;
  /** 当前选区是否整段已加粗：决定第一项显示「加粗」还是「取消加粗」。 */
  isBold: boolean;
  /** 切换加粗（写入新的结构化值，并由宿主把内容标脏）。 */
  onToggleBold: () => void;
  /** 字号一档；`null` = 清除字号。 */
  onSize: (size: number | null) => void;
  /** 颜色一档；`null` = 清除颜色。 */
  onColor: (hex: string | null) => void;
  /**
   * 「自定义颜色…」：本菜单会先被关掉（单例宿主契约），由调用方在同一坐标打开拾色弹层。
   * 拾色面板**不能**挂在这张菜单里——点任意项即关的契约会让它瞬间消失。
   */
  onCustomColor: () => void;
  /** 清除行内格式（加粗 / 字号 / 颜色；链接保留）。 */
  onClear: () => void;
  /** 等价于左键点击那一栏：打开中栏/弹窗里对应的输入框。 */
  onPick: () => void;
  /** 浮层被关掉（Esc / 点外部 / 点某一项）时回调，父级据此卸载本组件。 */
  onClose: () => void;
}

export default function BoldContextMenu({
  x,
  y,
  isBold,
  onToggleBold,
  onSize,
  onColor,
  onCustomColor,
  onClear,
  onPick,
  onClose,
}: BoldContextMenuProps) {
  const locale = useLocale();
  const items = useMemo<RowMenuItem[]>(() => {
    const sizeItems: RowActionItem[] = [
      ...INLINE_SIZE_STEPS.map((step) => ({
        key: `size:${step}`,
        // 百分比是数据（与编辑器工具条同一批档位），不是需要翻译的文案。
        label: `${Math.round(step * 100)}%`,
        onClick: () => onSize(step),
      })),
      { key: "size:clear", label: t("typography.inline.sizeClear"), onClick: () => onSize(null) },
    ];
    const colorItems: RowActionItem[] = [
      ...COLOR_PRESETS.map((hex) => ({
        key: `color:${hex}`,
        // 色值本身就是用户要认的东西（与编辑器色板逐字一致），不翻译。
        label: hex,
        onClick: () => onColor(hex),
      })),
      // 自定义取色在**第二个浮层**里完成（`RichColorPickerPopover`）：菜单点完即关，
      // 面板在同一坐标打开。放在清除之前，读起来是"挑颜色 → 不要颜色"。
      { key: "color:custom", label: t("rich.menu.colorCustom"), onClick: onCustomColor },
      {
        key: "color:clear",
        label: t("typography.inline.colorClear"),
        onClick: () => onColor(null),
      },
    ];
    return [
      {
        key: "bold",
        label: isBold ? t("rich.menu.unbold") : t("rich.menu.bold"),
        onClick: onToggleBold,
      },
      { key: "size", label: t("typography.inline.size"), children: sizeItems },
      { key: "color", label: t("typography.inline.color"), children: colorItems },
      { key: "divider:clear", type: "divider" },
      { key: "clear", label: t("typography.inline.clearMarks"), onClick: onClear },
      { key: "divider:edit", type: "divider" },
      { key: "edit", label: t("rich.menu.edit"), onClick: onPick },
    ];
    // `locale` 只为在切语言后重建文案；`t()` 本身是模块级的。
  }, [isBold, onToggleBold, onSize, onColor, onCustomColor, onClear, onPick, locale]);

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
