// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { entry, fieldItem, listItem, makeDocument, section, textItem } from "./documentFixtures";
import { entryDisplayLabel, summarize } from "./summarize";

describe("summarize", () => {
  it("板块 → 条目 → 位置分组（固定顺序）→ item", () => {
    const tree = summarize(makeDocument());
    expect(tree.sections.map((node) => node.key)).toEqual(["education", "summary"]);
    const education = tree.sections[0];
    expect(education.kind).toBe("section");
    const firstEntry = education.children?.[0];
    expect(firstEntry?.kind).toBe("entry");
    expect(firstEntry?.label).toBe("Tsinghua University · Computer Science");
    const groups = firstEntry?.children ?? [];
    expect(groups.map((node) => (node as { placement?: string }).placement)).toEqual([
      "title",
      "meta",
      "lead",
      "body",
    ]);
    expect(groups[0].children?.map((item) => item.itemId)).toEqual(["ob_item0001", "ob_item0002"]);
  });

  it("hidden 字段进 hidden 分组；条目隐藏与锁标记带上", () => {
    const document = makeDocument();
    document.sections[0].entries[1].hidden = true;
    document.sections[0].entries[1].lock_layout = true;
    const tree = summarize(document);
    const second = tree.sections[0].children?.[1];
    expect(second?.hidden).toBe(true);
    expect(second?.lock).toBe("layout");
    const hiddenGroup = second?.children?.find(
      (node) => (node as { placement?: string }).placement === "hidden",
    );
    expect(hiddenGroup?.children?.[0].itemId).toBe("ob_item0008");
    expect(hiddenGroup?.children?.[0].hidden).toBe(true);
  });

  it("来源标记：item.source 为 profile，否则 manual", () => {
    const document = makeDocument();
    const field = document.sections[0].entries[0].items[0];
    if (field.kind === "field") {
      field.source = { section_key: "educations", field_id: "educations.school" };
    }
    const tree = summarize(document);
    const items = tree.sections[0].children?.[0].children?.[0].children ?? [];
    expect(items[0].source).toBe("profile");
    expect(items[1].source).toBe("manual");
    expect(items[0].itemKind).toBe("field");
    expect(items[0].label).toBe("Tsinghua University");
  });

  it("includeEmptyGroups 输出空分组；includeHeader=false 不输出页眉", () => {
    const document = makeDocument();
    const tree = summarize(document, { includeEmptyGroups: true, includeHeader: false });
    expect(tree.header).toEqual([]);
    const groups = tree.sections[0].children?.[0].children ?? [];
    expect(groups.some((node) => (node as { placement?: string }).placement === "trail")).toBe(
      true,
    );
  });

  it("页眉按位置分组，label 是页眉位置枚举值", () => {
    const tree = summarize(makeDocument());
    expect(tree.header.map((node) => node.headerPlacement)).toEqual(["name", "contact"]);
    expect(tree.header[0].children?.[0].path).toBe("header.ob_head0001");
  });

  it("路径可直接用于定位 item（与 paths 的写法一致）", () => {
    const tree = summarize(makeDocument());
    const item = tree.sections[0].children?.[0].children?.[0].children?.[0];
    expect(item?.path).toBe("education.ob_entry001.ob_item0001");
  });

  it("Q20：item 没有值时用字段目录标签兜底，key 仍留在节点上作 Tooltip", () => {
    const document = makeDocument();
    const entryNode = document.sections[0].entries[0];
    // 一个只有 key 没有值的灰色短字段（真实文档：study_form / degree_type / courses…）。
    entryNode.items.push(
      fieldItem({ id: "ob_item0100", key: "study_form", placement: "trail", value: "" }),
      listItem({ id: "ob_item0101", key: "courses", placement: "trail", values: [] }),
    );
    const resolve = (key: string) =>
      ({ study_form: "学习形式", courses: "核心课程" })[key] ?? undefined;
    const tree = summarize(document, { resolveFieldLabel: resolve });
    const groups = tree.sections[0].children?.[0].children ?? [];
    const trail = groups.find((node) => node.placement === "trail");
    const items = trail?.children ?? [];
    const studyForm = items.find((node) => node.itemId === "ob_item0100");
    const courses = items.find((node) => node.itemId === "ob_item0101");
    expect(studyForm?.label).toBe("学习形式");
    expect(courses?.label).toBe("核心课程");
    // key 只作兜底；有目录标签时 Tooltip 也用中文标签，不露英文 key。
    expect(studyForm?.itemKey).toBe("study_form");
    expect(studyForm?.fieldLabel).toBe("学习形式");
    expect(courses?.fieldLabel).toBe("核心课程");
    // 有值时显示值（不是标签）。
    const lead = groups.find((node) => node.placement === "lead");
    expect(lead?.children?.find((node) => node.itemId === "ob_item0005")?.label).toBe("3.9/4.0");
  });

  it("Q20：页眉字段没有值时同样用目录标签；没有目录时退回 key", () => {
    const document = makeDocument();
    document.header.items.push({
      kind: "field",
      id: "ob_head0100",
      key: "subtitle",
      label: "",
      value: "",
      placement: "subtitle",
      format: "text",
    });
    const withCatalog = summarize(document, {
      resolveFieldLabel: (key) => (key === "subtitle" ? "求职意向" : undefined),
    });
    const subtitle = withCatalog.header
      .flatMap((node) => node.children ?? [])
      .find((node) => node.itemId === "ob_head0100");
    expect(subtitle?.label).toBe("求职意向");
    expect(subtitle?.fieldLabel).toBe("求职意向");
    const withoutCatalog = summarize(document);
    const fallback = withoutCatalog.header
      .flatMap((node) => node.children ?? [])
      .find((node) => node.itemId === "ob_head0100");
    expect(fallback?.label).toBe("subtitle");
  });

  it("Q08：entryDisplayLabel = 标题值 → 首个非空正文/文本值截断", () => {
    const withTitle = entry({ items: [fieldItem({ key: "school", value: "清华大学" })] });
    expect(entryDisplayLabel(withTitle)).toBe("清华大学");
    const bodyOnly = entry({
      items: [
        fieldItem({ id: "ob_item0200", key: "school", placement: "meta", value: "" }),
        textItem({ id: "ob_item0201", text: "负责核心链路重构并上线" }),
      ],
    });
    expect(entryDisplayLabel(bodyOnly)).toBe("负责核心链路重构并上线");
    const long = entry({
      items: [
        textItem({
          id: "ob_item0202",
          text: "这是一段很长很长的正文用来验证条目名会被截断并补省略号，避免左栏下拉一行放不下",
        }),
      ],
    });
    const label = entryDisplayLabel(long);
    expect(Array.from(label).length).toBe(32);
    expect(label.endsWith("…")).toBe(true);
    expect(entryDisplayLabel(entry({ items: [] }))).toBe("");
  });

  it("Q08：摘要里条目名与断页标记来自文档（结构树标记用）", () => {
    const document = makeDocument({
      sections: [
        section({
          entries: [
            entry({
              id: "ob_entry0200",
              layout: {
                head: "split",
                columns: null,
                align: null,
                gap: null,
                start_on_new_page: true,
              },
              items: [fieldItem({ id: "ob_item0200", placement: "title", value: "某公司" })],
            }),
            entry({
              id: "ob_entry0201",
              layout: { head: "split", columns: null, align: null, gap: null, keep_together: true },
              items: [textItem({ id: "ob_item0201", text: "第二条的正文" })],
            }),
          ],
        }),
      ],
    });
    const nodes = summarize(document).sections[0].children ?? [];
    expect(nodes[0].label).toBe("某公司");
    expect(nodes[0].startOnNewPage).toBe(true);
    expect(nodes[0].keepTogether).toBe(false);
    expect(nodes[1].label).toBe("第二条的正文");
    expect(nodes[1].keepTogether).toBe(true);
  });
});
