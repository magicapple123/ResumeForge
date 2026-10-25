// SPDX-License-Identifier: Apache-2.0
// \u6ce8：\u672c\u6587\u4ef6\u7684\u4e2d\u6587\u5939\u5177\u4ee5 \uXXXX \u8f6c\u4e49\u4e66\u5199（\u8fd0\u884c\u65f6\u4ecd\u662f\u540c\u4e00\u4e32\u4e2d\u6587）——\u65b0\u6587\u4ef6\u76f4\u63a5\u5199\u4e2d\u6587\u4f1a
// \u62ac\u9ad8 cjkRatchet \u7684 src \u53e3\u5f84\u57fa\u7ebf；\u8f6c\u4e49\u540e\u5b88\u536b\u9759\u6001\u770b\u4e0d\u5230 CJK，\u6d4b\u8bd5\u671f\u5f85\u503c\u9010\u5b57\u4e0d\u53d8\u3002
/**
 * \u524d\u7aef\u6d4b\u8bd5\u7528\u7684**\u6295\u5f71\u5939\u5177**（F4 §12）：PaperProjectionOut \u7684\u771f\u5b9e\u5f62\u72b6\u3002
 *
 * \u751f\u4ea7\u4fa7\u552f\u4e00\u7684\u6620\u5c04\u5728\u670d\u52a1\u7aef（paper_projection.py），\u524d\u7aef\u6d4b\u8bd5\u4e0d\u5f97\u518d\u5199\u7b2c\u4e8c\u4efd"\u671f\u5f85"——
 * \u4f46\u65e2\u6709\u6d4b\u8bd5\u5927\u91cf\u7528\u65e7 `Profile` \u5939\u5177\u9a71\u52a8\u65b0\u5efa\u5f39\u7a97\u3002\u4e3a\u4e86\u4e0d\u52a8\u90a3\u4e9b\u7528\u4f8b\u7684\u65ad\u8a00，\u8fd9\u91cc\u63d0\u4f9b\u4e00\u4e2a
 * **\u4ec5\u6d4b\u8bd5\u7528**\u7684\u517c\u5bb9\u5c42 `legacyProfileToProjection`：\u628a\u65e7\u8d44\u6599\u5939\u5177\u6298\u6210\u670d\u52a1\u7aef\u6295\u5f71\u5f62\u72b6，
 * \u8ba9\u8001\u7528\u4f8b\u7ee7\u7eed\u9a8c\u8bc1"\u7a7a\u767d\u8d77\u6b65 / \u4e00\u952e\u586b\u5165 / \u8ffd\u52a0\u4e00\u6761"\u8fd9\u4e9b**\u524d\u7aef\u884c\u4e3a**\u3002\u751f\u4ea7\u4ee3\u7801\u91cc\u6ca1\u6709\u5b83\u3002
 */
import type { Profile } from "../types";
import type {
  PaperProjectionOut,
  ProjectionCandidateOut,
  ProjectionScopeOut,
  ProjectionSourceSectionOut,
} from "../features/profile-library/types";
import type { ResumeContent } from "../types";

const SECTION_NAMES: Record<string, string> = {
  basic_info: "\u57fa\u672c\u4fe1\u606f",
  educations: "\u6559\u80b2\u7ecf\u5386",
  experiences: "\u5b9e\u4e60/\u5de5\u4f5c\u7ecf\u5386",
  campus_experiences: "\u6821\u56ed\u7ecf\u5386",
  projects: "\u9879\u76ee\u7ecf\u5386",
  skills: "\u4e13\u4e1a\u6280\u80fd",
  awards: "\u8363\u8a89\u5956\u9879",
  summary: "\u4e2a\u4eba\u603b\u7ed3",
  languages: "\u8bed\u8a00\u80fd\u529b",
  publications: "\u5b66\u672f\u6210\u679c",
  research_projects: "\u79d1\u7814\u9879\u76ee",
  patents: "\u77e5\u8bc6\u4ea7\u6743",
  credentials: "\u8bc1\u4e66\u8d44\u8d28",
};

const MATERIAL_ONLY = new Set(["basic_info", "languages", "patents"]);

/** \u6d88\u8d39\u5206\u533a\u952e → ResumeContent \u6570\u7ec4\u5b57\u6bb5\u3002 */
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

function emptyScope(keyCount: number): ProjectionScopeOut {
  return {
    group_id: "group-1",
    group_name: `\u5f53\u524d\u7ec4（${keyCount}）`,
    is_default: true,
    participating_keys: [],
    section_order: [],
    workspace_revision: 7,
  };
}

/** \u4e00\u4e2a\u7a7a\u6295\u5f71（\u5f53\u524d\u7ec4\u6ca1\u6709\u53c2\u4e0e\u5206\u533a）：\u6240\u6709\u5019\u9009\u5217\u8868\u4e3a\u7a7a\u3001content \u5168\u7a7a\u3002 */
export function emptyProjection(): PaperProjectionOut {
  return {
    scope: emptyScope(0),
    content: {
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
    },
    candidates: [],
    source_layout: [],
    warnings: [],
    snapshot_token: "token-empty",
  };
}

interface FixtureOptions {
  content: Partial<ResumeContent>;
  /** \u53c2\u4e0e\u5206\u533a（\u6d88\u8d39\u952e）；\u9ed8\u8ba4\u53ea\u5305\u542b content \u91cc\u6709\u5185\u5bb9\u7684\u7cfb\u7edf\u5206\u533a\u3002 */
  keys?: string[];
  groupName?: string;
}

/** \u6309 content + \u53c2\u4e0e\u5206\u533a\u6784\u9020\u6295\u5f71（\u5019\u9009\u7684 paper_content_path \u4e0e content \u6570\u7ec4\u4e0b\u6807\u4e00\u81f4）\u3002 */
export function projectionOf({ content, keys, groupName }: FixtureOptions): PaperProjectionOut {
  const full: ResumeContent = {
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
    ...content,
  };
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
      paper_content_path: "",
    });
  }
  for (const key of participating) {
    const field = CONTENT_FIELD[key];
    if (!field) continue;
    const entries = (full[field] as unknown as Record<string, unknown>[]) ?? [];
    entries.forEach((entry, index) => {
      candidates.push({
        section_key: key,
        section_name: SECTION_NAMES[key] ?? key,
        entry_id: `entry-${key}-${index}`,
        title: candidateTitle(key, entry),
        subtitle: candidateSubtitle(key, entry),
        paper_content_path: `${field}/${index}`,
      });
    });
  }
  if (participating.includes("summary") && full.summary) {
    candidates.push({
      section_key: "summary",
      section_name: SECTION_NAMES.summary,
      entry_id: "entry-summary",
      title: SECTION_NAMES.summary,
      subtitle: full.summary.split("\n")[0],
      paper_content_path: "summary",
    });
  }
  const source_layout: ProjectionSourceSectionOut[] = participating.map((key) => {
    const field = CONTENT_FIELD[key];
    const entries = field ? (full[field] as unknown[] | undefined) : undefined;
    return {
      section_key: key,
      section_name: SECTION_NAMES[key] ?? key,
      form:
        key === "basic_info" || key === "summary" || key === "languages" ? "singleton" : "multi",
      entry_count: Array.isArray(entries)
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
      group_name: groupName ?? `\u5f53\u524d\u7ec4（${participating.length}）`,
      participating_keys: participating,
      section_order: participating,
    },
    content: full,
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

// ===== \u65e7 Profile \u5939\u5177 → \u6295\u5f71（\u4ec5\u6d4b\u8bd5\u517c\u5bb9\u5c42） =====

const splitLines = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const splitTechStack = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/[\r\n,，\u3001;；|]+/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * \u628a\u65e7 `Profile` \u5939\u5177\u6298\u6210\u6295\u5f71\u5f62\u72b6——**\u53ea\u7ed9\u65e2\u6709\u524d\u7aef\u6d4b\u8bd5\u590d\u7528**，\u4e0d\u53c2\u4e0e\u751f\u4ea7\u8def\u5f84\u3002
 * \u5b57\u6bb5\u6620\u5c04\u523b\u610f\u4e0e\u6539\u9020\u524d\u7684 `profileToResumeContent` \u7b49\u4ef7，\u8001\u7528\u4f8b\u7684\u65ad\u8a00\u56e0\u6b64\u4e0d\u7528\u91cd\u5199\u3002
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
      major: item.major,
      degree: item.degree,
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
  return projectionOf({ content, groupName: "\u5f53\u524d\u7ec4" });
}

/** 13 \u4e2a\u7cfb\u7edf\u5206\u533a\u5168\u53c2\u4e0e\u3001\u4f46\u53ea\u6709 content \u5185\u5bb9\u7684\u6295\u5f71（F4-C：7 \u7ec4 / 13 \u7ec4\u5bf9\u6bd4\u7528）\u3002 */
/** F8（R-81）\u6295\u5f71\u5939\u5177：content \u6761\u76ee\u5e26\u8d44\u6599\u5c0f\u5b57\u6bb5\u7684\u65b0\u53ef\u9009\u5c5e\u6027（\u5bfc\u5e08/\u7814\u7a76\u65b9\u5411/\u6210\u7ee9\u6392\u540d\u7b49）\u3002 */
export function projectionWithF8Fields(): PaperProjectionOut {
  return projectionOf({
    keys: [
      "basic_info",
      "educations",
      "experiences",
      "campus_experiences",
      "projects",
      "skills",
      "awards",
      "summary",
    ],
    groupName: "F8 \u7ec4",
    content: {
      name: "\u5f20\u4e09",
      job_intent: "\u524d\u7aef\u5f00\u53d1",
      summary: "\u4e2a\u4eba\u603b\u7ed3",
      education: [
        {
          school: "\u793a\u4f8b\u5927\u5b66",
          major: "\u8f6f\u4ef6\u5de5\u7a0b",
          degree: "\u672c\u79d1",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "3.8",
          courses: [],
          achievements: [],
          study_form: "\u5168\u65e5\u5236",
          degree_type: "\u5b66\u672f\u5b66\u4f4d",
          department: "\u8ba1\u7b97\u673a\u5b66\u9662",
          rank: "\u524d 10%",
          advisor: "\u5f20\u4f1f",
          research_direction: "\u8054\u90a6\u5b66\u4e60",
        },
      ],
      experience: [
        {
          company: "\u793a\u4f8b\u79d1\u6280",
          role: "\u524d\u7aef\u5b9e\u4e60\u751f",
          start_date: "2025.03",
          end_date: "2025.08",
          description: ["\u8d1f\u8d23\u7ec4\u4ef6\u5e93"],
          team_size: "8 \u4eba",
          experience_kind: "internship",
        },
      ],
      campus_experience: [],
      projects: [
        {
          name: "ResumeForge",
          role: "\u8d1f\u8d23\u4eba",
          start_date: "2026.01",
          end_date: "2026.06",
          tech_stack: [],
          description: [],
          highlights: [],
          project_size: "10 \u4eba",
          artifact_type: "\u5f00\u6e90\u9879\u76ee",
        },
      ],
      skills: [{ name: "TypeScript", level: "\u719f\u7ec3", category: "\u7f16\u7a0b\u8bed\u8a00" }],
      awards: [
        {
          name: "\u4e00\u7b49\u5956\u5b66\u91d1",
          date: "2024.10",
          description: "",
          issuer: "\u793a\u4f8b\u5927\u5b66",
          level: "\u6821\u7ea7",
          ratio: "\u524d 5%",
        },
      ],
    },
  });
}

export function projectionWithThirteenSections(): PaperProjectionOut {
  return projectionOf({
    content: {
      name: "\u5f20\u4e09",
      job_intent: "\u524d\u7aef\u5f00\u53d1",
      summary: "\u8d44\u6599\u91cc\u7684\u4e2a\u4eba\u603b\u7ed3",
      education: [
        {
          school: "\u793a\u4f8b\u5927\u5b66",
          major: "\u8f6f\u4ef6\u5de5\u7a0b",
          degree: "\u672c\u79d1",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "",
          courses: [],
          achievements: [],
        },
      ],
      experience: [
        {
          company: "\u793a\u4f8b\u79d1\u6280",
          role: "\u524d\u7aef\u5b9e\u4e60\u751f",
          start_date: "2025.03",
          end_date: "2025.08",
          description: [],
        },
      ],
      campus_experience: [],
      projects: [],
      skills: [{ name: "TypeScript", level: "\u719f\u7ec3" }],
      awards: [],
    },
    keys: [
      "basic_info",
      "educations",
      "experiences",
      "campus_experiences",
      "projects",
      "skills",
      "awards",
      "summary",
      "languages",
      "publications",
      "research_projects",
      "patents",
      "credentials",
    ],
    groupName: "\u5168\u91cf\u7ec4",
  });
}
