// SPDX-License-Identifier: Apache-2.0
/**
 * 「这次右键该归谁」的唯一判据：有没有**选中的文字**。
 *
 * 2026-11-04 用户实测：正文块里选中一句话后右键，会同时弹出两份菜单——选区菜单
 * （剪切/复制/粘贴/AI 润色）和字段菜单（收藏要点/调整排版/隐藏字段/移除字段），
 * 两张卡片叠在一起。根因是两套监听都在处理同一个 `contextmenu`：AI 润色那层走
 * 全局单例浮层，字段/行菜单走 antd `Dropdown` 的 `contextMenu` trigger。
 *
 * 语义上这两份菜单不该同时出现：用户既然选了字，右键就是在**处理这段文字**；
 * 字段级动作（隐藏字段、调整排版）属于"没选字时的整块操作"。
 *
 * 判据放在这里而不是各调用点：`useDropdownContextMenu` 与将来的自绘菜单共用一份，
 * 避免又出现"两处各判一次、判据不一致"。
 */

/** `input` / `textarea` 里的选区不在 `window.getSelection()` 里，要单看 selectionStart。 */
function hasFieldSelection(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    if (start === null || end === null || end <= start) return false;
    // 只选中空白不算：复制一段空格没有任何意义，那时右键仍应按整块处理。
    return active.value.slice(start, end).trim().length > 0;
  }
  return false;
}

/** 文档级选区（普通段落、`contenteditable`）。 */
function hasDocumentSelection(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  return selection.toString().trim().length > 0;
}

/**
 * 当前是否有"值得针对它出菜单"的文字选区。
 *
 * 纯空白不算：复制一段空格没有任何意义，那时右键仍应按整块处理。
 */
export function hasActiveTextSelection(): boolean {
  return hasFieldSelection() || hasDocumentSelection();
}
