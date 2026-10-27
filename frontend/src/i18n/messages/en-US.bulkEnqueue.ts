// SPDX-License-Identifier: Apache-2.0
/** 批量入队聚合账目（与 zh-CN.bulkEnqueue.ts 一一对应）。 */
const bulkEnqueue = {
  "bulkEnqueue.summary.enqueued": "Added {count} Jobs to the apply queue",
  "bulkEnqueue.summary.alreadyQueued": "{count} already in the queue",
  "bulkEnqueue.summary.unsupported": "{count} from unsupported sources",
  "bulkEnqueue.summary.failed": "{count} failed",
  /** Half-width comma plus the space English uses between clauses. */
  "bulkEnqueue.summary.separator": ", ",

  "bulkEnqueue.error.enqueueFailed": "Could not add it to the apply queue",
} as const;

export default bulkEnqueue;
