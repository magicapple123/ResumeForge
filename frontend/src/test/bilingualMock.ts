// SPDX-License-Identifier: Apache-2.0
/**
 * 双语版本的**离线样例**（v2 文档模型）：给组件测试与离线演示宿主用。
 *
 * 纪律与 `features/resume-assets/mockPhrases.ts` 相同：`src/` 下的样例正文一律用英文
 * （新增文件里写中文会撞 `cjkRatchet` 基线 0）；"另一语言"的值也用 ASCII 占位，
 * 只用来体现"两侧不同"这一事实。
 */
import type { ResumeDocument } from "../types/resumeDocument";
import type {
  GlossaryTerm,
  LanguageVariant,
  TranslationCandidate,
} from "../features/resume-bilingual/types";

function document(overrides: Partial<ResumeDocument> = {}): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: {
      items: [
        {
          kind: "field",
          id: "mock_head_name",
          key: "name",
          label: "",
          value: "Lin Zhiyuan",
          placement: "name",
          format: "text",
        },
        {
          kind: "field",
          id: "mock_head_intent",
          key: "job_intent",
          label: "",
          value: "Backend Engineer",
          placement: "subtitle",
          format: "text",
        },
        {
          kind: "field",
          id: "mock_head_phone",
          key: "phone",
          label: "",
          value: "13800001234",
          placement: "contact",
          format: "text",
        },
      ],
      contact_breaks: [],
    },
    sections: [
      {
        key: "education",
        title: "",
        kind: "entries",
        layout: {
          columns: 1,
          align: "equal",
          gap: null,
          hide_title: false,
          keep_together: false,
          start_on_new_page: false,
          title_override: "",
        },
        entries: [
          {
            id: "mock_edu_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [
              {
                kind: "field",
                id: "mock_edu_school",
                key: "school",
                label: "",
                value: "Example University",
                placement: "title",
                format: "text",
                wrap: "none",
                show_label: false,
                solo: false,
                body_style: "bullet",
                source: null,
              },
              {
                kind: "field",
                id: "mock_edu_major",
                key: "major",
                label: "",
                value: "Software Engineering",
                placement: "title",
                format: "text",
                wrap: "none",
                show_label: false,
                solo: false,
                body_style: "bullet",
                source: null,
              },
              {
                kind: "field",
                id: "mock_edu_period",
                key: "period",
                label: "",
                value: "2013.09|2017.06",
                placement: "meta",
                format: "date_range",
                wrap: "none",
                show_label: false,
                solo: false,
                body_style: "bullet",
                source: null,
              },
            ],
          },
        ],
      },
      {
        key: "experience",
        title: "",
        kind: "entries",
        layout: {
          columns: 1,
          align: "equal",
          gap: null,
          hide_title: false,
          keep_together: false,
          start_on_new_page: false,
          title_override: "",
        },
        entries: [
          {
            id: "mock_exp_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [
              {
                kind: "field",
                id: "mock_exp_company",
                key: "company",
                label: "",
                value: "Cloud Commerce Ltd",
                placement: "title",
                format: "text",
                wrap: "none",
                show_label: false,
                solo: false,
                body_style: "bullet",
                source: null,
              },
              {
                kind: "field",
                id: "mock_exp_role",
                key: "role",
                label: "",
                value: "Senior Backend Engineer",
                placement: "title",
                format: "text",
                wrap: "none",
                show_label: false,
                solo: false,
                body_style: "bullet",
                source: null,
              },
              {
                kind: "text",
                id: "mock_exp_text",
                style: "bullet",
                text: "Cut API latency by half and led the payment rewrite.",
                hidden: false,
              },
            ],
          },
        ],
      },
      {
        key: "summary",
        title: "",
        kind: "text",
        layout: {
          columns: 1,
          align: "equal",
          gap: null,
          hide_title: false,
          keep_together: false,
          start_on_new_page: false,
          title_override: "",
        },
        entries: [
          {
            id: "mock_summary_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [
              {
                kind: "text",
                id: "mock_summary_text",
                style: "paragraph",
                text: "Ten years on high concurrency trading systems.",
                hidden: false,
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

/** 主列（视为中文版的数据占位；纯 ASCII 以便进仓库）。 */
export const MOCK_PRIMARY: ResumeDocument = document();

/** 另一语言版本：同一结构、同 id，文本已替换成译文占位。 */
export const MOCK_SECONDARY: ResumeDocument = document({
  language: "en-US",
  header: {
    items: [
      {
        kind: "field",
        id: "mock_head_name",
        key: "name",
        label: "",
        value: "Lin Zhiyuan",
        placement: "name",
        format: "text",
      },
      {
        kind: "field",
        id: "mock_head_intent",
        key: "job_intent",
        label: "",
        value: "Backend Engineer",
        placement: "subtitle",
        format: "text",
      },
      {
        kind: "field",
        id: "mock_head_phone",
        key: "phone",
        label: "",
        value: "13800001234",
        placement: "contact",
        format: "text",
      },
    ],
    contact_breaks: [],
  },
  sections: MOCK_PRIMARY.sections.map((section) => ({
    ...section,
    entries: section.entries.map((entry) => ({
      ...entry,
      items: entry.items.map((item) =>
        item.kind === "text" ? { ...item, text: item.text + " (translated)" } : item,
      ),
    })),
  })),
});

/** 语言版本列表（切换条测试用）。 */
export const MOCK_VARIANTS: LanguageVariant[] = [
  {
    id: 11,
    resume_id: 5,
    name: "Chinese version",
    language: "zh-CN",
    variant_group_id: null,
    created_at: "2026-10-01T00:00:00Z",
  },
  {
    id: 12,
    resume_id: 5,
    name: "English version",
    language: "en-US",
    variant_group_id: null,
    created_at: "2026-10-01T00:00:00Z",
  },
];

/** 术语表样例。 */
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

/** 翻译候选样例：两条可采纳 + 一条事实锁（姓名）。 */
export const MOCK_CANDIDATES: TranslationCandidate[] = [
  {
    path: "summary.mock_summary_01.mock_summary_text",
    label: "summary",
    before: "Ten years on high concurrency trading systems.",
    after: "Ten years building high-concurrency trading systems.",
    tokens: [
      { type: "removed", text: "Ten years on high concurrency trading systems." },
      { type: "added", text: "Ten years building high-concurrency trading systems." },
    ],
    blocked: false,
  },
  {
    path: "experience.mock_exp_01.mock_exp_text",
    label: "description",
    before: "Cut API latency by half and led the payment rewrite.",
    after: "Halved API latency and led the payment rewrite.",
    tokens: [
      { type: "removed", text: "Cut API latency by half and led the payment rewrite." },
      { type: "added", text: "Halved API latency and led the payment rewrite." },
    ],
    blocked: false,
  },
  {
    path: "header.mock_head_name",
    label: "name",
    before: "Lin Zhiyuan",
    after: "Lin Zhiyuan",
    tokens: [{ type: "unchanged", text: "Lin Zhiyuan" }],
    blocked: true,
  },
];
