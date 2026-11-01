// SPDX-License-Identifier: Apache-2.0
/**
 * #8：字段 chip 的「选中」与「展开」分离。
 *
 * 单击只选中（高亮 + 结构树联动 + 定位滚动），**双击 / F2 才展开字段编辑器**——
 * 以前单击直接展开，扫视字段时点一下就弹出一大块编辑器，容易误触。
 *
 * 用 context 而不是逐层透传 prop：chip 由 `EntryCard → SectionEditor → DocumentEditor`
 * 多层渲染出来（还有 `renderChip` 间接路径），透传会污染四处签名；右键菜单
 * （documentChipMenuContext）与拖拽（documentDragContext）已是同一写法。
 *
 * #8 返工（2026-11-01）：手势层需要「把展开态设成确定值」而不只是 toggle——双击的
 * 第二下在"手势开始时本来就是展开"的情况下必须**保持收起**，再 toggle 一次就会把刚收起
 * 的编辑器又弹开。因此这里同时暴露 `setExpanded`（幂等设定）与 `toggleExpand`（F2 用）。
 */

import { createContext, useContext } from "react";

export interface DocumentExpandHost {
  /** 当前展开着字段编辑器的 item path；null = 全部收起。 */
  expandedPath: string | null;
  /** 双击 / F2 调用：已展开则收起，未展开则选中并展开。 */
  toggleExpand: (path: string) => void;
  /** 双击手势的第二下调用：把展开态设成确定值（展开时顺带选中该字段）。 */
  setExpanded: (path: string | null) => void;
}

const NO_HOST: DocumentExpandHost = {
  expandedPath: null,
  toggleExpand: () => {},
  setExpanded: () => {},
};

export const DocumentExpandContext = createContext<DocumentExpandHost>(NO_HOST);

export function useDocumentExpand(): DocumentExpandHost {
  return useContext(DocumentExpandContext);
}
