// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { makeDocument } from "./documentFixtures";
import {
  ensureIds,
  asItemFormat,
  asPlacement,
  entryHasContent,
  itemHasContent,
  normalizeDocument,
  normalizeEntryLayout,
  normalizeSectionLayout,
} from "./normalize";
import { createIdFactory } from "./documentFixtures";
import type { ResumeDocument } from "../../types/resumeDocument";

describe("ensureIds", () => {
  it("补齐缺失的条目 id 与 item id，已有合法 id 原样保留", () => {
    const document = makeDocument();
    (document.sections[0].entries[0] as { id: string | null }).id = null;
    document.sections[0].entries[0].items[0].id = "invalid id!";
    document.sections[0].entries[1].id = "ob_keep0001";
    const fixed = ensureIds(document, createIdFactory("ob_"));
    expect(fixed.sections[0].entries[0].id).toBe("ob_00000001");
    expect(fixed.sections[0].entries[0].items[0].id).toBe("ob_00000002");
    expect(fixed.sections[0].entries[1].id).toBe("ob_keep0001");
    // 页眉 item 无 id 时补；已有合法 id 不动。
    const headerIds = fixed.header.items.map((item) => item.id);
    expect(headerIds).toContain("ob_head0001");
    expect(new Set(headerIds).size).toBe(headerIds.length);
  });

  it("幂等：连续两次调用逐字段相同", () => {
    const once = ensureIds(makeDocument(), createIdFactory("ob_"));
    const twice = ensureIds(once, createIdFactory("zz_"));
    expect(twice).toEqual(once);
  });

  it("不删任何 item（空值也保留）", () => {
    const document = makeDocument();
    document.sections[0].entries[0].items.push({
      kind: "field",
      id: "ob_empty001",
      key: "gpa",
      label: "",
      value: "",
      placement: "trail",
      format: "text",
      wrap: "none",
      show_label: true,
      solo: false,
      source: null,
      body_style: "bullet",
    });
    const fixed = ensureIds(document, createIdFactory("ob_"));
    expect(fixed.sections[0].entries[0].items).toHaveLength(7);
  });
});

describe("normalizeDocument（读取/保存口径）", () => {
  it("去掉空 item → 空 entry → 空 section，并保留 hidden 位置的数据", () => {
    const document = makeDocument();
    // 第三条 entry 只有空字段：整条应被删。
    document.sections[0].entries.push({
      ...document.sections[0].entries[0],
      id: "ob_entryBlank",
      items: [
        {
          kind: "field",
          id: "ob_blank0001",
          key: "school",
          label: "",
          value: "   ",
          placement: "title",
          format: "text",
          wrap: "none",
          show_label: false,
          solo: false,
          source: null,
          body_style: "bullet",
        },
      ],
    });
    // 空板块应被删。
    document.sections.push({
      key: "skills",
      title: "",
      kind: "inline",
      layout: document.sections[0].layout,
      entries: [],
    });
    const normalized = normalizeDocument(document, createIdFactory("ob_"));
    expect(normalized.sections.map((item) => item.key)).toEqual(["education", "summary"]);
    expect(normalized.sections[0].entries).toHaveLength(2);
    // hidden 位置有值 → 保留。
    const hidden = normalized.sections[0].entries[1].items.find(
      (item) => (item as { placement?: string }).placement === "hidden",
    );
    expect(hidden).toBeDefined();
  });

  it("非法枚举落回默认值；未知 item kind 丢弃", () => {
    const document = makeDocument() as ResumeDocument & {
      sections: (ResumeDocument["sections"][number] & { kind: string })[];
    };
    (document.sections[0] as { kind: string }).kind = "bogus";
    document.sections[0].layout = { columns: 9, align: "bogus", gap: Number.NaN } as never;
    document.sections[0].entries[0].layout = { head: "bogus" } as never;
    document.sections[0].entries[0].items.push({ kind: "mystery", id: "ob_mystery1" } as never);
    const normalized = normalizeDocument(document, createIdFactory("ob_"));
    expect(normalized.sections[0].kind).toBe("entries");
    expect(normalized.sections[0].layout.columns).toBe(1);
    expect(normalized.sections[0].layout.align).toBe("equal");
    expect(normalized.sections[0].layout.gap).toBeNull();
    expect(normalized.sections[0].entries[0].layout.head).toBe("split");
    expect(
      normalized.sections[0].entries[0].items.some(
        (item) => (item as { kind: string }).kind === "mystery",
      ),
    ).toBe(false);
  });

  it("列表 / 作者 / 文本三类空值都按同一判据清掉", () => {
    const document = makeDocument();
    document.sections[0].entries[0].items = [
      {
        kind: "list",
        id: "ob_listblank",
        key: "courses",
        label: "",
        values: ["", "  "],
        placement: "lead",
        join: "semicolon",
        show_label: true,
        solo: false,
        body_style: "bullet",
      },
      {
        kind: "authors",
        id: "ob_authblank",
        key: "authors",
        label: "",
        authors: [{ name: " ", is_self: false, corresponding: false }],
        placement: "trail",
        show_label: false,
        solo: false,
      },
      { kind: "text", id: "ob_textblank", style: "bullet", text: " ", hidden: false },
    ];
    const normalized = normalizeDocument(document, createIdFactory("ob_"));
    // 第一条 entry 的三个空 item 全被清掉后整条消失；第二条 entry 仍有内容。
    expect(normalized.sections[0].entries.map((item) => item.id)).toEqual(["ob_entry002"]);
  });

  it("contact_breaks 与语言原样保留", () => {
    const document = makeDocument();
    document.language = "en-US";
    document.header.contact_breaks = ["phone", "email"];
    const normalized = normalizeDocument(document, createIdFactory("ob_"));
    expect(normalized.language).toBe("en-US");
    expect(normalized.header.contact_breaks).toEqual(["phone", "email"]);
  });
});

describe("防御性读取帮助", () => {
  it("asPlacement / asItemFormat 只接受合法值", () => {
    expect(asPlacement("title")).toBe("title");
    expect(asPlacement("bogus")).toBe("trail");
    expect(asPlacement(undefined, "body")).toBe("body");
    expect(asItemFormat("date_range")).toBe("date_range");
    expect(asItemFormat("bogus")).toBe("text");
  });

  it("normalizeSectionLayout / normalizeEntryLayout 缺字段补默认", () => {
    expect(normalizeSectionLayout(undefined)).toEqual({
      columns: 1,
      align: "equal",
      gap: null,
      hide_title: false,
      keep_together: false,
      start_on_new_page: false,
      title_override: "",
    });
    expect(normalizeEntryLayout({ head: "stacked", columns: 2 }).head).toBe("stacked");
    expect(normalizeEntryLayout({}).head).toBe("split");
    // 条目级分页（task-14）：true 才保留，缺省/非法值一律 false（与后端默认值一致）。
    expect(normalizeEntryLayout({ start_on_new_page: true, keep_together: true })).toMatchObject({
      start_on_new_page: true,
      keep_together: true,
    });
    expect(normalizeEntryLayout({ start_on_new_page: "yes" })).toMatchObject({
      start_on_new_page: false,
      keep_together: false,
    });
  });

  it("itemHasContent / entryHasContent 的空值判据覆盖四种 kind", () => {
    const document = makeDocument();
    const [first, second] = document.sections[0].entries;
    expect(itemHasContent(first.items[0])).toBe(true);
    expect(entryHasContent(first)).toBe(true);
    expect(
      itemHasContent({
        kind: "text",
        id: "ob_textblank",
        style: "bullet",
        text: "  ",
        hidden: false,
      }),
    ).toBe(false);
    expect(
      entryHasContent({
        id: "ob_blankentry",
        hidden: false,
        lock_content: false,
        lock_layout: false,
        layout: { head: "split" },
        items: [],
      }),
    ).toBe(false);
    expect(second.items).toHaveLength(2);
  });
});
