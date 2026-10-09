/**
 * 客户端分页：给没有内建分页能力的渲染方式用（Listy 虚拟列表、Collapse、卡片网格）。
 * antd Table 自带 pagination，不要用这个。
 *
 * 为什么不用 useEffect 重置页码：筛选条件变化通过 resetKey 传递，渲染期守卫式重置
 * （与 CollectResultPanel 的 prevTaskId 同一模式，React Compiler 认可）——筛选一变
 * 就回第 1 页，不会停在越界的页码上。
 */
import { useMemo, useState } from "react";

export function useClientPagination<T>(items: T[], pageSize: number, resetKey?: string | number) {
  const [page, setPage] = useState(1);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPage(1);
  }

  const total = items.length;
  // 数据变少（删除 / 筛选）后页码可能越界：夹紧而不是让分页器落空。
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const paged = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );

  return { page: safePage, setPage, paged, total, pages };
}
