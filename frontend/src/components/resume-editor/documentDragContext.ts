// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器内部的拖拽上下文：记"当前被拿起的是哪个 item"。
 *
 * 单独放一个 Context 而不是逐层传 props：拖拽源是三种区里的 chips，目标也散在各区，
 * 中间隔着 EntryCard / SectionEditor 好几层；逐层透传会让这些组件都长出一个与它们
 * 无关的参数。
 */
import { createContext, useContext } from "react";

export interface DocumentDragValue {
  /** 正在被拖动的 item 路径；null = 没有拖动。 */
  draggedPath: string | null;
  setDraggedPath: (path: string | null) => void;
}

export const DocumentDragContext = createContext<DocumentDragValue | null>(null);

export function useDocumentDrag(): DocumentDragValue {
  return (
    useContext(DocumentDragContext) ?? {
      draggedPath: null,
      setDraggedPath: () => undefined,
    }
  );
}
