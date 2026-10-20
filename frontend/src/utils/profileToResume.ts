// SPDX-License-Identifier: Apache-2.0
import type {
  Job,
  Profile,
  ResumeContent,
  ResumeEducation,
  ResumeExperience,
  ResumeProject,
} from "../types";

const splitLines = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const splitTechStack = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/[\r\n,，、;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);

function hasText(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => {
    if (Array.isArray(item)) return item.length > 0;
    return typeof item === "string" && item.trim().length > 0;
  });
}

/** 将资料页的多行字符串转换为简历编辑器使用的数组字段。 */
export function profileToResumeContent(profile: Profile, job?: Job | null): ResumeContent {
  const education: ResumeEducation[] = profile.educations
    .map((item) => ({
      school: item.school,
      major: item.major,
      degree: item.degree,
      start_date: item.start_date,
      end_date: item.end_date,
      gpa: item.gpa,
      courses: splitLines(item.courses),
      achievements: splitLines(item.achievements),
    }))
    .filter((item) => hasText(item as unknown as Record<string, unknown>));
  const experience: ResumeExperience[] = profile.experiences
    .map((item) => ({
      company: item.company,
      role: item.role,
      start_date: item.start_date,
      end_date: item.end_date,
      description: splitLines(item.description),
    }))
    .filter((item) => hasText(item as unknown as Record<string, unknown>));
  const campus_experience = profile.campus_experiences
    .map((item) => ({
      organization: item.organization,
      role: item.role,
      start_date: item.start_date,
      end_date: item.end_date,
      description: splitLines(item.description),
    }))
    .filter((item) => hasText(item as unknown as Record<string, unknown>));
  const projects: ResumeProject[] = profile.projects
    .map((item) => ({
      name: item.name,
      role: item.role,
      start_date: item.start_date,
      end_date: item.end_date,
      tech_stack: splitTechStack(item.tech_stack),
      description: splitLines(item.description),
      highlights: splitLines(item.highlights),
    }))
    .filter((item) => hasText(item as unknown as Record<string, unknown>));

  return {
    photo: profile.photo,
    name: profile.name,
    gender: profile.gender,
    birth_year: profile.birth_year,
    phone: profile.phone,
    email: profile.email,
    city: profile.city,
    personal_website: profile.personal_website ?? "",
    github: profile.github ?? "",
    job_intent: job?.title || profile.job_intent || "",
    summary: profile.summary,
    education,
    experience,
    campus_experience,
    projects,
    skills: profile.skills
      .map((item) => ({ name: item.name, level: item.level }))
      .filter((item) => hasText(item)),
    awards: profile.awards
      .map((item) => ({ name: item.name, date: item.date, description: item.description }))
      .filter((item) => hasText(item)),
  };
}

/**
 * 一份**全空白**的简历内容（T11）：通用手写简历的起点。
 *
 * 为什么不再从资料全量预填：通用简历不针对任何岗位，把资料里所有经历一股脑倒进来，
 * 用户得先删掉一大半才写得下去。现在的口径是"空白起步 + 一键填入"（见
 * `hasAnyResumeContent` 与 `ResumeEditorModal` 的 `fillAll`）。
 *
 * 字段必须与 `profileToResumeContent` **同形**：少一个 key，表单里对应的输入框就
 * 拿不到受控值（antd 会把 undefined 当"未设置"，和空串在保存时是两种结果）。
 */
export function blankResumeContent(): ResumeContent {
  return {
    photo: "",
    name: "",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  };
}

/**
 * 这份表单里有没有任何用户内容（T11 的覆盖确认据此决定要不要拦一道）。
 *
 * 只看 `ResumeContent` 的字段本身：基础信息任一非空，或六个列表任一非空，就算"有内容"。
 * 空数组与纯空白字符串都按"没有"处理——用户点了「开始」又什么都没写，不该被问一次。
 */
export function hasAnyResumeContent(content: ResumeContent | null | undefined): boolean {
  if (!content) return false;
  const scalars: (string | undefined)[] = [
    content.photo,
    content.name,
    content.gender,
    content.birth_year,
    content.phone,
    content.email,
    content.city,
    content.personal_website,
    content.github,
    content.job_intent,
    content.summary,
  ];
  if (scalars.some((value) => typeof value === "string" && value.trim() !== "")) return true;
  const lists: unknown[][] = [
    content.education,
    content.experience,
    content.campus_experience,
    content.projects,
    content.skills,
    content.awards,
  ];
  return lists.some((list) => Array.isArray(list) && list.length > 0);
}
