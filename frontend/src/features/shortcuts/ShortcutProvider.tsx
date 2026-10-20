// SPDX-License-Identifier: Apache-2.0
/**
 * 快捷键 Provider（R5）。
 *
 * 它是**唯一的监听挂载点**：整个应用只在这里调用一次 `useShortcutKeymap`，
 * 具体动作由各页面/组件用 `useShortcut(id, handler, enabled)` 自己认领。
 *
 * 刻意不提供 React Context：动作注册表是模块级的，这样单独渲染一个页面（测试、
 * 弹窗 Portal、独立挂载的子应用）时不会因为"外面没有 Provider"而失效——少一层
 * 隐式依赖，也就少一类"忘了包 Provider 就静默不工作"的故障。
 */
import type { ReactNode } from "react";
import { useShortcutKeymap } from "./useShortcutKeymap";

interface Props {
  children?: ReactNode;
}

export default function ShortcutProvider({ children }: Props) {
  useShortcutKeymap();
  return <>{children}</>;
}
