import type { ApplyRecord } from "./apply";

/** Shared paging contract for batch-item loading and display. */
export const BATCH_ITEM_PAGE_SIZE = 20;

export interface BatchItemsState {
  items: ApplyRecord[];
  total: number;
  page: number;
  loading: boolean;
}
