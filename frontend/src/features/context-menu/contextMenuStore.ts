// SPDX-License-Identifier: Apache-2.0
/**
 * 全局唯一右键菜单的**模块级 store**（问题 25 收口）。
 *
 * ## 为什么不是 React context
 *
 * 上一版把菜单状态放在 `<ContextMenuProvider>` 的 context 里，`AppShell` 又写成
 * `<ContextMenuProvider />`（自闭合、没有 children）——provider 只渲染浮层、没有向下
 * 供值，`useContextMenu()` 拿到 `null` 就抛错，整页被 ErrorBoundary 接住变白屏。
 *
 * 菜单宿主本来就只有一个、全局坐标也没有"分包"概念，context 在这里只带来了
 * "谁包了谁"的隐式依赖。改成模块级单例后：
 * 1. `useContextMenu()` 永远可用，**没有宿主也不抛错**（最坏情况是点了没反应，而不是白屏）；
 * 2. 同一次右键即使被两个 document 监听各处理一次，后开的直接替换前一份，天然只有一层。
 *
 * 快照就是"当前那份菜单或 null"，引用稳定，`useSyncExternalStore` 不会空转。
 */
import { useSyncExternalStore } from "react";
import type { RowMenuItem } from "../../components/common/rowActionMenu";
import type { ContextMenuSource } from "./ContextMenuSurface";

export interface ContextMenuOpenOptions {
  /** 指针位置（视口坐标）。键盘打开时由触发元素的位置兜底。 */
  x: number;
  y: number;
  items: RowMenuItem[];
  /** 菜单的无障碍名称（`t()` 结果）。 */
  ariaLabel: string;
  source?: ContextMenuSource;
  /**
   * 点菜单项时拦住 `mousedown` 默认行为，保住文本选区。
   * 替换菜单时保留**最后一次**的值：AI 润色 / 加粗都必须留住选区。
   */
  keepSelection?: boolean;
  /**
   * 浮层关闭后的回调（只认最后打开的那一份）。
   *
   * 用途是让"菜单状态住在调用方"的组件跟着收起：`BoldContextMenu` /
   * `SelectionContextMenu` 都不再自己渲染浮层，父级的 `menu` 状态靠这里归零，
   * 否则关掉之后父级仍以为菜单开着，下一次右键也不会重新打开。
   */
  onClose?: () => void;
}

export interface ContextMenuApi {
  open: (options: ContextMenuOpenOptions) => void;
  close: () => void;
}

let current: ContextMenuOpenOptions | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 打开菜单；已有菜单时**直接替换**（语义与系统右键一致，不会叠出第二张）。 */
export function openContextMenu(options: ContextMenuOpenOptions): void {
  current = options;
  emit();
}

/** 关闭菜单；没有打开时不做事，也不会误触别人的 `onClose`。 */
export function closeContextMenu(): void {
  const closing = current;
  if (!closing) return;
  current = null;
  emit();
  closing.onClose?.();
}

/** 当前菜单（`useSyncExternalStore` 的快照，引用天然稳定）。 */
export function getContextMenuSnapshot(): ContextMenuOpenOptions | null {
  return current;
}

/** 订阅开关变化；返回取消订阅函数。 */
export function subscribeContextMenu(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 订阅入口：宿主组件用它拿当前菜单并重渲染。 */
export function useContextMenuState(): ContextMenuOpenOptions | null {
  return useSyncExternalStore(subscribeContextMenu, getContextMenuSnapshot, getContextMenuSnapshot);
}

/** 测试用：单例 store 的用例之间必须复位（含订阅者）。 */
export function resetContextMenuForTests(): void {
  current = null;
  listeners.clear();
}
