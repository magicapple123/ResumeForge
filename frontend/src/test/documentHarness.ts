// SPDX-License-Identifier: Apache-2.0
/**
 * v2 文档的测试造数中心（跨文件共享）。
 *
 * 为什么放在 `src/test/`：
 * - 组件/页面测试要造的是"API 会返回的 `ResumeDetail`"与"最小但真实形状的
 *   `ResumeDocument`"，关注点与 `features/resume-document/documentFixtures.ts` 的纯函数
 *   夹具不同（那份刻意只造"三种 kind 齐全"的最小文档，配合 normalize/placement 用例）。
 * - 这里不带 `.test.` 后缀，不会被 vitest 收集；也不进 i18n 棘轮与产品文案扫描的统计口径。
 * - 复用 `features/resume-document/defaults` 的默认值工厂：默认位置/格式只有一份实现，
 *   测试造数与生产"新建一条"不会各写一套默认值。
 *
 * 2026-10-30 v2 迁移完成：制作台/预览/导出全部消费 `ResumeDocument`，v1 形状的过渡桥
 * （legacyDocument/legacyView）已随最后一处 v1 测试改写删除。
 */

import {
  defaultAuthorsItem,
  defaultEntryLayout,
  defaultFieldItem,
  defaultHeaderItem,
  defaultListItem,
  defaultSectionLayout,
  defaultTextItem,
  emptyDocument,
} from "../features/resume-document/defaults";
import type { ResumeDetail } from "../types";
import type {
  HeaderItem,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
  ResumeSection,
  SectionKind,
} from "../types/resumeDocument";

// 默认值工厂与空文档直接以"造数原语"再导出：测试不必记住它们住在 feature 目录里。
export {
  defaultAuthorsItem,
  defaultEntryLayout,
  defaultFieldItem,
  defaultHeaderItem,
  defaultListItem,
  defaultSectionLayout,
  defaultTextItem,
  emptyDocument,
};

export function makeEntry(items: ResumeItem[], overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    id: null,
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: defaultEntryLayout(),
    items,
    ...overrides,
  };
}

export function makeSection(
  key: string,
  kind: SectionKind,
  entries: ResumeEntry[] = [],
  overrides: Partial<ResumeSection> = {},
): ResumeSection {
  return { key, title: "", kind, layout: defaultSectionLayout(), entries, ...overrides };
}

/**
 * 一份"看起来像真实简历"的最小 v2 文档。
 *
 * 覆盖五种形态，组件测试不必各造一份：entries 板块（教育/实习/项目）、inline（技能）、
 * text（个人总结），以及页眉的 name/name_meta/subtitle/contact 四种 placement。
 * 需要别的内容就传 `overrides`（`sections` 整体替换最常见）。
 */
export function makeResumeDocument(overrides: Partial<ResumeDocument> = {}): ResumeDocument {
  return {
    ...emptyDocument("zh-CN"),
    header: {
      items: [
        makeHeaderItem({ id: "doc_name_001", key: "name", value: "张三", placement: "name" }),
        makeHeaderItem({
          id: "doc_gender_01",
          key: "gender",
          value: "男",
          placement: "name_meta",
        }),
        makeHeaderItem({
          id: "doc_intent_01",
          key: "job_intent",
          value: "后端开发工程师",
          placement: "subtitle",
        }),
        makeHeaderItem({
          id: "doc_phone_001",
          key: "phone",
          value: "13800000000",
          placement: "contact",
        }),
        makeHeaderItem({
          id: "doc_email_001",
          key: "email",
          value: "zhangsan@example.com",
          placement: "contact",
        }),
      ],
      contact_breaks: [],
    },
    sections: [
      makeSection("education", "entries", [
        makeEntry(
          [
            defaultFieldItem({
              id: "edu_school_01",
              key: "school",
              value: "清华大学",
              placement: "title",
            }),
            defaultFieldItem({
              id: "edu_major_01",
              key: "major",
              value: "计算机科学",
              placement: "title",
            }),
            defaultFieldItem({
              id: "edu_degree_01",
              key: "degree",
              value: "本科",
              placement: "meta",
            }),
            defaultFieldItem({
              id: "edu_period_01",
              key: "period",
              value: "2018-09|2022-06",
              placement: "meta",
              format: "date_range",
            }),
            defaultFieldItem({
              id: "edu_gpa_001",
              key: "gpa",
              value: "3.9/4.0",
              placement: "lead",
            }),
            defaultTextItem("获得校级奖学金", "bullet"),
          ],
          { id: "edu_entry_01" },
        ),
      ]),
      makeSection("experience", "entries", [
        makeEntry(
          [
            defaultFieldItem({
              id: "exp_company_01",
              key: "company",
              value: "示例科技",
              placement: "title",
            }),
            defaultFieldItem({
              id: "exp_role_001",
              key: "role",
              value: "后端工程师",
              placement: "title",
            }),
            defaultFieldItem({
              id: "exp_period_01",
              key: "period",
              value: "2022-07|至今",
              placement: "meta",
              format: "date_range",
            }),
            defaultFieldItem({
              id: "exp_team_001",
              key: "team_size",
              value: "8 人",
              placement: "trail",
            }),
            defaultTextItem("负责检索服务的接口设计与性能优化", "bullet"),
          ],
          { id: "exp_entry_01" },
        ),
      ]),
      makeSection("projects", "entries", [
        makeEntry(
          [
            defaultFieldItem({
              id: "proj_name_001",
              key: "name",
              value: "简历工具",
              placement: "title",
            }),
            defaultFieldItem({
              id: "proj_role_001",
              key: "role",
              value: "负责人",
              placement: "meta",
            }),
            defaultListItem({
              id: "proj_tech_001",
              key: "tech_stack",
              values: ["TypeScript", "FastAPI"],
              placement: "trail",
            }),
            defaultTextItem("从零搭建前端与后端", "bullet"),
          ],
          { id: "proj_entry_01" },
        ),
      ]),
      makeSection("skills", "inline", [
        makeEntry(
          [
            defaultFieldItem({
              id: "skill_cat_01",
              key: "category",
              value: "后端",
              placement: "trail",
            }),
            defaultFieldItem({
              id: "skill_name_1",
              key: "name",
              value: "Python",
              placement: "body",
            }),
            defaultFieldItem({
              id: "skill_level1",
              key: "level",
              value: "熟练",
              placement: "body",
              wrap: "paren",
            }),
          ],
          { id: "skills_entry_1" },
        ),
      ]),
      makeSection("summary", "text", [
        makeEntry(
          [
            {
              ...defaultTextItem("五年的后端开发经验，关注可维护性与性能。", "paragraph"),
              id: "summary_text_1",
            },
          ],
          { id: "summary_entry_1" },
        ),
      ]),
    ],
    ...overrides,
  };
}

export function makeHeaderItem(init: {
  key: string;
  value?: string;
  label?: string;
  placement?: HeaderItem["placement"];
  id?: string;
}): HeaderItem {
  return defaultHeaderItem(init);
}

/**
 * API 会返回的完整 `ResumeDetail`（v2 content）。
 *
 * 默认值刻意全部"中性"：需要断言哪一块就覆盖哪一块，避免每个测试各写一份 30 行的详情夹具。
 */
export function makeResumeDetail(overrides: Partial<ResumeDetail> = {}): ResumeDetail {
  return {
    id: 42,
    title: "示例简历",
    job_id: null,
    job_title: "",
    company: "",
    source: "manual",
    favorite: false,
    note: "",
    model: "test-model",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    template: "classic",
    format_name: "",
    format_config: {},
    page_limit: 1,
    font_scale: "standard",
    language: "zh-CN",
    created_at: "2026-10-30T00:00:00",
    updated_at: null,
    revision: 1,
    content: makeResumeDocument(),
    warnings: [],
    parse_error: "",
    parent_revision_id: null,
    rationale: "",
    coverage_notes: [],
    ...overrides,
  };
}
