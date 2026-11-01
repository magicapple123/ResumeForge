// SPDX-License-Identifier: Apache-2.0
/**
 * 字段 chip 的右键菜单：**一个编辑器一个菜单 + 事件委托**（R-30 第 5 项）。
 *
 * 以前每个 chip 自己包一层 antd `Dropdown`（`trigger: contextMenu`）。一屏 190 个字段就是
 * 190 个 Dropdown 实例：每个都注册 contextmenu 监听、都持有一份 portal 状态，右键一次
 * 还会让 antd 把所有实例的 `open` 算一遍——这是"点字段卡一下"里最不显眼但最实在的一段。
 *
 * 现在菜单只有一份（挂在 `DocumentEditor` 根节点上），chip 只负责"我在哪"：
 * - 鼠标右键：由编辑器在根节点上 `target.closest("[data-document-path]")` 命中最近的 chip；
 * - 键盘：chip 收到 Shift+F10 / 菜单键时调 `request()`，把自己的矩形中心当锚点。
 *
 * 为什么用 context 而不是加 prop：chip 由 `EntryCard → SectionEditor → DocumentEditor`
 * 三层渲染出来（还有 `renderChip` 这种间接路径），逐层透传一个菜单回调会污染三处签名，
 * 而拖拽已经在用同一套 context 写法（`documentDragContext`）。
 */
import { createContext, useContext } from "react";

/** 打开菜单的请求：作用于哪个字段路径 + 屏幕坐标（右键点或 chip 中心）。 */
export interface ChipMenuRequest {
  path: string;
  x: number;
  y: number;
}

export interface ChipMenuHost {
  /** 没挂宿主（例如单独渲染 chip 的测试）时为 null，调用方应静默跳过。 */
  request: ((request: ChipMenuRequest) => void) | null;
}

const NO_HOST: ChipMenuHost = { request: null };

export const DocumentChipMenuContext = createContext<ChipMenuHost>(NO_HOST);

export function useDocumentChipMenu(): ChipMenuHost {
  return useContext(DocumentChipMenuContext);
}
