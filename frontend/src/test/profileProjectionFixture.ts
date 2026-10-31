// SPDX-License-Identifier: Apache-2.0
/**
 * 前端测试用的**投影夹具**（F4 §12）：`PaperProjectionOut` 的真实形状。
 *
 * v2 批次口径（2026-10-30）：
 * - `content` 是 **v2 `ResumeDocument`**（与后端 `GET /api/profile/current/projection`
 *   一致；测试里由 `projectionDocumentConverter.v1ContentToV2Document` 从 v1 中间态转出来）；
 * - `candidates` 带 **v2 定位**（`document_path` / `document_entry`）；
 * - 既有用例仍然按 v1 形状构造输入（`projectionOf({ content: Partial<ResumeContent> })`），
 *   这样"空白起步 / 一键填入 / 追加一条"这些**前端行为**断言不用重写。
 *
 * 生产侧唯一的映射在服务端（paper_projection.py），这里只是测试兼容层：
 * 新测试建议直接用 `v1ContentToV2Document` 或 `documentHarness` 造 v2 文档。
 */
import type { Profile, ResumeContent } from "../types";
import type {
  PaperProjectionOut,
  ProjectionCandidateOut,
  ProjectionScopeOut,
  ProjectionSourceSectionOut,
} from "../features/profile-library/types";
import type { ResumeDocument, ResumeEntry, ResumeSection } from "../types/resumeDocument";
import { v1ContentToV2Document } from "./projectionDocumentConverter";

const SECTION_NAMES: Record<string, string> = {
  basic_info: "基本信息",
  educations: "教育经历",
  experiences: "实习/工作经历",
  campus_experiences: "校园经历",
  projects: "项目经历",
  skills: "专业技能",
  awards: "荣誉奖项",
  summary: "个人总结",
  languages: "语言能力",
  publications: "学术成果",
  research_projects: "科研项目",
  patents: "知识产权",
  credentials: "证书资质",
};

const MATERIAL_ONLY = new Set(["basic_info", "languages", "patents"]);

/** 消费分区键 → ResumeContent 数组字段。 */
const CONTENT_FIELD: Record<string, keyof ResumeContent> = {
  educations: "education",
  experiences: "experience",
  campus_experiences: "campus_experience",
  projects: "projects",
  skills: "skills",
  awards: "awards",
  publications: "publications",
  research_projects: "research_projects",
  patents: "patents",
  credentials: "credentials",
};

/** 消费分区键 → v2 文档 section.key（与后端 §7.2 映射一致）。 */
const DOCUMENT_SECTION: Record<string, string> = {
  educations: "education",
  experiences: "experience",
  campus_experiences: "campus_experience",
  projects: "projects",
  skills: "skills",
  awards: "awards",
  publications: "publications",
  research_projects: "research_projects",
  patents: "patents",
  credentials: "credentials",
  languages: "languages",
};

function emptyV1Content(): ResumeContent {
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

function emptyScope(keyCount: number): ProjectionScopeOut {
  return {
    group_id: "group-1",
    group_name: `当前组（${keyCount}）`,
    is_default: true,
    participating_keys: [],
    section_order: [],
    workspace_revision: 7,
  };
}

function documentSectionOf(document: ResumeDocument, key: string): ResumeSection | null {
  return document.sections.find((section) => section.key === key) ?? null;
}

function entryAt(section: ResumeSection | null, index: number): ResumeEntry | null {
  return section?.entries[index] ?? null;
}

/** 一个空投影（当前组没有参与分区）：所有候选列表为空，content 是空 v2 文档。 */
export function emptyProjection(): PaperProjectionOut {
  return {
    scope: emptyScope(0),
    content: v1ContentToV2Document(emptyV1Content()),
    candidates: [],
    source_layout: [],
    warnings: [],
    snapshot_token: "token-empty",
  };
}

interface FixtureOptions {
  content: Partial<ResumeContent>;
  /** 参与分区（消费键）；默认只包含 content 里有内容的系统分区。 */
  keys?: string[];
  groupName?: string;
}

/**
 * 按 content + 参与分区构造投影。
 *
 * 候选按 v2 文档
 * 补上 `document_path`/`document_entry`（新消费方只认这两个）。
 */
export function projectionOf({ content, keys, groupName }: FixtureOptions): PaperProjectionOut {
  const full: ResumeContent = { ...emptyV1Content(), ...content };
  const document = v1ContentToV2Document(full);
  const participating =
    keys ??
    [
      "basic_info",
      "educations",
      "experiences",
      "campus_experiences",
      "projects",
      "skills",
      "awards",
      "summary",
    ].filter((key) => {
      if (key === "basic_info") return Boolean(full.name || full.phone || full.email);
      if (key === "summary") return Boolean(full.summary);
      const field = CONTENT_FIELD[key];
      const value = field ? (full[field] as unknown) : undefined;
      return Array.isArray(value) && value.length > 0;
    });
  const candidates: ProjectionCandidateOut[] = [];
  if (participating.includes("basic_info")) {
    candidates.push({
      section_key: "basic_info",
      section_name: SECTION_NAMES.basic_info,
      entry_id: "entry-basic",
      title: full.name || SECTION_NAMES.basic_info,
      subtitle: full.job_intent,
    });
  }
  for (const key of participating) {
    const field = CONTENT_FIELD[key];
    if (!field) continue;
    const entries = (full[field] as unknown as Record<string, unknown>[]) ?? [];
    const documentSection = documentSectionOf(document, DOCUMENT_SECTION[key] ?? key);
    entries.forEach((entry, index) => {
      const documentEntry = entryAt(documentSection, index);
      const documentPath = documentEntry ? `${documentSection?.key}.${documentEntry.id}` : "";
      candidates.push({
        section_key: key,
        section_name: SECTION_NAMES[key] ?? key,
        entry_id: `entry-${key}-${index}`,
        title: candidateTitle(key, entry),
        subtitle: candidateSubtitle(key, entry),
        document_path: documentPath,
        document_entry: documentEntry,
      });
    });
  }
  if (participating.includes("summary") && full.summary) {
    const summarySection = documentSectionOf(document, "summary");
    const summaryEntry = entryAt(summarySection, 0);
    candidates.push({
      section_key: "summary",
      section_name: SECTION_NAMES.summary,
      entry_id: "entry-summary",
      title: SECTION_NAMES.summary,
      subtitle: full.summary.split("\n")[0],
      document_path:
        summaryEntry && summarySection ? `${summarySection.key}.${summaryEntry.id}` : "",
      document_entry: summaryEntry,
    });
  }
  const source_layout: ProjectionSourceSectionOut[] = participating.map((key) => {
    const field = CONTENT_FIELD[key];
    const entries = field ? (full[field] as unknown[] | undefined) : undefined;
    const documentSection =
      key === "basic_info" || key === "summary"
        ? null
        : documentSectionOf(document, DOCUMENT_SECTION[key] ?? key);
    return {
      section_key: key,
      section_name: SECTION_NAMES[key] ?? key,
      form:
        key === "basic_info" || key === "summary" || key === "languages" ? "singleton" : "multi",
      entry_count: documentSection
        ? documentSection.entries.length
        : Array.isArray(entries)
          ? entries.length
          : key === "summary" && full.summary
            ? 1
            : 0,
      material_only: MATERIAL_ONLY.has(key),
    };
  });
  return {
    scope: {
      ...emptyScope(participating.length),
      group_name: groupName ?? `当前组（${participating.length}）`,
      participating_keys: participating,
      section_order: participating,
    },
    content: document,
    candidates,
    source_layout,
    warnings: [],
    snapshot_token: "token-fixture",
  };
}

function candidateTitle(key: string, entry: Record<string, unknown>): string {
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  switch (key) {
    case "educations":
      return text(entry.school);
    case "experiences":
      return text(entry.company);
    case "campus_experiences":
      return text(entry.organization);
    case "projects":
      return text(entry.name);
    case "skills":
      return text(entry.name);
    case "awards":
      return text(entry.name);
    default:
      return String(entry.name ?? entry.title ?? "");
  }
}

function candidateSubtitle(key: string, entry: Record<string, unknown>): string {
  const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
  const range = (): string => {
    const from = text(entry.start_date);
    const to = text(entry.end_date);
    return from && to ? `${from} ~ ${to}` : from || to;
  };
  const parts: string[] = [];
  switch (key) {
    case "educations":
      parts.push(text(entry.major), text(entry.degree), range());
      break;
    case "experiences":
      parts.push(text(entry.role), range());
      break;
    case "campus_experiences":
      parts.push(text(entry.role), range());
      break;
    case "projects":
      parts.push(text(entry.role));
      break;
    case "skills":
      parts.push(text(entry.level));
      break;
    case "awards":
      parts.push(text(entry.date));
      break;
    default:
      break;
  }
  return parts.filter(Boolean).join(" · ");
}

// ===== 旧 Profile 夹具 → 投影（仅测试兼容层） =====

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

/**
 * 把旧 `Profile` 夹具折成投影形状——**只给既有前端测试复用**，不参与生产路径。
 * 字段映射刻意与改造前的 `profileToResumeContent` 等价，老用例的断言因此不用重写。
 */
export function legacyProfileToProjection(profile: Profile): PaperProjectionOut {
  const content: ResumeContent = {
    photo: profile.photo,
    name: profile.name,
    gender: profile.gender,
    birth_year: profile.birth_year,
    phone: profile.phone,
    email: profile.email,
    city: profile.city,
    personal_website: profile.personal_website ?? "",
    github: profile.github ?? "",
    job_intent: profile.job_intent,
    summary: profile.summary,
    education: profile.educations.map((item) => ({
      school: item.school,
      department: item.department,
      major: item.major,
      degree: item.degree,
      study_form: item.study_mode,
      degree_type: item.degree_type,
      start_date: item.start_date,
      end_date: item.end_date,
      gpa: item.gpa,
      courses: splitLines(item.courses),
      achievements: splitLines(item.achievements),
    })),
    experience: profile.experiences.map((item) => ({
      company: item.company,
      role: item.role,
      start_date: item.start_date,
      end_date: item.end_date,
      description: splitLines(item.description),
    })),
    campus_experience: profile.campus_experiences.map((item) => ({
      organization: item.organization,
      role: item.role,
      start_date: item.start_date,
      end_date: item.end_date,
      description: splitLines(item.description),
    })),
    projects: profile.projects.map((item) => ({
      name: item.name,
      role: item.role,
      start_date: item.start_date,
      end_date: item.end_date,
      tech_stack: splitTechStack(item.tech_stack),
      description: splitLines(item.description),
      highlights: splitLines(item.highlights),
    })),
    skills: profile.skills.map((item) => ({ name: item.name, level: item.level })),
    awards: profile.awards.map((item) => ({
      name: item.name,
      date: item.date,
      description: item.description,
    })),
  };
  return projectionOf({ content, groupName: "当前组" });
}

// F8 / 13 分区样例在独立文件里（单文件行数预算 500）：本文件保持既有导出名不变。
export { projectionWithF8Fields, projectionWithThirteenSections } from "./profileProjectionSamples";
