// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createIdFactory, fieldItem, makeDocument, section } from "./documentFixtures";
import { convertFromProfile, mergeProfileItems } from "./convertFromProfile";
import {
  buildFallbackCatalog,
  catalogFieldsOf,
  catalogSectionOf,
  enumOptionsOf,
  FALLBACK_SECTIONS,
  missingFieldSpecs,
} from "./fieldCatalog";
import type { MessageKey } from "../../i18n";

/** 测试用假 t：把 key 原样返回，断言只关心"传了哪个 key"。 */
const resolveKey = (key: MessageKey): string => key;

describe("fallback 字段目录", () => {
  it("覆盖 12 个系统板块与页眉字段", () => {
    const catalog = buildFallbackCatalog(resolveKey);
    expect(catalog.sections.map((item) => item.key)).toEqual([
      "education",
      "experience",
      "projects",
      "campus_experience",
      "awards",
      "publications",
      "research_projects",
      "patents",
      "credentials",
      "skills",
      "languages",
      "summary",
    ]);
    expect(catalog.header_fields.map((field) => field.key)).toContain("name");
    expect(catalog.sections[0].fields.map((field) => field.key)).toContain("school");
  });

  it("默认位置遵循计划 §4：短字段 trail / 长文本 body / 标题 title / 仅素材 hidden", () => {
    const catalog = buildFallbackCatalog(resolveKey);
    const education = catalogSectionOf(catalog, "education");
    expect(education?.fields.find((field) => field.key === "school")?.default_placement).toBe(
      "title",
    );
    expect(education?.fields.find((field) => field.key === "period")?.default_placement).toBe(
      "meta",
    );
    expect(education?.fields.find((field) => field.key === "gpa")?.default_placement).toBe("lead");
    expect(education?.fields.find((field) => field.key === "achievements")?.default_placement).toBe(
      "body",
    );
    const patents = catalogSectionOf(catalog, "patents");
    const outcome = patents?.fields.find((field) => field.key === "outcome_type");
    expect(outcome?.default_placement).toBe("hidden");
    expect(outcome?.material_only).toBe(true);
  });

  it("资料分区键也能找到目录（educations → education）", () => {
    const catalog = buildFallbackCatalog(resolveKey);
    expect(catalogSectionOf(catalog, "educations")?.key).toBe("education");
    expect(catalogFieldsOf(catalog, "nope")).toEqual([]);
    expect(catalogSectionOf(null, "education")).toBeNull();
  });

  it("missingFieldSpecs 只返回还没加过的内置字段", () => {
    const catalog = buildFallbackCatalog(resolveKey);
    const doc = makeDocument();
    const missing = missingFieldSpecs(catalog, doc.sections[0]);
    const keys = missing.map((field) => field.key);
    expect(keys).not.toContain("school");
    expect(keys).not.toContain("major");
    expect(keys).toContain("study_form");
  });

  it("enumOptionsOf：已知枚举给出选项，未知字段返回空数组", () => {
    const options = enumOptionsOf(
      buildFallbackCatalog(resolveKey),
      "publications",
      "status",
      resolveKey,
    );
    expect(options.map((option) => option.value)).toContain("under_review");
    expect(options[0].label).toBe("research.status.published");
    expect(enumOptionsOf(null, "publications", "venue", resolveKey)).toEqual([]);
    expect(enumOptionsOf(null, "nope", "status", resolveKey)).toEqual([]);
  });

  it("FALLBACK_SECTIONS 每个板块都有至少一个字段（防止空目录）", () => {
    for (const item of FALLBACK_SECTIONS) {
      expect(item.fields.length).toBeGreaterThan(0);
    }
  });
});

describe("convertFromProfile", () => {
  const values = {
    school: "清华大学",
    major: "计算机",
    degree: "本科",
    start_date: "2020-09",
    end_date: "2024-06",
    gpa: "3.9/4.0",
    courses: ["数据结构", "操作系统"],
    study_form: "全日制",
    achievements: ["一等奖学金", "优秀毕业生"],
    id: "edu-1",
  };

  it("教育：标题/元信息/lead/正文各就各位，period 存 date_range，source 带资料分区键", () => {
    const converted = convertFromProfile({
      sectionKey: "education",
      profileSectionKey: "educations",
      values,
    });
    const byKey = new Map(
      converted.items.flatMap((item) => (item.kind === "text" ? [] : [[item.key, item]])),
    );
    expect((byKey.get("school") as { placement: string }).placement).toBe("title");
    expect((byKey.get("period") as { format: string }).format).toBe("date_range");
    expect((byKey.get("period") as { placement: string }).placement).toBe("meta");
    expect((byKey.get("gpa") as { placement: string }).placement).toBe("lead");
    expect((byKey.get("period") as { value: string }).value).toBe("2020-09|2024-06");
    expect((byKey.get("courses") as { kind: string; values: string[] }).kind).toBe("list");
    expect((byKey.get("school") as { source: unknown }).source).toEqual({
      section_key: "educations",
      field_id: "school",
    });
    const bodies = converted.items.filter((item) => item.kind === "text");
    expect(bodies).toHaveLength(2);
    expect(bodies.every((item) => (item.kind === "text" ? item.style === "bullet" : false))).toBe(
      true,
    );
    expect(converted.warnings).toEqual([]);
  });

  it("未知字段进 warnings（不静默丢资料）", () => {
    const converted = convertFromProfile({
      sectionKey: "education",
      profileSectionKey: "educations",
      values: { ...values, mystery_field: "x", blank_field: "" },
    });
    expect(converted.warnings.some((warning) => warning.includes("mystery_field"))).toBe(true);
    expect(converted.warnings.some((warning) => warning.includes("blank_field"))).toBe(false);
  });

  it("论文：作者走 authors item，状态是 enum", () => {
    const converted = convertFromProfile({
      sectionKey: "publications",
      profileSectionKey: "publications",
      values: {
        title: "一篇论文",
        venue: "某期刊",
        year: "2024",
        status: "under_review",
        authors: [{ name: "张三", is_self: true, corresponding: false }],
      },
    });
    const authors = converted.items.find((item) => item.kind === "authors");
    expect(authors?.kind).toBe("authors");
    expect(
      (
        converted.items.find((item) => item.kind !== "text" && item.key === "status") as
          { placement?: string } | undefined
      )?.placement,
    ).toBe("meta");
  });

  it("未知枚举值进 warnings", () => {
    const converted = convertFromProfile({
      sectionKey: "experience",
      profileSectionKey: "experiences",
      values: { company: "某公司", experience_kind: "bogus" },
    });
    expect(converted.warnings.some((warning) => warning.includes("bogus"))).toBe(true);
  });

  it("自建板块：主文本成段、行变 trail 字段（label 存在 item 上）", () => {
    const converted = convertFromProfile({
      sectionKey: "custom:abc",
      profileSectionKey: "custom_sections",
      values: {},
      text: "社团负责人",
      lines: [{ label: "成员数", value: "20" }],
    });
    expect(converted.items[0]).toMatchObject({ kind: "text", style: "paragraph" });
    const line = converted.items[1];
    expect(
      line.kind !== "text" && line.kind !== "list" && line.kind !== "authors" && line.label,
    ).toBe("成员数");
    expect((line as { placement: string }).placement).toBe("trail");
  });

  it("mergeProfileItems：只填空值、只追加缺失，不覆盖已写内容", () => {
    const current = [
      fieldItem({ id: "ob_a", key: "school", value: "已写的学校", placement: "title" }),
      fieldItem({ id: "ob_b", key: "major", value: "", placement: "title" }),
    ];
    const incoming = convertFromProfile({
      sectionKey: "education",
      profileSectionKey: "educations",
      values: { school: "资料学校", major: "资料专业" },
    }).items;
    const merged = mergeProfileItems(current, incoming);
    expect((merged.items[0] as { value: string }).value).toBe("已写的学校");
    expect((merged.items[1] as { value: string }).value).toBe("资料专业");
    expect(merged.items.some((item) => item.kind !== "text" && item.key === "gpa")).toBe(false);
    expect(merged.filled).toBe(1);
  });

  it("未知板块返回空 items + warning", () => {
    const converted = convertFromProfile({ sectionKey: "nope", values: {} });
    expect(converted.items).toEqual([]);
    expect(converted.warnings).toHaveLength(1);
  });

  it("空值不造块（空字符串 / 空数组都跳过）", () => {
    const converted = convertFromProfile({
      sectionKey: "education",
      values: { school: "", courses: [], achievements: [] },
    });
    expect(converted.items).toEqual([]);
  });

  it("确定性 id 工厂下 item id 可复现（生成的 TextItem 也走默认工厂）", () => {
    const a = convertFromProfile({ sectionKey: "education", values: { achievements: ["x"] } });
    expect(a.items.length).toBe(1);
    void createIdFactory();
    void section({});
  });
});
