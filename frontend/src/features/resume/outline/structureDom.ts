// SPDX-License-Identifier: Apache-2.0
/**
 * 结构树的 DOM 小工具：按 `data-tree-key` 找行 / 聚焦行。
 *
 * 从 `useStructurePanel` 拆出（2026-10-31，R-12 之后该文件逼近 500 行预算）：
 * 面板的"选中后滚动"与键盘导航的"移动焦点"都要在树里定位同一行，转义规则只能有一份。
 */

/** 把键安全地放进属性选择器的引号里（key 只含 id/点/井号/冒号/连字符；引号与反斜杠兜底转义）。 */
export function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** 在树容器里按稳定键查一行；容器未挂载 / 行未渲染时返回 null。 */
export function queryTreeRow(tree: HTMLElement | null, key: string): HTMLElement | null {
  if (!tree || !key) return null;
  return tree.querySelector<HTMLElement>(`[data-tree-key="${cssAttrEscape(key)}"]`);
}

/** 在树里按稳定键聚焦一行（键盘 ↑↓/Home/End 的落点）；行不存在时静默跳过。 */
export function focusTreeRow(tree: HTMLElement | null, key: string): void {
  const row = queryTreeRow(tree, key);
  if (row && typeof row.focus === "function") row.focus();
}
