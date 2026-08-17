/** 全局类型定义：与后端 schemas/ 一一对应，接口变更时同步修改这里。 */

// ===== 通用 =====
export interface Page<T> {
  items: T[];
  total: number;
}

export interface SkillTag {
  name: string;
  category: string;
}

// ===== 个人资料 =====
export interface Education {
  id?: number;
  school: string;
  major: string;
  degree: string;
  start_date: string;
  end_date: string;
  gpa: string;
  courses: string;
  achievements: string;
}

export interface Experience {
  id?: number;
  company: string;
  role: string;
  start_date: string;
  end_date: string;
  description: string;
}

export interface Project {
  id?: number;
  name: string;
  role: string;
  start_date: string;
  end_date: string;
  tech_stack: string;
  description: string;
  highlights: string;
}

export interface Skill {
  id?: number;
  name: string;
  level: string;
}

export interface Award {
  id?: number;
  name: string;
  date: string;
  description: string;
}

export interface Profile {
  id: number;
  name: string;
  gender: string;
  birth_year: string;
  phone: string;
  email: string;
  city: string;
  target_city: string;
  job_intent: string;
  personal_website: string;
  github: string;
  summary: string;
  educations: Education[];
  experiences: Experience[];
  projects: Project[];
  skills: Skill[];
  awards: Award[];
  updated_at?: string;
}

// ===== 岗位 =====
export interface Job {
  id: number;
  title: string;
  company: string;
  location: string;
  salary: string;
  job_type: string;
  description: string;
  requirements: string;
  keywords: SkillTag[];
  source: string;
  source_url: string;
  posted_at: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface JobPayload {
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  job_type?: string;
  description?: string;
  requirements?: string;
  source_url?: string;
  posted_at?: string;
  status?: string;
}

export interface ParsedJobDraft extends Required<JobPayload> {
  warnings: string[];
}

// ===== 简历 =====
export interface ResumeEducation {
  school: string;
  major: string;
  degree: string;
  start_date: string;
  end_date: string;
  gpa: string;
  courses: string[];
  achievements: string[];
}

export interface ResumeExperience {
  company: string;
  role: string;
  start_date: string;
  end_date: string;
  description: string[];
}

export interface ResumeProject {
  name: string;
  role: string;
  start_date: string;
  end_date: string;
  tech_stack: string[];
  description: string[];
  highlights: string[];
}

export interface ResumeSkill {
  name: string;
  level: string;
}

export interface ResumeAward {
  name: string;
  date: string;
  description: string;
}

export interface ResumeContent {
  name: string;
  gender: string;
  birth_year: string;
  phone: string;
  email: string;
  city: string;
  job_intent: string;
  summary: string;
  education: ResumeEducation[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  skills: ResumeSkill[];
  awards: ResumeAward[];
}

export interface ResumeBrief {
  id: number;
  title: string;
  job_title: string;
  company: string;
  model: string;
  tone: string;
  created_at: string;
}

export interface ResumeDetail extends ResumeBrief {
  content: ResumeContent;
  warnings: string[];
  parse_error: string;
}

export type ResumeTone = "standard" | "tech" | "academic";

export interface GenerateOptions {
  tone: ResumeTone;
}

/** 生成接口 SSE 事件（与后端 generator 事件一一对应） */
export type StreamEvent =
  | { type: "progress"; message: string }
  | { type: "delta"; text: string }
  | { type: "done"; resume: ResumeContent; warnings: string[] }
  | { type: "saved"; record_id: number }
  | { type: "error"; message: string };

// ===== 设置 =====
export interface LLMConfig {
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  timeout_seconds: number;
  max_tokens: number;
}

export interface LLMTestResult {
  ok: boolean;
  latency_ms: number | null;
  message: string;
}

// ===== 搜索与统计 =====
export interface SearchResult {
  jobs: Job[];
  resumes: ResumeBrief[];
}

export interface Stats {
  job_count: number;
  open_job_count: number;
  resume_count: number;
  week_resume_count: number;
  latest_jobs: Job[];
  latest_resumes: ResumeBrief[];
}
