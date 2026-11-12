// SPDX-License-Identifier: Apache-2.0
/**
 * 条目行的右键菜单（**一份定义，两处复用**）：画布条目卡（`EntryCardHead`）与
 * 左栏结构树的条目行（`StructureRows`）指向同一套动作，顺序与分隔线必须逐字一致。
 *
 * 规格（#7）：6 项 =
 * 排版整条… ｜ 分隔线 ｜ 上移条目 下移条目 复制条目 ｜ 分隔线 ｜ 隐藏条目 移除条目
 *
 * 文案不在本文件里：调用方传**已经翻译好**的标签（画布用 `t()`，结构树用
 * `t()`），本文件只决定结构与 key。这样新增文案仍然只进语言包——`cjkRatchet`
 * 逐文件比对中文行数，这里若出现界面文案就会直接变红。
 */
import type { MenuProps } from "antd";

/** 菜单项的 key（两处入口共用，点击分发也按它判断）。 */
export const ENTRY_MENU_KEY = {
  style: "style",
  moveUp: "moveUp",
  moveDown: "moveDown",
  copy: "copy",
  toggle: "toggle",
  remove: "remove",
} as const;

export type EntryMenuKey = (typeof ENTRY_MENU_KEY)[keyof typeof ENTRY_MENU_KEY];

/** 一条条目菜单需要的全部文案（由调用方用 `t()` 取）。 */
export interface EntryMenuLabels {
  /** 「排版整条…」 */
  style: string;
  moveUp: string;
  moveDown: string;
  copy: string;
  /** 隐藏 / 显示（按当前 hidden 状态二选一，文案由调用方决定）。 */
  toggle: string;
  remove: string;
}

export interface EntryMenuOptions {
  /** 已经是第一条：上移禁用（缺省不禁用）。 */
  canMoveUp?: boolean;
  /** 已经是最后一条：下移禁用（缺省不禁用）。 */
  canMoveDown?: boolean;
}

/** 构造条目菜单的 items（6 项 + 两条分隔线，顺序即规格顺序）。 */
export function buildEntryMenuItems(
  labels: EntryMenuLabels,
  options: EntryMenuOptions = {},
): MenuProps["items"] {
  return [
    { key: ENTRY_MENU_KEY.style, label: labels.style },
    { type: "divider" as const, key: "style-divider" },
    {
      key: ENTRY_MENU_KEY.moveUp,
      label: labels.moveUp,
      disabled: options.canMoveUp === false,
    },
    {
      key: ENTRY_MENU_KEY.moveDown,
      label: labels.moveDown,
      disabled: options.canMoveDown === false,
    },
    { key: ENTRY_MENU_KEY.copy, label: labels.copy },
    { type: "divider" as const, key: "actions-divider" },
    { key: ENTRY_MENU_KEY.toggle, label: labels.toggle },
    { key: ENTRY_MENU_KEY.remove, label: labels.remove, danger: true },
  ];
}
