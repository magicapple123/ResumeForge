// SPDX-License-Identifier: Apache-2.0
/**
 * chip 容器上的「不许起文本选区」兜底。
 *
 * ## 为什么 CSS 的 `user-select: none` 还不够
 *
 * Chrome 的「松开鼠标以搜索文本」只由**选区**触发：按下时如果那个位置已经处在一段
 * 选区里（选区可以跨过不可选中的 chip 间隙，而且在 chip 上**看不到高亮**），Chrome 就把
 * 这次拖动当成"拖动这段文字"，条目反而拖不动。样式表只能拦住"从零开始框选"，拦不住
 * "这次按下落在既有选区里"，也拦不住将来某条 `user-select: text` 又把 chip 里的文字
 * 放出来（比如为了"能复制字段值"）。
 *
 * 所以这里在**容器自己**上补一层 `selectstart`：事件不往外传、也不改全局，
 * 只保证"在这枚 chip 里永远不会有选区诞生"。
 */
import { useEffect, useRef } from "react";

export function useBlockSelectStart<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const block = (event: Event) => event.preventDefault();
    node.addEventListener("selectstart", block);
    return () => node.removeEventListener("selectstart", block);
  }, []);
  return ref;
}
