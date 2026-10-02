/** 批量选择的纯状态逻辑：入口/退出、勾选、全选本页（跨页保留已选）。 */
import { useCallback, useState } from "react";

export interface BatchSelection<TId extends string | number> {
  selecting: boolean;
  selectedIds: ReadonlySet<TId>;
  selectedCount: number;
  isSelected: (id: TId) => boolean;
  /** 单条勾选/取消勾选。 */
  toggle: (id: TId) => void;
  /** 对当前可见的一批条目整体勾选/取消勾选（卡片网格"全选本页"用）；跨页保留其他已选。 */
  toggleAll: (ids: TId[]) => void;
  /** 用一份完整 id 列表替换当前已选（Table rowSelection 的 onChange 语义）。 */
  setSelected: (ids: TId[]) => void;
  enterSelecting: () => void;
  /** 退出并清空已选——切换筛选/翻页不自动退出，避免用户辛苦勾好的选区被误清。 */
  exitSelecting: () => void;
}

export function useBatchSelection<TId extends string | number>(): BatchSelection<TId> {
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<TId>>(new Set());

  const toggle = useCallback((id: TId) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback((ids: TId[]) => {
    setSelectedIds((current) => {
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of ids) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  const setSelected = useCallback((ids: TId[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const isSelected = useCallback((id: TId) => selectedIds.has(id), [selectedIds]);

  const enterSelecting = useCallback(() => setSelecting(true), []);

  const exitSelecting = useCallback(() => {
    setSelecting(false);
    setSelectedIds(new Set());
  }, []);

  return {
    selecting,
    selectedIds,
    selectedCount: selectedIds.size,
    isSelected,
    toggle,
    toggleAll,
    setSelected,
    enterSelecting,
    exitSelecting,
  };
}
