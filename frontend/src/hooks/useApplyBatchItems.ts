import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listRecordBatchItems } from "../api/apply";
import { BATCH_ITEM_PAGE_SIZE, type BatchItemsState } from "../types/applyBatchItems";
import type { ApplyRecordBatch, Page } from "../types";

const INITIAL_ITEMS: BatchItemsState = { items: [], total: 0, page: 1, loading: true };

/** Cache each batch independently while invalidating the whole view on scope changes. */
export function useApplyBatchItems(
  data: Page<ApplyRecordBatch> | undefined,
  keyword: string,
  result: string,
  expanded: number[],
  onError: (error: string) => void,
) {
  const [cached, setCached] = useState<Record<number, BatchItemsState>>({});
  const [previousScope, setPreviousScope] = useState({ data, keyword, result });
  if (
    previousScope.data !== data ||
    previousScope.keyword !== keyword ||
    previousScope.result !== result
  ) {
    setPreviousScope({ data, keyword, result });
    setCached({});
  }

  const scopeVersion = useRef(0);
  const requests = useRef(new Map<number, object>());
  useEffect(() => {
    const activeRequests = requests.current;
    scopeVersion.current += 1;
    activeRequests.clear();
    return () => {
      scopeVersion.current += 1;
      activeRequests.clear();
    };
  }, [data, keyword, result]);

  // No synchronous UI update here: the missing cache entry already renders as loading.
  const load = useCallback(
    (batchId: number, itemPage: number) => {
      const scope = scopeVersion.current;
      const request = {};
      requests.current.set(batchId, request);
      const isCurrent = () =>
        scope === scopeVersion.current && requests.current.get(batchId) === request;
      return listRecordBatchItems(batchId, {
        keyword,
        result,
        page: itemPage,
        page_size: BATCH_ITEM_PAGE_SIZE,
      })
        .then((response) => {
          if (!isCurrent()) return;
          setCached((previous) => ({
            ...previous,
            [batchId]: {
              items: response.items,
              total: response.total,
              page: itemPage,
              loading: false,
            },
          }));
        })
        .catch((error: unknown) => {
          if (!isCurrent()) return;
          onError(error instanceof Error ? error.message : "加载批次明细失败");
          setCached((previous) => ({
            ...previous,
            [batchId]: {
              items: previous[batchId]?.items ?? [],
              total: previous[batchId]?.total ?? 0,
              page: itemPage,
              loading: false,
            },
          }));
        })
        .finally(() => {
          if (isCurrent()) requests.current.delete(batchId);
        });
    },
    [keyword, result, onError],
  );

  useEffect(() => {
    const visible = new Set(data?.items.map((batch) => batch.id));
    for (const batchId of expanded) {
      if (visible.has(batchId) && !cached[batchId] && !requests.current.has(batchId)) {
        void load(batchId, 1);
      }
    }
  }, [data, expanded, cached, load]);

  // Pagination is an explicit event: keep the current page visible while the next loads.
  const fetchBatchItems = useCallback(
    (batchId: number, itemPage: number) => {
      setCached((previous) => ({
        ...previous,
        [batchId]: { ...(previous[batchId] ?? INITIAL_ITEMS), page: itemPage, loading: true },
      }));
      return load(batchId, itemPage);
    },
    [load],
  );

  const batchItems = useMemo(() => {
    const visibleItems = { ...cached };
    for (const batchId of expanded) visibleItems[batchId] ??= INITIAL_ITEMS;
    return visibleItems;
  }, [cached, expanded]);

  return { batchItems, fetchBatchItems };
}
