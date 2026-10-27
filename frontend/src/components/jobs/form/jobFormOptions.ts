// SPDX-License-Identifier: Apache-2.0
/** 岗位表单的静态常量：识别内容字段清单。 */

// 岗位类型 / 状态两张表仍归 `types/job.ts`（协议值的唯一来源）。它们的展示名已改为
// `src/i18n/enum/jobs.ts` 的 LABEL_KEYS，由 `JobFormFields` 在渲染期 `t()`，
// 所以这里不再转发带中文 label 的选项表。

/** 判断"这次识别到底有没有读出东西"时只看这些字段：job_type 与 status 恒有默认值。 */
export const RECOGNIZED_CONTENT_FIELDS = [
  "title",
  "company",
  "location",
  "salary",
  "description",
  "requirements",
  "additional_info",
  "source_url",
  "posted_at",
] as const;
