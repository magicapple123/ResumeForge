// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ResumeDocument, ResumeEntry, ResumeItem } from "../../../types/resumeDocument";
import type { StructureNode } from "../../../features/resume-document/summarize";
import {
  applyDrop,
  duplicateEntry,
  itemDropIndex,
  moveEntryOneStep,
  moveItemOneStep,
  resolveDropIntent,
  toggleNodeHidden,
  toggleNodeLock,
} from "./structureCommands";

function makeField(
  id: string,
  key: string,
  value: string,
  placement: "title" | "meta" | "lead" | "trail" | "body" | "hidden",
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
    source: { section_key: "educations", field_id: key },
    body_style: "bullet",
  };
}

function makeEntry(id: string, items: ResumeItem[]): ResumeEntry {
  return {
    id,
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: { head: "split", columns: null, align: null, gap: null },
    items,
  };
}

function makeDocument(): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: {
      items: [
        {
          kind: "field",
          id: "header_name_01",
          key: "name",
          label: "",
          value: "张三",
          placement: "name",
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
          makeEntry("entry_edu_01", [
            makeField("school_01", "school", "上海大学", "title"),
            makeField("major_01", "major", "计算机", "title"),
            makeField("degree_01", "degree", "本科", "meta"),
            makeField("gpa_001", "gpa", "3.8", "lead"),
            makeField("study_01", "study_form", "全日制", "trail"),
          ]),
          makeEntry("entry_edu_02", [makeField("school_02", "school", "复旦大学", "title")]),
        ],
      },
      {
        key: "projects",
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
        entries: [makeEntry("entry_proj_1", [makeField("pname_01", "name", "项目甲", "title")])],
      },
    ],
  };
}

function node(
  partial: Partial<StructureNode> & Pick<StructureNode, "kind" | "key" | "path">,
): StructureNode {
  return { label: "", ...partial };
}

describe("structureCommands · item 组内下标", () => {
  const items = [
    { id: "a", kind: "field", placement: "title" as const },
    { id: "b", kind: "field", placement: "title" as const },
    { id: "c", kind: "field", placement: "title" as const },
  ];

  it("排除被拖条目后按目标位置算插入点", () => {
    expect(itemDropIndex(items, "a", "title", "c", "after")).toBe(2);
    expect(itemDropIndex(items, "a", "title", "c", "before")).toBe(1);
    expect(itemDropIndex(items, "b", "title", "a", "before")).toBe(0);
  });

  it("没有目标 item 时追加到组末尾", () => {
    expect(itemDropIndex(items, "b", "title", null, "inside")).toBe(2);
  });

  it("目标不在该组时追加到组末尾", () => {
    expect(itemDropIndex(items, "a", "trail", "b", "before")).toBe(0);
  });
});

describe("structureCommands · 隐藏与锁定", () => {
  it("隐藏字段 = placement 改为 hidden；再点一次回 trail", () => {
    const doc = makeDocument();
    const itemNode = node({
      kind: "item",
      key: "education.entry_edu_01.school_01",
      path: "education.entry_edu_01.school_01",
      entryId: "entry_edu_01",
      sectionKey: "education",
      itemId: "school_01",
    });
    const hidden = toggleNodeHidden(doc, itemNode);
    expect(hidden.changed).toBe(true);
    const hiddenItem = hidden.document.sections[0].entries[0].items.find(
      (item) => item.id === "school_01",
    ) as { placement: string };
    expect(hiddenItem.placement).toBe("hidden");
    const shown = toggleNodeHidden(hidden.document, itemNode);
    const shownItem = shown.document.sections[0].entries[0].items.find(
      (item) => item.id === "school_01",
    ) as { placement: string };
    expect(shownItem.placement).toBe("trail");
  });

  it("隐藏条目 = entry.hidden 取反，返回新文档", () => {
    const doc = makeDocument();
    const entryNode = node({
      kind: "entry",
      key: "education.entry_edu_01",
      path: "education.entry_edu_01",
      entryId: "entry_edu_01",
      sectionKey: "education",
    });
    const result = toggleNodeHidden(doc, entryNode);
    expect(result.document).not.toBe(doc);
    expect(result.document.sections[0].entries[0].hidden).toBe(true);
  });

  it("锁定内容/排版互不影响", () => {
    const doc = makeDocument();
    const entryNode = node({
      kind: "entry",
      key: "education.entry_edu_01",
      path: "education.entry_edu_01",
      entryId: "entry_edu_01",
      sectionKey: "education",
    });
    const locked = toggleNodeLock(doc, entryNode, "content").document;
    expect(locked.sections[0].entries[0].lock_content).toBe(true);
    const both = toggleNodeLock(locked, entryNode, "layout").document;
    expect(both.sections[0].entries[0].lock_layout).toBe(true);
    expect(both.sections[0].entries[0].lock_content).toBe(true);
  });
});

describe("structureCommands · 复制与移动", () => {
  const entryNode = (path: string): StructureNode =>
    node({ kind: "entry", key: path, path, sectionKey: "education", entryId: path.split(".")[1] });

  it("复制条目：插在原条目后面并返回新条目路径", () => {
    const doc = makeDocument();
    const result = duplicateEntry(doc, entryNode("education.entry_edu_01"));
    const entries = result.document.sections[0].entries;
    expect(entries).toHaveLength(3);
    expect(result.selectPath).toMatch(/^education\./);
    expect(entries[1].id).toBe(result.selectPath?.split(".")[1]);
    // 复制出来的条目身份全新（id 不重复）
    const ids = new Set(entries.map((entry) => entry.id));
    expect(ids.size).toBe(3);
  });

  it("条目上移/下移到边界返回原引用", () => {
    const doc = makeDocument();
    const first = moveEntryOneStep(doc, entryNode("education.entry_edu_01"), -1);
    expect(first.changed).toBe(false);
    const second = moveEntryOneStep(doc, entryNode("education.entry_edu_01"), 1);
    expect(second.changed).toBe(true);
    expect(second.document.sections[0].entries[0].id).toBe("entry_edu_02");
    const last = moveEntryOneStep(second.document, entryNode("education.entry_edu_01"), 1);
    expect(last.changed).toBe(false);
  });

  it("字段同组上下移；跨位置分组用 setPlacement", () => {
    const doc = makeDocument();
    const major = node({
      kind: "item",
      key: "education.entry_edu_01.major_01",
      path: "education.entry_edu_01.major_01",
      entryId: "entry_edu_01",
      sectionKey: "education",
      itemId: "major_01",
    });
    const moved = moveItemOneStep(doc, major, -1);
    expect(moved.changed).toBe(true);
    expect(moved.document.sections[0].entries[0].items[0].id).toBe("major_01");
  });
});

describe("structureCommands · 拖拽落点", () => {
  it("同条目跨组：字段拖到 meta 分组行 → placement 改为 meta", () => {
    const doc = makeDocument();
    const drag = node({
      kind: "item",
      key: "education.entry_edu_01.school_01",
      path: "education.entry_edu_01.school_01",
      entryId: "entry_edu_01",
      sectionKey: "education",
      itemId: "school_01",
    });
    const target = node({
      kind: "group",
      key: "education.entry_edu_01.#meta",
      path: null,
      entryId: "entry_edu_01",
      sectionKey: "education",
      placement: "meta",
    });
    const result = applyDrop(doc, drag, target, "inside");
    expect(result.changed).toBe(true);
    const moved = result.document.sections[0].entries[0].items.find(
      (item) => item.id === "school_01",
    ) as { placement: string };
    expect(moved.placement).toBe("meta");
  });

  it("跨条目拖字段被拒绝（返回原引用，面板给可读提示）", () => {
    const doc = makeDocument();
    const drag = node({
      kind: "item",
      key: "education.entry_edu_01.school_01",
      path: "education.entry_edu_01.school_01",
      entryId: "entry_edu_01",
      sectionKey: "education",
    });
    const target = node({
      kind: "group",
      key: "education.entry_edu_02.#title",
      path: null,
      entryId: "entry_edu_02",
      sectionKey: "education",
      placement: "title",
    });
    expect(resolveDropIntent(doc, drag, target, "inside")).toBeNull();
    expect(applyDrop(doc, drag, target, "inside").changed).toBe(false);
  });

  it("跨板块拖条目被拒绝", () => {
    const doc = makeDocument();
    const drag = node({
      kind: "entry",
      key: "education.entry_edu_01",
      path: "education.entry_edu_01",
      sectionKey: "education",
      entryId: "entry_edu_01",
    });
    const target = node({
      kind: "entry",
      key: "projects.entry_proj_1",
      path: "projects.entry_proj_1",
      sectionKey: "projects",
      entryId: "entry_proj_1",
    });
    expect(resolveDropIntent(doc, drag, target, "before")).toBeNull();
  });

  it("条目拖到同板块另一条目之前 → 顺序改变", () => {
    const doc = makeDocument();
    const drag = node({
      kind: "entry",
      key: "education.entry_edu_02",
      path: "education.entry_edu_02",
      sectionKey: "education",
      entryId: "entry_edu_02",
    });
    const target = node({
      kind: "entry",
      key: "education.entry_edu_01",
      path: "education.entry_edu_01",
      sectionKey: "education",
      entryId: "entry_edu_01",
    });
    const result = applyDrop(doc, drag, target, "before");
    expect(result.changed).toBe(true);
    expect(result.document.sections[0].entries[0].id).toBe("entry_edu_02");
  });
});
