// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位域枚举的展示名：岗位类型、岗位状态、录入方式、备选岗位来源。
 *
 * `types/job.ts` 的五张表（`JOB_TYPE_OPTIONS` / `JOB_STATUS_OPTIONS` /
 * `JOB_STATUS_META` / `JOB_RECOGNITION_SOURCES` / `CANDIDATE_JOB_SOURCE_LABELS`）
 * 的键与值全是落库的协议值，本批一个字都没改；这里只放与之一一对应的显示名，
 * 由 `src/i18n/enum/jobs.ts` 的 `*_LABEL_KEYS` 按协议值查表。
 *
 * 所以本包的 zh 值必须**逐字等于** `types/job.ts` 的原中文：换语言包不改变中文界面。
 */
const enumsJobs = {
  "enumsJobs.jobType.campus": "校招",
  "enumsJobs.jobType.internship": "实习",
  "enumsJobs.jobType.experienced": "社招",
  "enumsJobs.jobType.other": "其他",

  "enumsJobs.status.open": "开放中",
  "enumsJobs.status.closed": "已截止",
  "enumsJobs.status.applied": "已投递",

  "enumsJobs.recognitionSource.manual": "手动填写",
  "enumsJobs.recognitionSource.pastedText": "粘贴文本识别",
  "enumsJobs.recognitionSource.image": "图片识别",
  "enumsJobs.recognitionSource.document": "文档识别",
  "enumsJobs.recognitionSource.candidate": "备选岗位导入",
  "enumsJobs.recognitionSource.assistant": "AI 助手录入",
  "enumsJobs.recognitionSource.collected": "岗位采集",
  "enumsJobs.recognitionSource.officialSite": "官网采集",

  "enumsJobs.candidateSource.manualAdd": "手动添加",
  "enumsJobs.candidateSource.pastedText": "粘贴文本",
  "enumsJobs.candidateSource.screenshot": "招聘截图",
  "enumsJobs.candidateSource.document": "招聘文档",
  "enumsJobs.candidateSource.assistant": "助手录入",
} as const;

export default enumsJobs;
