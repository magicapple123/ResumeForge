// SPDX-License-Identifier: Apache-2.0
/**
 * 「语音记一条」的纯逻辑（T09）：草稿 → 条目提案 → 写回文档。
 *
 * 这里验的是**映射与写入**，不是录音（录音层是 hook，需要真麦克风或整套假 AudioContext，
 * 而它复用 `MicCapture` 与既有 WAV 编码，已被各自的用例覆盖）。
 *
 * 三条最容易静默出错的：
 * 1. `field_id`（`experiences.company`）必须靠目录的 `source_field_id` 对上文档字段 key，
 *    对不上时**整条跳过**而不是塞错字段；
 * 2. 页眉（`basic_info`）与纯文本板块（`summary`）不进条目——它们没有可追加的 entry；
 * 3. 同一段内容插两次不能变两条（用户会连点）。
 */
import { describe, expect, it } from "vitest";
import type {
  DocumentFieldCatalog,
  FieldItem,
  ResumeDocument,
  ResumeSection,
} from "../../types/resumeDocument";
import { defaultSectionLayout } from "../resume/document/defaults";
import { emptyEntry } from "../resume/document/defaults";
import { joinDateRange } from "../resume/document/format";
import { applyMemoProposals, memoProposals, type MemoDraftSection } from "./voiceMemoDraft";

/**
 * 目录夹具**照后端 `field-placement-catalog` 的口径**造：`source_field_id` 是纸面目录认的
 * 资料字段 id，文档字段 key 是纸面 key。两处**不总是同名**——经历角色在解析结果是
 * `experiences.title`（资料目录的叫法），纸面目录写的却是 `role` + `experiences.role`。
 * 用真实目录形状而不是 `buildFallbackCatalog`，是因为后者按纸面 key 拼 source，会把
 * "映射不上"测成"实现错了"（I-20 的 bug 正是这样漏掉的）。
 */
const EXPERIENCE_FIELD = (
  key: string,
  label: string,
  profileKey: string,
  format: string = "text",
) => ({
  key,
  label,
  format: format as DocumentFieldCatalog["sections"][number]["fields"][number]["format"],
  field_type: "single_line",
  default_placement: "trail" as const,
  material_only: false,
  private: false,
  source_field_id: `experiences.${profileKey}`,
});

const CATALOG: DocumentFieldCatalog = {
  header_fields: [],
  sections: [
    {
      key: "experience",
      title: "实习/工作经历",
      title_key: "editor.section.experience",
      kind: "entries",
      profile_section_key: "experiences",
      material_only: false,
      fields: [
        EXPERIENCE_FIELD("company", "公司", "company"),
        // 实测（2026-11-18）：目录给的是 `experiences.role`，解析接口给的是 `experiences.title`。
        EXPERIENCE_FIELD("role", "职位", "role"),
        EXPERIENCE_FIELD("period", "时间", "period", "date_range"),
        EXPERIENCE_FIELD("description", "工作内容", "description"),
      ],
    },
    {
      key: "summary",
      title: "个人简介",
      title_key: "editor.section.summary",
      kind: "text",
      profile_section_key: "summary",
      material_only: false,
      fields: [
        {
          key: "content",
          label: "个人简介",
          format: "text",
          field_type: "multi_line",
          default_placement: "body",
          material_only: false,
          private: false,
          source_field_id: "summary.content",
        },
      ],
    },
  ],
};

function section(key: string, kind: ResumeSection["kind"]): ResumeSection {
  return { key, title: key, kind, layout: defaultSectionLayout(), entries: [emptyEntry()] };
}

function documentWith(...sections: ResumeSection[]): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: { items: [], contact_breaks: [] },
    sections,
  };
}

const EXPERIENCE_DRAFT: MemoDraftSection[] = [
  {
    key: "experiences",
    name: "实习/工作经历",
    fields: [
      { field_id: "experiences.company", label: "公司", value: "字节跳动" },
      { field_id: "experiences.title", label: "职位", value: "后端开发" },
      { field_id: "experiences.start_date", label: "开始时间", value: "2023-03" },
      { field_id: "experiences.end_date", label: "结束时间", value: "2025-06" },
      { field_id: "experiences.description", label: "工作内容", value: "" },
    ],
  },
];

describe("memoProposals", () => {
  it("按 source_field_id 把草稿字段对到文档字段 key，并保留本地化标签", () => {
    const result = memoProposals(EXPERIENCE_DRAFT, CATALOG);
    expect(result.proposals).toHaveLength(1);
    const proposal = result.proposals[0];
    expect(proposal.sectionKey).toBe("experience");
    expect(proposal.values).toEqual({
      company: "字节跳动",
      role: "后端开发",
      // 起止时间在纸面上是一个 date_range 字段，值与编辑器日期控件同一套拼法。
      period: joinDateRange("2023-03", "2025-06"),
    });
    expect(proposal.labels.company).toBe("公司");
  });

  it("多条目分区解析出多条时逐条成提案", () => {
    const draft: MemoDraftSection[] = [
      {
        key: "experiences",
        name: "实习/工作经历",
        fields: [{ field_id: "experiences.company", label: "公司", value: "A 公司" }],
        entries: [
          { fields: [{ field_id: "experiences.company", label: "公司", value: "A 公司" }] },
          { fields: [{ field_id: "experiences.company", label: "公司", value: "B 公司" }] },
        ],
      },
    ];
    const result = memoProposals(draft, CATALOG);
    expect(result.proposals.map((item) => item.values.company)).toEqual(["A 公司", "B 公司"]);
  });

  it("页眉基本信息不进条目，但要计入 skippedSections（界面据此提示去资料页）", () => {
    const draft: MemoDraftSection[] = [
      {
        key: "basic_info",
        name: "基本信息",
        fields: [{ field_id: "basic_info.name", label: "姓名", value: "张三" }],
      },
    ];
    const result = memoProposals(draft, CATALOG);
    expect(result.proposals).toHaveLength(0);
    expect(result.skippedSections).toBe(1);
  });

  it("纯文本板块（个人简介）不插：一句话会覆盖整段正文", () => {
    const draft: MemoDraftSection[] = [
      {
        key: "summary",
        name: "个人简介",
        fields: [{ field_id: "summary.content", label: "个人简介", value: "五年后端经验" }],
      },
    ];
    const result = memoProposals(draft, CATALOG);
    expect(result.proposals).toHaveLength(0);
    expect(result.skippedSections).toBe(1);
  });

  it("目录里没有的字段一律丢弃（目录与后端不同步时不塞错位置）", () => {
    const draft: MemoDraftSection[] = [
      {
        key: "experiences",
        name: "实习/工作经历",
        fields: [
          { field_id: "experiences.unknown_field", label: "未知", value: "x" },
          { field_id: "experiences.company", label: "公司", value: "字节跳动" },
        ],
      },
    ];
    const result = memoProposals(draft, CATALOG);
    expect(result.proposals[0].values).toEqual({ company: "字节跳动" });
  });

  /**
   * I-20 的原始缺陷：口述「2023年6月到2024年3月，我在某某公司做后端开发」只认出公司。
   *
   * 解析结果给 `experiences.title`，纸面目录认 `experiences.role`——精确匹配必然落空，
   * 落进"后缀不是 start/end"的分支被静默丢弃。这条用例钉住**别名表**，删掉它就会红。
   */
  it("口述经历的三个字段全部落位：公司 / 角色 / 时间（I-20）", () => {
    const result = memoProposals(EXPERIENCE_DRAFT, CATALOG);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].values).toEqual({
      company: "字节跳动",
      role: "后端开发",
      period: joinDateRange("2023-03", "2025-06"),
    });
  });
});

describe("applyMemoProposals", () => {
  it("追加一条新 entry，值落到对应字段上", () => {
    const document = documentWith(section("experience", "entries"));
    const { proposals } = memoProposals(EXPERIENCE_DRAFT, CATALOG);
    const result = applyMemoProposals(document, proposals, CATALOG);
    expect(result.inserted).toBe(1);
    const entries = result.document.sections[0].entries;
    expect(entries).toHaveLength(2);
    const created = entries[1];
    const byKey = new Map(
      created.items
        .filter((item) => item.kind === "field")
        .map((item) => [item.key, item] as [string, FieldItem]),
    );
    expect(byKey.get("company")?.value).toBe("字节跳动");
    expect(byKey.get("role")?.value).toBe("后端开发");
    // I-20：插入后要能把界面定位到这条新条目，所以必须回传路径。
    expect(result.insertedPaths).toEqual([`experience.${created.id}`]);
    // 新 entry 的默认字段槽保留（与「添加一条」同形），只是被填上了值。
    expect(created.items.length).toBeGreaterThan(2);
  });

  it("同一段内容插两次不会变两条（连点不再复制）", () => {
    const document = documentWith(section("experience", "entries"));
    const { proposals } = memoProposals(EXPERIENCE_DRAFT, CATALOG);
    const first = applyMemoProposals(document, proposals, CATALOG);
    const second = applyMemoProposals(first.document, proposals, CATALOG);
    expect(second.inserted).toBe(0);
    expect(second.duplicates).toBe(1);
    // 被去重的那条**不产生路径**：否则"插入 0 条"也会把用户拉去某条旧内容。
    expect(second.insertedPaths).toEqual([]);
    expect(second.document.sections[0].entries).toHaveLength(2);
  });

  it("文档里没有这个板块时丢弃并计数（不改文档）", () => {
    const document = documentWith(section("skills", "inline"));
    const { proposals } = memoProposals(EXPERIENCE_DRAFT, CATALOG);
    const result = applyMemoProposals(document, proposals, CATALOG);
    expect(result.inserted).toBe(0);
    expect(result.dropped).toBe(1);
    expect(result.insertedPaths).toEqual([]);
    expect(result.document).toBe(document);
  });
});
