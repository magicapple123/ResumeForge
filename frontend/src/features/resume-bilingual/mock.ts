// SPDX-License-Identifier: Apache-2.0
/**
 * 双语版本的**离线样例**（W16-FE 在 W16-BE 就绪前开发/演示用）。
 *
 * 纪律与 `features/resume-assets/mockPhrases.ts` 相同：`src/` 下的样例正文一律用英文
 * （新增文件里写中文会撞 `cjkRatchet` 基线 0）；"中文版"字段在样例里用拼音式英文占位，
 * 只用来体现"两侧不同"这一事实，不代表真实数据。
 *
 * 接入真实接口后，本文件只服务测试与演示宿主。
 */
import type { ResumeContent } from "../../types/resumeContent";
import type { GlossaryTerm, LanguageVariant, TranslationCandidate } from "./types";

function content(overrides: Partial<ResumeContent>): ResumeContent {
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
    ...overrides,
  };
}

/** 主列（视为中文版的数据占位；纯 ASCII 以便进仓库）。 */
export const MOCK_PRIMARY: ResumeContent = content({
  name: "Lin Zhiyuan",
  job_intent: "Backend Engineer",
  phone: "13800001234",
  email: "lin@example.com",
  city: "Hangzhou",
  summary: "Ten years on high concurrency trading systems.",
  education: [
    {
      school: "Example University",
      major: "Software Engineering",
      degree: "BSc",
      start_date: "2013.09",
      end_date: "2017.06",
      gpa: "3.8",
      courses: ["Data Structures"],
      achievements: ["First class honors"],
    },
  ],
  experience: [
    {
      company: "Cloud Commerce Ltd",
      role: "Senior Backend Engineer",
      start_date: "2019.03",
      end_date: "2026.09",
      description: ["Led the checkout rewrite", "Owned on-call rotation"],
    },
  ],
  projects: [
    {
      name: "Replayable Migration Toolkit",
      role: "Maintainer",
      start_date: "2023.01",
      end_date: "2024.06",
      tech_stack: ["Python", "SQLite"],
      description: ["Built a migration checklist"],
      highlights: ["Adopted by three teams"],
    },
  ],
  skills: [{ name: "Python", level: "expert" }],
  awards: [{ name: "Hackathon winner", date: "2022-11", description: "Top 3 of 80 teams" }],
});

/** 次列（英文版示例；与主列在若干字段上有差异，供对照/采纳演示）。 */
export const MOCK_SECONDARY: ResumeContent = content({
  name: "Lin Zhiyuan",
  job_intent: "Backend Engineer",
  phone: "13800001234",
  email: "lin@example.com",
  city: "Hangzhou",
  summary: "Ten years building and operating high-concurrency trading systems.",
  education: [
    {
      school: "Example University",
      major: "Software Engineering",
      degree: "BSc",
      start_date: "2013-09",
      end_date: "2017-06",
      gpa: "3.8",
      courses: ["Data Structures"],
      achievements: ["First class honors"],
    },
  ],
  experience: [
    {
      company: "Cloud Commerce Ltd",
      role: "Senior Backend Engineer",
      start_date: "2019-03",
      end_date: "2026-09",
      description: [
        "Led the checkout rewrite that cut p95 latency from 800ms to 210ms",
        "Owned on-call rotation for 12 services",
      ],
    },
  ],
  projects: [
    {
      name: "Replayable Migration Toolkit",
      role: "Maintainer",
      start_date: "2023-01",
      end_date: "2024-06",
      tech_stack: ["Python", "SQLite"],
      description: ["Built a replayable migration checklist adopted by three teams"],
      highlights: ["Adopted by three teams"],
    },
  ],
  skills: [{ name: "Python", level: "expert" }],
  awards: [{ name: "Hackathon winner", date: "2022.11", description: "Top 3 of 80 teams" }],
});

/** 两个语言版本（各自排版不同，体现"两份独立排版"）。 */
export const MOCK_VARIANTS: LanguageVariant[] = [
  {
    id: 11,
    resume_id: 3,
    name: "Backend - CN",
    language: "zh-CN",
    variant_group_id: 11,
    template: "classic",
    page_limit: 1,
    font_scale: "standard",
    created_at: "2026-10-01T09:00:00Z",
  },
  {
    id: 12,
    resume_id: 3,
    name: "Backend - EN",
    language: "en-US",
    variant_group_id: 11,
    template: "modern",
    page_limit: 2,
    font_scale: "small",
    created_at: "2026-10-02T09:00:00Z",
  },
];

/** 术语表样例（两侧都 ASCII：真实中文术语由用户录入，不进仓库）。 */
export const MOCK_GLOSSARY: GlossaryTerm[] = [
  {
    id: 1,
    source_term: "k8s",
    target_term: "Kubernetes",
    language_from: "zh-CN",
    language_to: "en-US",
    category: "skill",
    locked: true,
    note: "Always spell out in English resumes.",
  },
  {
    id: 2,
    source_term: "Cloud Commerce Ltd",
    target_term: "Cloud Commerce Ltd",
    language_from: "zh-CN",
    language_to: "en-US",
    category: "company",
    locked: true,
    note: "Legal name, do not translate.",
  },
  {
    id: 3,
    source_term: "checkout",
    target_term: "checkout flow",
    language_from: "zh-CN",
    language_to: "en-US",
    category: "term",
    locked: false,
    note: "Preference only.",
  },
];

/** 翻译候选样例：含一条被事实锁拦下的（机构名）。 */
export const MOCK_CANDIDATES: TranslationCandidate[] = [
  {
    path: "summary",
    labelKey: "bilingual.field.summary",
    before: "Ten years on high concurrency trading systems.",
    after: "Ten years building and operating high-concurrency trading systems.",
    tokens: [
      { type: "removed", text: "on" },
      { type: "added", text: "building" },
      { type: "added", text: "and" },
      { type: "added", text: "operating" },
      { type: "unchanged", text: "high-concurrency" },
      { type: "unchanged", text: "trading" },
      { type: "unchanged", text: "systems." },
    ],
    blocked: false,
  },
  {
    path: "experience.0.description.0",
    labelKey: "bilingual.field.description",
    before: "Led the checkout rewrite",
    after: "Led the checkout rewrite that cut p95 latency from 800ms to 210ms",
    tokens: [
      { type: "unchanged", text: "Led" },
      { type: "unchanged", text: "the" },
      { type: "unchanged", text: "checkout" },
      { type: "unchanged", text: "rewrite" },
      { type: "added", text: "that" },
      { type: "added", text: "cut" },
      { type: "added", text: "p95" },
      { type: "added", text: "latency" },
    ],
    blocked: false,
  },
  {
    path: "experience.0.company",
    labelKey: "bilingual.field.company",
    before: "Cloud Commerce Ltd",
    after: "Cloud Commerce Limited",
    tokens: [
      { type: "removed", text: "Ltd" },
      { type: "added", text: "Limited" },
    ],
    blocked: true,
  },
];
