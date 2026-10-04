/** 岗位表单的静态选项常量：岗位类型 / 状态 / 识别内容字段清单。 */

export const JOB_TYPE_OPTIONS = ["校招", "实习", "社招", "其他"].map((value) => ({
  value,
  label: value,
}));
export const STATUS_OPTIONS = ["开放中", "已截止", "已投递"].map((value) => ({
  value,
  label: value,
}));

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
