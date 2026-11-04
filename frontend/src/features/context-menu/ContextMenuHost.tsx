// SPDX-License-Identifier: Apache-2.0
/**
 * 全局**唯一**的右键浮层宿主：订阅 `contextMenuStore`，渲染唯一一份
 * `ContextMenuSurface`。`AppShell` 里只放一个（自闭合即可），多放会重新叠加出双层菜单。
 *
 * 它不提供任何 context——调用方通过 `useContextMenu()` 拿 store 门面，没有宿主也照常
 * `open()`（最坏是"点了没反应"，而不是抛错白屏）。可选 `children` 只是为了测试与页面
 * 能把它当普通包裹用，不参与任何状态传递。
 */
import type { ReactNode } from "react";
import { ContextMenuSurface } from "./ContextMenuSurface";
import { closeContextMenu, useContextMenuState } from "./contextMenuStore";

export function ContextMenuHost({ children }: { children?: ReactNode }) {
  const state = useContextMenuState();

  return (
    <>
      {children}
      {state ? (
        <ContextMenuSurface
          x={state.x}
          y={state.y}
          items={state.items}
          ariaLabel={state.ariaLabel}
          source={state.source}
          keepSelection={state.keepSelection}
          onClose={closeContextMenu}
        />
      ) : null}
    </>
  );
}

export default ContextMenuHost;
