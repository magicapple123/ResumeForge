// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位域枚举的「协议值 → 语言包 key」映射（页面层映射，`types/job.ts` 一个字符不动）。
 *
 * 表里的**键**是落库的协议值（`校招` / `开放中` / `岗位采集` …，与后端 `job_type`、
 * `status`、`recognition_source` 同值），永远不翻；**值**是语言包 key，渲染处再
 * `t(...)`。本模块因此只放 key 表与纯查表函数：模块作用域求值 `t()` 会让切语言后
 * 停在旧文案。
 *
 * 查表一律允许落空：历史落库值（`active` / `open` 归一后仍可能对不上）与采集站点名
 * 不在表里时，调用方按原值显示，不丢信息。
 */
import type { MessageKey } from "../index";

/**
 * `JOB_TYPE_OPTIONS`：岗位类型（键即落库的 `job_type`；顺序与选项表一致）。
 * 下拉的 `value` 仍是协议值，只有展示名走语言包。
 */
export const JOB_TYPE_LABEL_KEYS: Record<string, MessageKey> = {
  校招: "enumsJobs.jobType.campus", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  实习: "enumsJobs.jobType.internship",
  社招: "enumsJobs.jobType.experienced", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  其他: "enumsJobs.jobType.other",
};

/**
 * `JOB_STATUS_META` / `JOB_STATUS_OPTIONS`：岗位状态（键即落库的 `status`）。
 * 颜色仍由 `JOB_STATUS_META` 提供，这里只管展示名；顺序 = META 键序，
 * 因此下拉可以直接按本表条目渲染。
 */
export const JOB_STATUS_LABEL_KEYS: Record<string, MessageKey> = {
  开放中: "enumsJobs.status.open", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  已截止: "enumsJobs.status.closed",
  已投递: "enumsJobs.status.applied", // i18n-ok: 后端协议值（中文枚举），仅作查表键
};

/**
 * `JOB_RECOGNITION_SOURCES`：招聘信息的录入方式（后端同名协议值）。
 * 空串表示"没有记录"，不是可选值，因此不在表里。
 */
export const JOB_RECOGNITION_SOURCE_LABEL_KEYS: Record<string, MessageKey> = {
  手动填写: "enumsJobs.recognitionSource.manual", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  粘贴文本识别: "enumsJobs.recognitionSource.pastedText",
  图片识别: "enumsJobs.recognitionSource.image", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  文档识别: "enumsJobs.recognitionSource.document",
  备选岗位导入: "enumsJobs.recognitionSource.candidate", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  "AI 助手录入": "enumsJobs.recognitionSource.assistant",
  岗位采集: "enumsJobs.recognitionSource.collected", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  官网采集: "enumsJobs.recognitionSource.officialSite",
};

/**
 * `CANDIDATE_JOB_SOURCE_LABELS`：备选岗位的来源标签。
 * `CandidateJob.source` 还可能是采集站点名（后端站点注册表给出，前端不写死），
 * 查不到就按原值显示。
 */
export const CANDIDATE_JOB_SOURCE_LABEL_KEYS: Record<string, MessageKey> = {
  手动添加: "enumsJobs.candidateSource.manualAdd", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  粘贴文本: "enumsJobs.candidateSource.pastedText",
  招聘截图: "enumsJobs.candidateSource.screenshot", // i18n-ok: 后端协议值（中文枚举），仅作查表键
  招聘文档: "enumsJobs.candidateSource.document",
  助手录入: "enumsJobs.candidateSource.assistant", // i18n-ok: 后端协议值（中文枚举），仅作查表键
};

/**
 * 只认自己的键：原型链上的 `constructor` / `__proto__` 不能变成显示名
 * （岗位类型与来源都可能来自导入的 CSV / 后端站点名，取值不受前端约束）。
 */
function lookup(labels: Record<string, MessageKey>, value: string): MessageKey | undefined {
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value] : undefined;
}

/** 未知取值返回 `undefined`，调用方回退成原值（不丢信息）。 */
export function jobTypeLabelKey(value: string): MessageKey | undefined {
  return lookup(JOB_TYPE_LABEL_KEYS, value);
}

export function jobStatusLabelKey(value: string): MessageKey | undefined {
  return lookup(JOB_STATUS_LABEL_KEYS, value);
}

export function jobRecognitionSourceLabelKey(value: string): MessageKey | undefined {
  return lookup(JOB_RECOGNITION_SOURCE_LABEL_KEYS, value);
}

export function candidateJobSourceLabelKey(value: string): MessageKey | undefined {
  return lookup(CANDIDATE_JOB_SOURCE_LABEL_KEYS, value);
}
