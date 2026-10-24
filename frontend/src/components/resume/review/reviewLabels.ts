// SPDX-License-Identifier: Apache-2.0
/** 批注状态/筛选的 i18n key 映射（纯数据，单独成文件以便 fast-refresh 只导出组件）。 */
import type { MessageKey } from "../../../i18n";
import type { ReviewAnnotationRecord, ReviewStatusFilter } from "../../../features/resume-review";

export const STATUS_LABEL_KEY: Record<ReviewAnnotationRecord["status"], MessageKey> = {
  open: "review.status.open",
  resolved: "review.status.resolved",
  stale: "review.status.stale",
  dismissed: "review.status.dismissed",
};

export const FILTER_LABEL_KEY: Record<ReviewStatusFilter, MessageKey> = {
  all: "review.filter.all",
  open: "review.filter.open",
  resolved: "review.filter.resolved",
  stale: "review.filter.stale",
  dismissed: "review.filter.dismissed",
};
