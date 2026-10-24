// SPDX-License-Identifier: Apache-2.0
/** 批注包解析问题的中文说明（纯数据映射，供 `ReviewImportForm` 与测试共用）。 */
import type { MessageKey } from "../../../i18n";
import { t } from "../../../i18n";
import type { ReviewPackIssue } from "../../../features/resume-review";

/** 解析原因码 → 面向用户的说明 key。 */
const ISSUE_KEY: Record<ReviewPackIssue["code"], MessageKey> = {
  "too-large": "review.error.too-large",
  "not-json": "review.error.not-json",
  "bad-format": "review.error.bad-format",
  "bad-version": "review.error.bad-version",
  "bad-token": "review.error.bad-token",
  "bad-snapshot": "review.error.bad-snapshot",
  "bad-reviewer": "review.error.bad-reviewer",
  "bad-annotations": "review.error.bad-annotations",
  "bad-annotation": "review.error.bad-annotation",
  "duplicate-external-id": "review.error.duplicate-external-id",
};

const FIELD_KEYS: Record<string, MessageKey> = {
  external_id: "review.field.external_id",
  object_id: "review.field.object_id",
  point_id: "review.field.point_id",
  path: "review.field.path",
  text: "review.field.text",
  quoted_text: "review.field.quoted_text",
  created_at: "review.field.created_at",
  field: "review.field.field",
  status: "review.field.status",
  id: "review.field.id",
};

/** 一条解析问题的人话（不带英文原因码；批注序号按 1 起）。 */
export function reviewIssueText(issue: ReviewPackIssue): string {
  const key = ISSUE_KEY[issue.code];
  const field = issue.field ? t(FIELD_KEYS[issue.field] ?? "review.field.unknown") : "";
  return t(key, { index: (issue.index ?? 0) + 1, field });
}
