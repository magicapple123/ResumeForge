// SPDX-License-Identifier: Apache-2.0
/** 岗位表单的静态选项常量：岗位类型 / 状态 / 识别内容字段清单。 */

// 岗位类型 / 状态选项的定义在 `types/job.ts`（唯一来源，值就是落库的数据值）。
// 这里只做转发，并保留旧名 `STATUS_OPTIONS`：3 个调用点因此零改动。
export { JOB_TYPE_OPTIONS, JOB_STATUS_OPTIONS as STATUS_OPTIONS } from "../../../types/job";

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
