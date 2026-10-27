// SPDX-License-Identifier: Apache-2.0
/**
 * 面试域枚举的**显示名**：面试类型 / 难度 / 面试官风格 / 面经来源 / 面经轮次。
 *
 * 值必须逐字等于 `types/interview.ts` 与 `types/interviewExperience.ts` 里的原中文
 * （来源是 `INTERVIEW_TYPES` 等白名单与 `EXPERIENCE_SOURCE_LABELS`）——那些协议值要
 * 原样提交给后端并入库，中文界面下渲染结果因此一个字都不变。
 *
 * 协议值 → 本包 key 的映射在 `i18n/enum/interview.ts`；本文件只放文案，
 * 不在模块作用域求值 `t()`。
 */
const enumsInterview = {
  // ===== 面试类型（INTERVIEW_TYPES 的显示名） =====
  "enumsInterview.type.technical": "技术面",
  "enumsInterview.type.project": "项目深挖",
  "enumsInterview.type.behavioral": "行为面（STAR）",
  "enumsInterview.type.hr": "HR 面",
  "enumsInterview.type.general": "综合面",
  "enumsInterview.type.case": "案例分析",
  "enumsInterview.type.english": "英语面试",
  "enumsInterview.type.stress": "压力面",

  // ===== 难度（INTERVIEW_DIFFICULTIES 的显示名） =====
  "enumsInterview.difficulty.junior": "初级",
  "enumsInterview.difficulty.mid": "中级",
  "enumsInterview.difficulty.senior": "高级",

  // ===== 面试官风格（INTERVIEWER_STYLES 的显示名） =====
  "enumsInterview.style.rigorous": "严谨专业",
  "enumsInterview.style.gentle": "温和引导",
  "enumsInterview.style.probing": "持续追问",
  "enumsInterview.style.pressure": "压力质询",

  // ===== 面经来源（EXPERIENCE_SOURCE_LABELS 的显示名） =====
  "enumsInterview.experienceSource.self": "自己",
  "enumsInterview.experienceSource.peer": "同行",
  "enumsInterview.experienceSource.public": "公开",

  // ===== 面经轮次（EXPERIENCE_ROUND_TYPES 的显示名） =====
  "enumsInterview.experienceRound.first": "一面",
  "enumsInterview.experienceRound.second": "二面",
  "enumsInterview.experienceRound.third": "三面",
  "enumsInterview.experienceRound.hr": "HR面",
  "enumsInterview.experienceRound.writtenTest": "笔试",
  "enumsInterview.experienceRound.other": "其他",
} as const;

export default enumsInterview;
