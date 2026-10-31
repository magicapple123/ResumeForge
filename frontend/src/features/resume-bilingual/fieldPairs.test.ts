// SPDX-License-Identifier: Apache-2.0
/**
 * 双语字段对照 / 翻译候选的 **v2 文档模型** 规则：
 * 行落在 item 路径上；列表/作者/自建字段只读；blocked_fields（v1 路径）仍能命中。
 */
import { describe, expect, it } from "vitest";
import {
  adoptItems,
  buildBilingualPairs,
  buildTranslationCandidates,
  changedPairs,
  defaultPairLabels,
  hasCustomContent,
  isAdoptableItem,
  isBinaryOrPhotoItem,
  itemText,
  undoItems,
} from "./fieldPairs";
import { MOCK_PRIMARY } from "../../test/bilingualMock";
import type { ResumeDocument } from "../../types/resumeDocument";

const LABELS = defaultPairLabels();

function clone(document: ResumeDocument): ResumeDocument {
  return structuredClone(document);
}

function withFieldValue(
  document: ResumeDocument,
  sectionKey: string,
  entryId: string,
  itemId: string,
  value: string,
): ResumeDocument {
  const next = clone(document);
  const entry = next.sections
    .find((section) => section.key === sectionKey)
    ?.entries.find((candidate) => candidate.id === entryId);
  const item = entry?.items.find((candidate) => candidate.id === itemId);
  if (item && item.kind === "field") item.value = value;
  return next;
}

function withTextValue(
  document: ResumeDocument,
  sectionKey: string,
  entryId: string,
  itemId: string,
  text: string,
): ResumeDocument {
  const next = clone(document);
  const entry = next.sections
    .find((section) => section.key === sectionKey)
    ?.entries.find((candidate) => candidate.id === entryId);
  const item = entry?.items.find((candidate) => candidate.id === itemId);
  if (item && item.kind === "text") item.text = text;
  return next;
}

function withCustomSection(document: ResumeDocument): ResumeDocument {
  const next = clone(document);
  next.sections.push({
    key: "custom:aaaaaaaa-1111-2222-3333-444444444444",
    title: "Side projects",
    kind: "entries",
    layout: { ...next.sections[0].layout },
    entries: [
      {
        id: "custom_entry_01",
        hidden: false,
        lock_content: false,
        lock_layout: false,
        layout: { head: "split", columns: null, align: null, gap: null },
        items: [
          {
            kind: "text",
            id: "custom_text_01",
            style: "paragraph",
            text: "Volunteer mentoring.",
            hidden: false,
          },
          {
            kind: "field",
            id: "custom_field_01",
            key: "custom:cccccccc-1111-2222-3333-444444444444",
            label: "Certification",
            value: "PMP",
            placement: "trail",
            format: "text",
            wrap: "none",
            show_label: true,
            solo: false,
            body_style: "bullet",
            source: null,
          },
        ],
      },
    ],
  });
  return next;
}

describe("buildBilingualPairs（v2 item 路径）", () => {
  it("页眉与条目都按 item 路径出对照行，标签走提供的解析器", () => {
    const translated = withFieldValue(
      MOCK_PRIMARY,
      "experience",
      "mock_exp_01",
      "mock_exp_company",
      "Cloud Commerce Inc",
    );
    const pairs = buildBilingualPairs(MOCK_PRIMARY, translated, LABELS);
    const byPath = new Map(pairs.map((pair) => [pair.path, pair]));

    const namePair = byPath.get("header.mock_head_name");
    expect(namePair?.label).toBe("name");
    expect(namePair?.status).toBe("same");
    const company = byPath.get("experience.mock_exp_01.mock_exp_company");
    expect(company?.status).toBe("changed");
    expect(company?.primary).toBe("Cloud Commerce Ltd");
    expect(company?.secondary).toBe("Cloud Commerce Inc");
    expect(company?.adoptable).toBe(true);
    expect(company?.locked).toBe(true);
    const text = byPath.get("experience.mock_exp_01.mock_exp_text");
    expect(text?.adoptable).toBe(true);
    // 默认解析器对没有 key 的文本块给空串显示名；真实组件会按目录/文案补"正文段落"。
    expect(text?.label).toBe("");
  });

  it("某侧多出的条目也出行（另一侧为空串）", () => {
    const shorter: ResumeDocument = {
      ...clone(MOCK_PRIMARY),
      sections: MOCK_PRIMARY.sections.filter((section) => section.key !== "summary"),
    };
    const pairs = buildBilingualPairs(shorter, MOCK_PRIMARY, LABELS);
    const summary = pairs.find((pair) => pair.path.startsWith("summary."));
    expect(summary).toBeTruthy();
    expect(summary?.primary).toBe("");
    expect(summary?.status).toBe("changed");
  });

  it("条目 id 不同时按位置对齐（对照只做展示）", () => {
    const other = clone(MOCK_PRIMARY);
    const education = other.sections.find((section) => section.key === "education");
    if (education?.entries[0]) education.entries[0].id = "other_entry_01";
    const pairs = buildBilingualPairs(MOCK_PRIMARY, other, LABELS);
    const row = pairs.find((pair) => pair.label === "school");
    expect(row?.primary).toBe("Example University");
    expect(row?.secondary).toBe("Example University");
  });

  it("自建板块/自定义字段只读展示：不参与逐项采纳", () => {
    const custom = withCustomSection(MOCK_PRIMARY);
    const pairs = buildBilingualPairs(MOCK_PRIMARY, custom, LABELS);
    const customText = pairs.find((pair) => pair.path.includes("custom_text_01"));
    const customField = pairs.find((pair) => pair.path.includes("custom_field_01"));
    expect(customText?.adoptable).toBe(false);
    expect(customField?.adoptable).toBe(false);
    expect(hasCustomContent(custom)).toBe(true);
    expect(hasCustomContent(MOCK_PRIMARY)).toBe(false);
  });

  it("照片 / data URL 字段不进对照（Q23）", () => {
    const withPhoto = clone(MOCK_PRIMARY);
    withPhoto.header.items.push({
      kind: "field",
      id: "mock_head_photo",
      key: "photo",
      label: "",
      value: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      placement: "photo",
      format: "text",
    });
    const withDataUrl = clone(MOCK_PRIMARY);
    withDataUrl.header.items.push({
      kind: "field",
      id: "mock_head_attachment",
      key: "custom_attachment",
      label: "附件",
      value: "data:text/plain;base64,aGVsbG8=",
      placement: "hidden",
      format: "text",
    });
    const pairs = buildBilingualPairs(withPhoto, withDataUrl, LABELS);
    // 照片字段本身不产对照行；任何以 data: 开头的值都不得出现在两列里。
    expect(pairs.some((pair) => pair.path === "header.mock_head_photo")).toBe(false);
    expect(
      pairs.some((pair) => pair.primary.startsWith("data:") || pair.secondary.startsWith("data:")),
    ).toBe(false);
    expect(isBinaryOrPhotoItem(withPhoto.header.items[withPhoto.header.items.length - 1])).toBe(
      true,
    );
    expect(isBinaryOrPhotoItem(withDataUrl.header.items[withDataUrl.header.items.length - 1])).toBe(
      true,
    );
    // 普通字段仍照常进对照（修复不能把 header 整段跳过）。
    expect(pairs.some((pair) => pair.path === "header.mock_head_name")).toBe(true);
  });

  it("changedPairs 过滤两边都空的行", () => {
    const empty: ResumeDocument = {
      version: 2,
      language: "zh-CN",
      header: { items: [], contact_breaks: [] },
      sections: [],
    };
    expect(changedPairs(buildBilingualPairs(empty, empty, LABELS))).toEqual([]);
  });

  it("itemText：字段取值、列表换行、作者逗号连接", () => {
    expect(
      itemText({
        kind: "field",
        id: "x",
        key: "k",
        label: "",
        value: " v ",
        placement: "trail",
        format: "text",
        wrap: "none",
        show_label: true,
        solo: false,
        body_style: "bullet",
        source: null,
      }),
    ).toBe("v");
    expect(
      itemText({
        kind: "list",
        id: "l",
        key: "courses",
        label: "",
        values: ["A", "B"],
        placement: "lead",
        join: "semicolon",
        show_label: true,
        solo: false,
        body_style: "bullet",
      }),
    ).toBe("A\nB");
    expect(
      itemText({
        kind: "authors",
        id: "a",
        key: "authors",
        label: "",
        authors: [
          { name: "Alice", is_self: false, corresponding: false },
          { name: "Bob", is_self: true, corresponding: true },
        ],
        placement: "trail",
        show_label: false,
        solo: false,
      }),
    ).toBe("Alice, Bob");
    expect(
      isAdoptableItem("education", {
        kind: "text",
        id: "t",
        style: "bullet",
        text: "x",
        hidden: false,
      }),
    ).toBe(true);
  });
});

describe("buildTranslationCandidates（v2）", () => {
  const translated = withFieldValue(
    withTextValue(
      MOCK_PRIMARY,
      "experience",
      "mock_exp_01",
      "mock_exp_text",
      "Cut API latency by half.",
    ),
    "experience",
    "mock_exp_01",
    "mock_exp_role",
    "Backend Engineer",
  );

  it("只列真变了的可采纳 item，路径是 v2 item 路径", () => {
    const candidates = buildTranslationCandidates(MOCK_PRIMARY, translated, [], LABELS);
    const paths = candidates.map((candidate) => candidate.path);
    expect(paths).toContain("experience.mock_exp_01.mock_exp_text");
    expect(paths).toContain("experience.mock_exp_01.mock_exp_role");
    expect(candidates.every((candidate) => candidate.before !== candidate.after)).toBe(true);
    const role = candidates.find((candidate) => candidate.path.endsWith("mock_exp_role"));
    expect(role?.after).toBe("Backend Engineer");
    expect(role?.blocked).toBe(false);
  });

  it("blocked_fields（v1 路径）命中同一个 item 时禁用它", () => {
    const candidates = buildTranslationCandidates(
      MOCK_PRIMARY,
      translated,
      ["experience.0.role"],
      LABELS,
    );
    const role = candidates.find((candidate) => candidate.path.endsWith("mock_exp_role"));
    expect(role?.blocked).toBe(true);
    const text = candidates.find((candidate) => candidate.path.endsWith("mock_exp_text"));
    expect(text?.blocked).toBe(false);
  });

  it("自建板块不进入候选（即使内容变了）", () => {
    const custom = withCustomSection(MOCK_PRIMARY);
    const translatedCustom = withCustomSection(
      withTextValue(MOCK_PRIMARY, "summary", "mock_summary_01", "mock_summary_text", "Changed."),
    );
    const customEntry = translatedCustom.sections[translatedCustom.sections.length - 1]?.entries[0];
    const customText = customEntry?.items.find((item) => item.kind === "text");
    if (customText && customText.kind === "text") customText.text = "Volunteer mentoring (en).";
    const candidates = buildTranslationCandidates(custom, translatedCustom, [], LABELS);
    expect(candidates.some((candidate) => candidate.path.startsWith("custom:"))).toBe(false);
    const summary = candidates.find((candidate) => candidate.path.startsWith("summary."));
    expect(summary?.after).toBe("Changed.");
  });

  it("采纳/撤销 items 用同一批路径与前后文本", () => {
    const candidates = buildTranslationCandidates(MOCK_PRIMARY, translated, [], LABELS);
    const adopted = adoptItems(candidates, [candidates[0].path]);
    expect(adopted).toHaveLength(1);
    expect(adopted[0].text).toBe(candidates[0].after);
    const undo = undoItems(
      candidates,
      adopted.map((item) => item.path),
    );
    expect(undo).toHaveLength(1);
    expect(undo[0].text).toBe(candidates[0].before);
  });
});
