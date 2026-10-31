// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」面板测试的共享夹具（test/ 目录不参与 cjkRatchet 口径）。
 *
 * 拆测试文件后（单文件 500 行预算）三份测试共用同一份文档/目录夹具与受控 Harness，
 * 避免"改一处夹具要同步三份"——那正是拆分最容易引入的漂移。
 */
import type { DocumentFieldCatalog, ResumeDocument, ResumeItem } from "../types/resumeDocument";

/** 一条字段 item；未传 extra 时按 placement 决定 show_label。 */
export function makeField(
  id: string,
  key: string,
  value: string,
  placement: "title" | "meta" | "lead" | "trail" | "body" | "hidden",
  extra: Partial<ResumeItem> = {},
): ResumeItem {
  return {
    kind: "field",
    id,
    key,
    label: "",
    value,
    placement,
    format: "text",
    wrap: "none",
    show_label: placement === "lead" || placement === "trail",
    solo: false,
    source: null,
    body_style: "bullet",
    ...extra,
  } as ResumeItem;
}

export function sectionDefaults() {
  return {
    columns: 1 as const,
    align: "equal" as const,
    gap: null,
    hide_title: false,
    keep_together: false,
    start_on_new_page: false,
    title_override: "",
  };
}

/** 教育经历（含 title/meta/lead/trail/hidden 五种位置）+ 自建板块。 */
export function makeDocument(): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: { items: [], contact_breaks: [] },
    sections: [
      {
        key: "education",
        title: "",
        kind: "entries",
        layout: sectionDefaults(),
        entries: [
          {
            id: "entry_edu_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [
              makeField("school_01", "school", "上海大学", "title"),
              makeField("degree_01", "degree", "本科", "meta"),
              makeField("gpa_001", "gpa", "3.8", "lead"),
              makeField("study_01", "study_form", "全日制", "trail"),
              makeField("rank_001", "rank", "前 10%", "hidden"),
            ],
          },
        ],
      },
      {
        key: "custom:sec_0001",
        title: "开源项目",
        kind: "entries",
        layout: sectionDefaults(),
        entries: [
          {
            id: "entry_proj_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [makeField("pname_001", "custom:name", "项目甲", "title")],
          },
        ],
      },
    ],
  };
}

/** 行内板块（技能）文档：entries 存在，但 planner 不消费条目级排版（Q07）。 */
export function makeInlineDocument(): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: { items: [], contact_breaks: [] },
    sections: [
      {
        key: "skills",
        title: "",
        kind: "inline",
        layout: sectionDefaults(),
        entries: [
          {
            id: "entry_skill_01",
            hidden: false,
            lock_content: false,
            lock_layout: false,
            layout: { head: "split", columns: null, align: null, gap: null },
            items: [makeField("skill_01", "name", "TypeScript", "body")],
          },
        ],
      },
    ],
  };
}

/** 字段目录夹具：教育经历的三个灰字段标签（Q20 用）。 */
export function fieldCatalogFixture(): DocumentFieldCatalog {
  return {
    sections: [
      {
        key: "education",
        title: "教育经历",
        title_key: "education",
        kind: "entries",
        profile_section_key: "educations",
        material_only: false,
        fields: [
          {
            key: "study_form",
            label: "Study form",
            format: "text",
            field_type: "single_line",
            default_placement: "trail",
            material_only: false,
            private: false,
            source_field_id: "educations.study_form",
          },
          {
            key: "gpa",
            label: "GPA / rank",
            format: "text",
            field_type: "single_line",
            default_placement: "trail",
            material_only: false,
            private: false,
            source_field_id: "educations.gpa",
          },
          {
            key: "rank",
            label: "Class rank",
            format: "text",
            field_type: "single_line",
            default_placement: "trail",
            material_only: false,
            private: false,
            source_field_id: "educations.rank",
          },
        ],
      },
    ],
    header_fields: [],
  };
}

/** 最近一次 onChange 的文档。 */
export function latest(calls: unknown[][]): ResumeDocument {
  return calls[calls.length - 1]?.[0] as ResumeDocument;
}
