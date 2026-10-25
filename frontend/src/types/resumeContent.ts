// SPDX-License-Identifier: Apache-2.0
/**
 * 简历正文的内容结构：六类条目 + `ResumeContent`。
 *
 * 从 `types/resume.ts` 拆出（该文件已超过 500 行预算）。既有导入路径
 * （`from "../types/resume"` / `from "../types"`）由 `resume.ts` 的 re-export 保持不变，
 * 因此这次拆分是**纯搬迁**，不改任何运行时行为。
 */

export interface ResumeEducation {
  school: string;
  major: string;
  degree: string;
  start_date: string;
  end_date: string;
  gpa: string;
  courses: string[];
  achievements: string[];
  /** F8（R-81）：资料小字段在简历里的可选落点；空串/缺省不进导出，旧简历指纹不变。 */
  study_form?: string;
  degree_type?: string;
  department?: string;
  rank?: string;
  advisor?: string;
  research_direction?: string;
  /** 稳定对象标识（W01）：旧记录没有就是没有，保存时才由前端物化。 */
  id?: string;
  /** 要点标识，键为该模型声明的数组字段名；长度必须与对应数组一致。 */
  point_ids?: Record<string, string[]>;
  /** 语义大纲（W06）：隐藏后编辑态保留原文，但正式导出（HTML/PDF/Word/MD/TXT/交付 JSON）排除。 */
  hidden?: boolean;
  /** 锁定内容（W06）：AI/翻译/优化器不得改正文；排版仍可调。 */
  lock_content?: boolean;
  /** 锁定排版（W06）：正文可改，但参数与局部排版不得被自动化改写。 */
  lock_layout?: boolean;
}

export interface ResumeExperience {
  company: string;
  role: string;
  start_date: string;
  end_date: string;
  description: string[];
  /** F8：团队规模 + 工作类型（A4 白名单 code：full_time/part_time/contract/...）。 */
  team_size?: string;
  experience_kind?: string;
  id?: string;
  point_ids?: Record<string, string[]>;
  /** 语义大纲（W06）：隐藏后编辑态保留原文，但正式导出（HTML/PDF/Word/MD/TXT/交付 JSON）排除。 */
  hidden?: boolean;
  /** 锁定内容（W06）：AI/翻译/优化器不得改正文；排版仍可调。 */
  lock_content?: boolean;
  /** 锁定排版（W06）：正文可改，但参数与局部排版不得被自动化改写。 */
  lock_layout?: boolean;
}

export interface ResumeCampusExperience {
  organization: string;
  role: string;
  start_date: string;
  end_date: string;
  description: string[];
  /** F8：活动类型。 */
  activity_type?: string;
  id?: string;
  point_ids?: Record<string, string[]>;
  /** 语义大纲（W06）：隐藏后编辑态保留原文，但正式导出（HTML/PDF/Word/MD/TXT/交付 JSON）排除。 */
  hidden?: boolean;
  /** 锁定内容（W06）：AI/翻译/优化器不得改正文；排版仍可调。 */
  lock_content?: boolean;
  /** 锁定排版（W06）：正文可改，但参数与局部排版不得被自动化改写。 */
  lock_layout?: boolean;
}

export interface ResumeProject {
  name: string;
  role: string;
  start_date: string;
  end_date: string;
  tech_stack: string[];
  description: string[];
  highlights: string[];
  /** F8：项目规模；artifact_type 是 A4 既有字段（成果类型），本批补进前端类型。 */
  project_size?: string;
  artifact_type?: string;
  id?: string;
  point_ids?: Record<string, string[]>;
  /** 语义大纲（W06）：隐藏后编辑态保留原文，但正式导出（HTML/PDF/Word/MD/TXT/交付 JSON）排除。 */
  hidden?: boolean;
  /** 锁定内容（W06）：AI/翻译/优化器不得改正文；排版仍可调。 */
  lock_content?: boolean;
  /** 锁定排版（W06）：正文可改，但参数与局部排版不得被自动化改写。 */
  lock_layout?: boolean;
}

export interface ResumeSkill {
  name: string;
  level: string;
  /** F8：技能分类。 */
  category?: string;
  id?: string;
  /** 语义大纲（W06）：隐藏后编辑态保留原文，但正式导出排除。 */
  hidden?: boolean;
  /** 锁定内容：AI/翻译/优化器不得改这一条。 */
  lock_content?: boolean;
  /** 锁定排版：这一条的排版不被自动化改写。 */
  lock_layout?: boolean;
}

export interface ResumeAward {
  name: string;
  date: string;
  description: string;
  /** F8：颁发机构、奖项级别、获奖比例。 */
  issuer?: string;
  level?: string;
  ratio?: string;
  id?: string;
  /** 语义大纲（W06）：隐藏后编辑态保留原文，但正式导出排除。 */
  hidden?: boolean;
  /** 锁定内容：AI/翻译/优化器不得改这一条。 */
  lock_content?: boolean;
  /** 锁定排版：这一条的排版不被自动化改写。 */
  lock_layout?: boolean;
}

/**
 * 科研栏目的作者/发明人（W14）：列表顺序即署名顺序；is_self 标本人，corresponding 标通讯作者。
 */
export interface ResumeAuthor {
  name: string;
  is_self: boolean;
  corresponding: boolean;
}

/** 论文发表状态（W14）。`in_press` = 已录用待刊；`under_review` = 在投，不得展示成已发表。 */
export type ResumePublicationStatus =
  "published" | "accepted" | "in_press" | "under_review" | "preprint" | "other";

export interface ResumePublication {
  title: string;
  authors: ResumeAuthor[];
  venue: string;
  year: string;
  status: ResumePublicationStatus;
  doi: string;
  url: string;
  volume_pages: string;
  note: string;
  /** F8：成果类型、我的署名位次。 */
  outcome_type?: string;
  my_rank?: string;
  id?: string;
  /** 语义大纲/导出可见性（与六类正文条目同一套 W06 字段）。 */
  hidden?: boolean;
  lock_content?: boolean;
  lock_layout?: boolean;
}

export interface ResumeResearchProject {
  name: string;
  role: string;
  organization: string;
  start_date: string;
  end_date: string;
  funding: string;
  /** F8：项目级别。 */
  level?: string;
  description: string[];
  outcomes: string[];
  id?: string;
  point_ids?: Record<string, string[]>;
  hidden?: boolean;
  lock_content?: boolean;
  lock_layout?: boolean;
}

/** 专利状态（W14）：filed = 已申请；pending = 审查中；granted = 已授权。 */
export type ResumePatentStatus = "filed" | "pending" | "granted" | "expired" | "other";

export interface ResumePatent {
  title: string;
  inventors: ResumeAuthor[];
  patent_number: string;
  country: string;
  status: ResumePatentStatus;
  filed_date: string;
  granted_date: string;
  url: string;
  id?: string;
  hidden?: boolean;
  lock_content?: boolean;
  lock_layout?: boolean;
}

/** 资格证照状态（后端 ResumeCredential 的事实锁字段）：默认 unknown，不自动认定。 */
export type ResumeCredentialStatus = "unknown" | "pending" | "active" | "expired";

/**
 * 资格证照（A4）：零新表，存在 content JSON 内。**没有 credential_number**：
 * 证号默认不进模型/纸面/导出，因此这里根本不声明它。
 */
export interface ResumeCredential {
  name: string;
  issuer: string;
  /** F8：证书类型。 */
  credential_type?: string;
  issue_date: string;
  expiry_date: string;
  status: ResumeCredentialStatus;
  verify_url: string;
  note: string;
  id?: string;
  hidden?: boolean;
  lock_content?: boolean;
  lock_layout?: boolean;
}

/** 自建大字段的一条「标签：值」行（C2/R-79，后端 ResumeCustomLine 的镜像）。 */
export interface ResumeCustomLine {
  label: string;
  value: string;
}

/** 自建大字段的一条：主文本 + 其余字段的标签行；顺序由服务端投影冻结。 */
export interface ResumeCustomEntry {
  entry_id: string;
  text: string;
  lines: ResumeCustomLine[];
}

/** 自建大字段在纸面上的独立分区；key 形如 `custom:<section_id>`（C2/R-79）。 */
export interface ResumeCustomSection {
  key: string;
  title: string;
  entries: ResumeCustomEntry[];
}

export interface ResumeContent {
  photo: string;
  name: string;
  gender: string;
  birth_year: string;
  phone: string;
  email: string;
  city: string;
  /** 公开作品链接：生成时从资料带入，可留空。 */
  personal_website: string;
  github: string;
  job_intent: string;
  summary: string;
  education: ResumeEducation[];
  experience: ResumeExperience[];
  campus_experience: ResumeCampusExperience[];
  projects: ResumeProject[];
  skills: ResumeSkill[];
  awards: ResumeAward[];
  /**
   * 科研三栏目（W14）。
   *
   * **可选**：旧记录与既有前端 fixture 都没有这三项；后端对空列表不序列化（与 W06 的
   * “未设置=不输出”同一口径），因此读取侧一律用 `content.publications ?? []` 兜底。
   */
  publications?: ResumePublication[];
  research_projects?: ResumeResearchProject[];
  patents?: ResumePatent[];
  /**
   * 资格证照（A4）。**可选**：旧记录没有该键；后端对空列表不序列化，
   * 读取侧用 `content.credentials ?? []` 兜底，编辑保存时原样往返（不凭空产生空数组）。
   */
  credentials?: ResumeCredential[];
  /**
   * 自建大字段的纸面分区（C2/R-79）。**只读往返**：内容由服务端投影生成，
   * 编辑器不重新拼标签；空列表不序列化，旧简历指纹不变。
   */
  custom_sections?: ResumeCustomSection[];
}
