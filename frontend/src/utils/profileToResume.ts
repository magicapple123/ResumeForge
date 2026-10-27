// SPDX-License-Identifier: Apache-2.0
/**
 * 资料 → 简历正文的**唯一适配层**（F4 §5.3）。
 *
 * 字段映射、承载区「标签：值」追加、语言能力独立分区、分区顺序全部由服务端投影
 * （paper_projection.py）唯一生成；前端**不得**再维护第二份映射（R-37 单源）。
 * 所以这里只剩两件事：
 *
 * 1. `projectionToResumeContent`：直接返回 `projection.content`；岗位模式只覆盖
 *    `job_intent`（既有产品口径：打开某岗位的手写简历时求职意向默认是该岗位名）。
 * 2. 空白内容与"有没有内容"两个纯函数（编辑器起点与覆盖确认用）。
 */
import type { Job, ResumeContent } from "../types";
import type { PaperProjectionOut } from "../features/profile-library/types";

/**
 * 用当前组投影造出编辑器初始内容（整份填充 = 服务端确定性纸面内容）。
 *
 * `job` 非空时只覆盖求职意向——其余字段与"通用简历"逐字相同：投影已经是按当前组
 * 与派生规则算好的 ResumeContent，任何前端再加工都会产生第二份真相。
 */
export function projectionToResumeContent(
  projection: PaperProjectionOut,
  job?: Job | null,
): ResumeContent {
  const content = projection.content;
  if (!job) return content;
  return { ...content, job_intent: job.title || content.job_intent || "" };
}

/**
 * 一份**全空白**的简历内容。
 *
 * F9（2026-10-26）起它**不再是新建简历的起点**：新建简历的初始内容 = 当前组投影内容
 * （两种模式一致，见 `projectionToResumeContent`）。这个构造器保留给测试构造空表单，
 * 也是 `hasAnyResumeContent` / 覆盖确认"有没有东西会被冲掉"的对照物。
 *
 * 可选栏目（科研三栏 / 资格证照 / 自建分区）刻意**不写**：它们在后端是"空列表不序列化"，
 * 凭空塞一个 `[]` 进新建 content 会让旧简历的指纹口径多一个字段。
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
 * 只看 `ResumeContent` 的字段本身：基础信息任一非空，或任一条目列表非空，就算"有内容"。
 * 空数组与纯空白字符串都按"没有"处理——用户点了「开始」又什么都没写，不该被问一次。
 * 可选栏目（科研/证照/自建分区）也算内容：从资料整份填充后它们可能非空。
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
    content.languages ?? [],
    content.awards,
    content.publications ?? [],
    content.research_projects ?? [],
    content.patents ?? [],
    content.credentials ?? [],
    content.custom_sections ?? [],
  ];
  return lists.some((list) => Array.isArray(list) && list.length > 0);
}
