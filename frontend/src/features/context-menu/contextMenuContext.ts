// SPDX-License-Identifier: Apache-2.0
/**
 * 全局单实例右键菜单的**取用入口**。
 *
 * 为什么还留着这个文件：调用方（`QueueTable`、两个菜单组件）只需要
 * `const { open, close } = useContextMenu()`，不必知道状态住在哪。状态本体在
 * `contextMenuStore`（模块级单例），这里只是一个**永远可用**的稳定门面：
 *
 * - 没有宿主、没有 provider、甚至不在 React 树里，`open()` 都不抛错——
 *   上一版在这里 `throw new Error("context-menu.provider-missing")`，`AppShell` 的
 *   `<ContextMenuProvider />` 又恰好没供值，结果整个 `/apply` 白屏。
 * - 返回的对象是模块级常量，引用稳定，可以安全放进 effect 依赖。
 *
 * 单独成文件（不放 `ContextMenuHost.tsx`）：那个文件必须只导出组件，
 * `react-refresh/only-export-components` 才不会退化。
 */
import { closeContextMenu, openContextMenu } from "./contextMenuStore";
import type { ContextMenuApi } from "./contextMenuStore";

const API: ContextMenuApi = { open: openContextMenu, close: closeContextMenu };

/** 取全局右键菜单控制器；**永不抛错**，宿主缺失时退化为"什么都不发生"。 */
export function useContextMenu(): ContextMenuApi {
  return API;
}
