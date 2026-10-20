// SPDX-License-Identifier: Apache-2.0
/**
 * 「从我的资料填入」的候选数据（纯函数，便于单测）。
 *
 * **为什么复用 `profileToResumeContent` 而不是再写一套字段转换**：手写简历的初始值就是
 * 由它从资料映射出来的，填入的候选项必须是**同一种形状**——否则"预填进来的那条"和
 * "从下拉填进来的那条"字段名会不一样，用户会在表单里看到两条长得不同、行为也不同的
 * 记录，而两者的来源其实是同一份资料。所以这里只做"分组 + 去重 + 取标题"，映射本身
 * 一律走那一份实现。
 *
 * 去重键刻意只用**能认出"是不是同一条"的最小字段集**（学校/公司/项目名…）：
 * 用户可能改过分数、补充过描述，那还是同一条经历，不该在下拉里又出现一次。
 */

import type {
  Profile,
  ResumeAward,
  ResumeCampusExperience,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
  ResumeSkill,
} from "../../types";
import { profileToResumeContent } from "../../utils/profileToResume";

/** 下拉里的一条候选。`value` 直接就是表单里那一条的形状。 */
export interface ProfileFillItem {
  /** 去重键，见下面各 `*FillKey`。 */
  key: string;
  /** 下拉里显示的主标题。 */
  label: string;
  /** 次要说明（时间、角色等），可为空。 */
  hint?: string;
  /** 原样写进表单数组的那一条。 */
  value: unknown;
}

/** 六个列表模块的候选 + 个人总结（基本信息里唯一能被"填入"的字段）。 */
export interface ProfileFillSources {
  education: ProfileFillItem[];
  experience: ProfileFillItem[];
  campusExperience: ProfileFillItem[];
  projects: ProfileFillItem[];
  skills: ProfileFillItem[];
  awards: ProfileFillItem[];
  /** 资料里的个人总结；空串表示没写过。 */
  summary: string;
}

/** 列表模块名：`ResumeListSection` 用它挑候选，`ResumeEditorModal` 用它做类型约束。 */
export type ProfileFillSection = Exclude<keyof ProfileFillSources, "summary">;

/** 统一取值：非字符串（表单里可能是 undefined）当成空串，并折叠多余空白。 */
function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** 把若干片段拼成去重键；空片段保留位置，保证不同字段数的键不会互相撞。 */
function joinKey(parts: unknown[]): string {
  return parts.map(text).join("|");
}

/** 整条都没写内容时键里不会有任何非分隔符字符——这种条目不该出现在候选里。 */
function isBlankKey(key: string): boolean {
  return key.split("|").every((part) => part.length === 0);
}

/** 教育：`school|major|start|end`。 */
export function educationFillKey(item: Partial<ResumeEducation> | null | undefined): string {
  return joinKey([item?.school, item?.major, item?.start_date, item?.end_date]);
}

/** 实习/工作：`company|role|start|end`。 */
export function experienceFillKey(item: Partial<ResumeExperience> | null | undefined): string {
  return joinKey([item?.company, item?.role, item?.start_date, item?.end_date]);
}

/** 校园经历：`organization|role`（同一组织同一职务只算一条）。 */
export function campusExperienceFillKey(
  item: Partial<ResumeCampusExperience> | null | undefined,
): string {
  return joinKey([item?.organization, item?.role]);
}

/** 项目：`name`（项目名是最能认出"同一条"的字段）。 */
export function projectFillKey(item: Partial<ResumeProject> | null | undefined): string {
  return joinKey([item?.name]);
}

/** 技能：`name`（同名技能只该出现一次）。 */
export function skillFillKey(item: Partial<ResumeSkill> | null | undefined): string {
  return joinKey([item?.name]);
}

/** 荣誉：`name|date`（同名奖项每届各一条，日期是区分它们的依据）。 */
export function awardFillKey(item: Partial<ResumeAward> | null | undefined): string {
  return joinKey([item?.name, item?.date]);
}

/** 各模块的去重键实现，供 `ResumeListSection` 计算"已加入"集合时复用。 */
export const PROFILE_FILL_KEYS: Record<ProfileFillSection, (item: unknown) => string> = {
  education: (item) => educationFillKey(item as Partial<ResumeEducation>),
  experience: (item) => experienceFillKey(item as Partial<ResumeExperience>),
  campusExperience: (item) => campusExperienceFillKey(item as Partial<ResumeCampusExperience>),
  projects: (item) => projectFillKey(item as Partial<ResumeProject>),
  skills: (item) => skillFillKey(item as Partial<ResumeSkill>),
  awards: (item) => awardFillKey(item as Partial<ResumeAward>),
};

/** 日期区间文案：只写有值的那一端，两端都有时用 `~` 连接。 */
function dateRange(start: unknown, end: unknown): string {
  const from = text(start);
  const to = text(end);
  if (from && to) return `${from} ~ ${to}`;
  return from || to;
}

/** 用「标题 + 次要说明」把一条记录描述给人看。 */
function describe(
  label: string,
  ...hints: (string | undefined)[]
): {
  label: string;
  hint?: string;
} {
  const hint = hints.filter((item): item is string => Boolean(item && item.trim())).join(" · ");
  return hint ? { label, hint } : { label };
}

/** 把一组表单值转成候选：保持原顺序、按键去重、丢掉整条空白。 */
function toFillItems<T>(
  list: T[],
  keyOf: (item: T) => string,
  describeItem: (item: T) => { label: string; hint?: string },
): ProfileFillItem[] {
  const seen = new Set<string>();
  const items: ProfileFillItem[] = [];
  for (const value of list) {
    const key = keyOf(value);
    if (isBlankKey(key) || seen.has(key)) continue;
    seen.add(key);
    const { label, hint } = describeItem(value);
    items.push(hint ? { key, label, hint, value } : { key, label, value });
  }
  return items;
}

/**
 * 从个人资料造出各模块的填入候选。
 *
 * 每条 `value` 的形状与简历编辑器里的表单值逐字相同（都来自 `profileToResumeContent`），
 * 所以填入就是一次 `[...current, value]`，不需要任何转换或字段补全。
 */
export function buildProfileFillSources(profile: Profile): ProfileFillSources {
  const content = profileToResumeContent(profile);

  return {
    education: toFillItems(content.education, educationFillKey, (item) =>
      describe(
        text(item.school) || "（未填写学校）",
        text(item.major),
        text(item.degree),
        dateRange(item.start_date, item.end_date),
      ),
    ),
    experience: toFillItems(content.experience, experienceFillKey, (item) =>
      describe(
        text(item.company) || "（未填写公司）",
        text(item.role),
        dateRange(item.start_date, item.end_date),
      ),
    ),
    campusExperience: toFillItems(content.campus_experience, campusExperienceFillKey, (item) =>
      describe(
        text(item.organization) || "（未填写组织）",
        text(item.role),
        dateRange(item.start_date, item.end_date),
      ),
    ),
    projects: toFillItems(content.projects, projectFillKey, (item) =>
      describe(text(item.name) || "（未填写项目名）", text(item.role)),
    ),
    skills: toFillItems(content.skills, skillFillKey, (item) =>
      describe(text(item.name) || "（未填写技能）", text(item.level)),
    ),
    awards: toFillItems(content.awards, awardFillKey, (item) =>
      describe(text(item.name) || "（未填写奖项）", text(item.date)),
    ),
    summary: text(content.summary),
  };
}
