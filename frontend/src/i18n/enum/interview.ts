// SPDX-License-Identifier: Apache-2.0
/**
 * 面试域枚举的显示名映射：**协议值 → 语言包 key**。
 *
 * 键是提交给后端并原样入库的协议值，来源是 `types/interview.ts` 与
 * `types/interviewExperience.ts` 的白名单（那两个文件一个字都没改）；值指向
 * `zh-CN.enumsInterview.ts` / `en-US.enumsInterview.ts` 里的显示名。
 *
 * 模块作用域不能求值 `t()`（切语言不会重渲染），所以这里只放 key，渲染处再 `t()`。
 * 后端可能回传白名单外的历史值：调用方按 `key ? t(key) : 原值` 回退，不丢信息。
 *
 * 中文对象键是**协议值**（提交/入库用的原值，永不翻译），所以逐行带 `i18n-ok`：
 * CJK 棘轮按"含中文的行"计数，这些键不是界面文案。
 */
import type { MessageKey } from "../../i18n";
import {
  EXPERIENCE_ROUND_TYPES,
  type ExperienceSource,
  type InterviewDifficulty,
  type InterviewType,
  type InterviewerStyle,
} from "../../types";

/** 面试类型：`INTERVIEW_TYPES` 的协议值一个不少。 */
export const INTERVIEW_TYPE_LABEL_KEYS: Record<InterviewType, MessageKey> = {
  技术面: "enumsInterview.type.technical", // i18n-ok: 协议值（types 中文枚举键）
  项目深挖: "enumsInterview.type.project", // i18n-ok: 协议值（types 中文枚举键）
  "行为面（STAR）": "enumsInterview.type.behavioral", // i18n-ok: 协议值（types 中文枚举键）
  "HR 面": "enumsInterview.type.hr", // i18n-ok: 协议值（types 中文枚举键）
  综合面: "enumsInterview.type.general", // i18n-ok: 协议值（types 中文枚举键）
  案例分析: "enumsInterview.type.case", // i18n-ok: 协议值（types 中文枚举键）
  英语面试: "enumsInterview.type.english", // i18n-ok: 协议值（types 中文枚举键）
  压力面: "enumsInterview.type.stress", // i18n-ok: 协议值（types 中文枚举键）
};

/** 难度：`INTERVIEW_DIFFICULTIES` 的协议值一个不少。 */
export const INTERVIEW_DIFFICULTY_LABEL_KEYS: Record<InterviewDifficulty, MessageKey> = {
  初级: "enumsInterview.difficulty.junior", // i18n-ok: 协议值（types 中文枚举键）
  中级: "enumsInterview.difficulty.mid", // i18n-ok: 协议值（types 中文枚举键）
  高级: "enumsInterview.difficulty.senior", // i18n-ok: 协议值（types 中文枚举键）
};

/** 面试官风格：`INTERVIEWER_STYLES` 的协议值一个不少（表情映射仍在 `janeFaces.ts`）。 */
export const INTERVIEWER_STYLE_LABEL_KEYS: Record<InterviewerStyle, MessageKey> = {
  严谨专业: "enumsInterview.style.rigorous", // i18n-ok: 协议值（types 中文枚举键）
  温和引导: "enumsInterview.style.gentle", // i18n-ok: 协议值（types 中文枚举键）
  持续追问: "enumsInterview.style.probing", // i18n-ok: 协议值（types 中文枚举键）
  压力质询: "enumsInterview.style.pressure", // i18n-ok: 协议值（types 中文枚举键）
};

/** 面经来源：`EXPERIENCE_SOURCES` 的协议值一个不少。 */
export const EXPERIENCE_SOURCE_LABEL_KEYS: Record<ExperienceSource, MessageKey> = {
  self: "enumsInterview.experienceSource.self",
  peer: "enumsInterview.experienceSource.peer",
  public: "enumsInterview.experienceSource.public",
};

/** 面经轮次：`types` 只导出了值数组，类型在这里就地推导，不改类型层。 */
export type ExperienceRoundType = (typeof EXPERIENCE_ROUND_TYPES)[number];

/**
 * 面经轮次：`EXPERIENCE_ROUND_TYPES` 的参考值一个不少。
 *
 * 存储仍允许自由字符串，所以调用方展示时要保留「映射不到就显示原值」的回退。
 */
export const EXPERIENCE_ROUND_TYPE_LABEL_KEYS: Record<ExperienceRoundType, MessageKey> = {
  一面: "enumsInterview.experienceRound.first", // i18n-ok: 协议值（types 中文枚举键）
  二面: "enumsInterview.experienceRound.second", // i18n-ok: 协议值（types 中文枚举键）
  三面: "enumsInterview.experienceRound.third", // i18n-ok: 协议值（types 中文枚举键）
  HR面: "enumsInterview.experienceRound.hr", // i18n-ok: 协议值（types 中文枚举键）
  笔试: "enumsInterview.experienceRound.writtenTest", // i18n-ok: 协议值（types 中文枚举键）
  其他: "enumsInterview.experienceRound.other", // i18n-ok: 协议值（types 中文枚举键）
};

/**
 * 只认自己的键：原型链上的 `constructor` / `__proto__` 不能变成显示名
 * （面试与面经的取值都来自后端返回值，不受前端白名单约束）。
 */
function lookup<K extends string>(
  labels: Record<K, MessageKey>,
  value: string,
): MessageKey | undefined {
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value as K] : undefined;
}

/** 未知取值返回 `undefined`，调用方回退成后端返回的原值（不丢信息）。 */
export function interviewTypeLabelKey(value: string): MessageKey | undefined {
  return lookup(INTERVIEW_TYPE_LABEL_KEYS, value);
}

export function interviewDifficultyLabelKey(value: string): MessageKey | undefined {
  return lookup(INTERVIEW_DIFFICULTY_LABEL_KEYS, value);
}

export function interviewerStyleLabelKey(value: string): MessageKey | undefined {
  return lookup(INTERVIEWER_STYLE_LABEL_KEYS, value);
}

export function experienceSourceLabelKey(value: string): MessageKey | undefined {
  return lookup(EXPERIENCE_SOURCE_LABEL_KEYS, value);
}

export function experienceRoundTypeLabelKey(value: string): MessageKey | undefined {
  return lookup(EXPERIENCE_ROUND_TYPE_LABEL_KEYS, value);
}
