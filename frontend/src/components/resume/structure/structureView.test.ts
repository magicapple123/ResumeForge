// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  ancestorKeys,
  collectExpandableKeys,
  countTree,
  flattenVisible,
  nextRowKey,
  searchTree,
  type StructureViewNode,
  type StructureViewTree,
} from "./structureView";

function item(
  path: string,
  label: string,
  placement: "title" | "meta" | "lead" | "trail" | "body" | "hidden",
  source?: "profile" | "manual",
): StructureViewNode {
  return {
    kind: "item",
    key: itemKey(path),
    path,
    label,
    placement,
    itemKind: "field",
    source,
    itemId: path.split(".").pop(),
  };
}

function itemKey(path: string): string {
  return "item:" + path;
}

function group(
  entryPath: string,
  placement: "title" | "meta" | "lead" | "trail" | "body" | "hidden",
  children: StructureViewNode[],
): StructureViewNode {
  return {
    kind: "group",
    key: "group:" + entryPath + "." + placement,
    path: entryPath,
    label: placement,
    placement,
    children,
  };
}

const education: StructureViewNode = {
  kind: "section",
  key: "section:education",
  path: "education",
  label: "教育经历",
  sectionKey: "education",
  children: [
    {
      kind: "entry",
      key: "entry:education.entry_1",
      path: "education.entry_1",
      label: "上海大学",
      sectionKey: "education",
      entryId: "entry_1",
      source: "profile",
      children: [
        group("education.entry_1", "title", [
          item("education.entry_1.school_1", "学校", "title", "profile"),
        ]),
        group("education.entry_1", "meta", [item("education.entry_1.degree_1", "学历", "meta")]),
        group("education.entry_1", "trail", [
          item("education.entry_1.study_1", "学习形式", "trail"),
          item("education.entry_1.dept_1", "学院", "trail"),
        ]),
        group("education.entry_1", "hidden", [item("education.entry_1.rank_1", "排名", "hidden")]),
      ],
    },
  ],
};

const headerGroup: StructureViewNode = {
  kind: "group",
  key: "header.#name",
  path: null,
  label: "name",
  children: [
    {
      kind: "item",
      key: "header.header.name_1",
      path: "header.name_1",
      label: "姓名",
      itemId: "name_1",
      itemKind: "field",
    },
  ],
};

const project: StructureViewNode = {
  kind: "section",
  key: "section:custom:abc123",
  path: "custom:abc123",
  label: "开源项目",
  sectionKey: "custom:abc123",
  children: [
    {
      kind: "entry",
      key: "entry:custom:abc123.entry_2",
      path: "custom:abc123.entry_2",
      label: "ResumeForge",
      sectionKey: "custom:abc123",
      entryId: "entry_2",
      source: "manual",
      children: [
        group("custom:abc123.entry_2", "body", [
          item("custom:abc123.entry_2.summary_1", "项目简介", "body"),
        ]),
      ],
    },
  ],
};

const tree: StructureViewTree = { header: [headerGroup], sections: [education, project] };

describe("structureView · 展开与计数", () => {
  it("默认全展开时把页眉、板块、条目、分组、字段都摊平", () => {
    const rows = flattenVisible(tree, new Set());
    // 页眉 1 + 教育板块(1) + 条目(1) + 4 组 + 5 字段 + 项目板块(1) + 条目(1) + 1 组 + 1 字段
    expect(rows.map((row) => row.node.key)).toEqual([
      "header.#name",
      "header.header.name_1",
      "section:education",
      "entry:education.entry_1",
      "group:education.entry_1.title",
      "item:education.entry_1.school_1",
      "group:education.entry_1.meta",
      "item:education.entry_1.degree_1",
      "group:education.entry_1.trail",
      "item:education.entry_1.study_1",
      "item:education.entry_1.dept_1",
      "group:education.entry_1.hidden",
      "item:education.entry_1.rank_1",
      "section:custom:abc123",
      "entry:custom:abc123.entry_2",
      "group:custom:abc123.entry_2.body",
      "item:custom:abc123.entry_2.summary_1",
    ]);
  });

  it("折叠板块后只留板块行；折叠条目后不再显示分组和字段", () => {
    const collapsedSection = flattenVisible(tree, new Set(["section:education"]));
    expect(collapsedSection.map((row) => row.node.key)).not.toContain("entry:education.entry_1");
    expect(collapsedSection).toHaveLength(7);
    const collapsedEntry = flattenVisible(tree, new Set(["entry:education.entry_1"]));
    expect(collapsedEntry.map((row) => row.node.key)).not.toContain(
      "group:education.entry_1.title",
    );
    expect(collapsedEntry).toHaveLength(8);
  });

  it("记录缩进层级：板块 0、条目 1、分组 2、字段 3", () => {
    const rows = flattenVisible(tree, new Set());
    const depth = new Map(rows.map((row) => [row.node.key, row.depth]));
    expect(depth.get("section:education")).toBe(0);
    expect(depth.get("entry:education.entry_1")).toBe(1);
    expect(depth.get("group:education.entry_1.title")).toBe(2);
    expect(depth.get("item:education.entry_1.school_1")).toBe(3);
  });

  it("可展开键只含真的有子节点的节点", () => {
    const keys = collectExpandableKeys(tree);
    expect(keys).toContain("section:education");
    expect(keys).toContain("entry:education.entry_1");
    expect(keys).toContain("group:education.entry_1.title");
    expect(keys).not.toContain("item:education.entry_1.school_1");
    expect(keys).not.toContain("header:header.name_1");
  });

  it("概览计数：板块数、条目数、字段数（页眉字段计入字段）", () => {
    expect(countTree(tree)).toEqual({ sections: 2, entries: 2, items: 7 });
  });
});

describe("structureView · 搜索", () => {
  it("空查询 = 原样展示全部行", () => {
    const result = searchTree(tree, "   ");
    expect(result.rows).toHaveLength(17);
    expect(result.hitKeys.size).toBe(0);
  });

  it("命中深层字段时保留祖先链，不带出兄弟字段", () => {
    const result = searchTree(tree, "学院");
    expect(result.hitKeys).toEqual(new Set(["item:education.entry_1.dept_1"]));
    expect(result.rows.map((row) => row.node.key)).toEqual([
      "section:education",
      "entry:education.entry_1",
      "group:education.entry_1.trail",
      "item:education.entry_1.dept_1",
    ]);
    expect(result.matchedKeys.has("group:education.entry_1.trail")).toBe(true);
    expect(result.rows.some((row) => row.node.key === "item:education.entry_1.study_1")).toBe(
      false,
    );
  });

  it("命中板块名时保留整棵子树", () => {
    const result = searchTree(tree, "教育");
    expect(result.hitKeys.has("section:education")).toBe(true);
    expect(result.rows.map((row) => row.node.key)).toContain("item:education.entry_1.rank_1");
  });

  it("大小写不敏感（英文标签也能搜到）", () => {
    const englishTree: StructureViewTree = {
      header: [],
      sections: [
        {
          kind: "section",
          key: "section:skills",
          path: "skills",
          label: "Skills",
          children: [item("skills.entry_1.name_1", "TypeScript", "body")],
        },
      ],
    };
    const result = searchTree(englishTree, "typescript");
    expect(result.hitKeys).toEqual(new Set(["item:skills.entry_1.name_1"]));
  });

  it("无命中时返回空行", () => {
    const result = searchTree(tree, "根本不存在的字段");
    expect(result.rows).toEqual([]);
  });
});

describe("structureView · 祖先与键盘", () => {
  it("祖先链由外到内，不含自身", () => {
    expect(ancestorKeys(tree, "item:education.entry_1.school_1")).toEqual([
      "section:education",
      "entry:education.entry_1",
      "group:education.entry_1.title",
    ]);
    expect(ancestorKeys(tree, "section:education")).toEqual([]);
    expect(ancestorKeys(tree, "不存在的键")).toEqual([]);
  });

  it("上下键在可见行里移动并在边界停住", () => {
    const rows = flattenVisible(tree, new Set());
    expect(nextRowKey(rows, "section:education", "down")).toBe("entry:education.entry_1");
    expect(nextRowKey(rows, "section:education", "up")).toBe("header.header.name_1");
    expect(nextRowKey(rows, "", "down")).toBe("header.#name");
    expect(nextRowKey(rows, "header.header.name_1", "end")).toBe(
      "item:custom:abc123.entry_2.summary_1",
    );
    expect(nextRowKey(rows, "header.header.name_1", "up")).toBe("header.#name");
  });
});
