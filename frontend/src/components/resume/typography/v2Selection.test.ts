// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { ResumeEntry, ResumeSection } from "../../../types/resumeDocument";
import type { ResumeLayout } from "../../../types";
import { emptyDocument } from "../../../features/resume-document/defaults";
import { makeDocument } from "../../../features/resume-document/documentFixtures";
import {
  changedStyleTargets,
  emptyStyleChange,
  entryIdFromPath,
  entryIdsFromPaths,
  optionsForIds,
  pathsFromEntryIds,
  placementForDocumentPath,
  roleForDocumentPath,
  scopeForDocumentPath,
  styleChangeIsEmpty,
  typographyEntryOptions,
} from "./v2Selection";

function sectionWith(overrides: Partial<ResumeSection>): ResumeSection {
  const base = makeDocument().sections[0];
  return { ...base, entries: [], ...overrides };
}

function entryWith(id: string | null, items: ResumeEntry["items"]): ResumeEntry {
  return {
    id,
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: { head: "split" },
    items,
  };
}

describe("typographyEntryOptions", () => {
  it("从 v2 文档生成条目选择列表（标题/元信息/板块/路径）", () => {
    const options = typographyEntryOptions(makeDocument());
    // Q12：summary（text kind）的条目不再进选择列表（行内/单段板块没有对象样式落点）。
    expect(options.map((option) => option.id)).toEqual(["ob_entry001", "ob_entry002"]);
    const first = options[0];
    expect(first.label).toBe("Tsinghua University · Computer Science");
    expect(first.meta).toBe("Bachelor");
    expect(first.sectionKey).toBe("education");
    expect(first.path).toBe("education.ob_entry001");
    expect(first.index).toBe(0);
    expect(options[1].path).toBe("education.ob_entry002");
  });

  it("缺 id 的条目跳过；没有标题时用「板块标题 + 序号」兜底", () => {
    const document = emptyDocument();
    document.sections.push(
      sectionWith({
        key: "education",
        title: "",
        layout: { ...makeDocument().sections[0].layout, title_override: "教育" },
        entries: [entryWith(null, []), entryWith("ob_noTitle01", [])],
      }),
    );
    const options = typographyEntryOptions(document);
    expect(options).toHaveLength(1);
    expect(options[0].id).toBe("ob_noTitle01");
    expect(options[0].label).toBe("教育 2");
  });

  it("板块标题优先取 title_override，其次 title，最后目录标题/key", () => {
    const document = makeDocument();
    document.sections[0].title = "教育经历";
    expect(typographyEntryOptions(document)[0].sectionTitle).toBe("教育经历");
    document.sections[0].layout.title_override = "学历";
    expect(typographyEntryOptions(document)[0].sectionTitle).toBe("学历");
  });
});

describe("路径 → 条目 / 作用范围", () => {
  const document = makeDocument();

  it("entryIdFromPath：条目路径/字段路径都能取到 id；header/板块/空返回 null", () => {
    expect(entryIdFromPath("education.ob_entry001")).toBe("ob_entry001");
    expect(entryIdFromPath("education.ob_entry001.ob_item0001")).toBe("ob_entry001");
    expect(entryIdFromPath("header.ob_head0001")).toBeNull();
    expect(entryIdFromPath("education")).toBeNull();
    expect(entryIdFromPath(null)).toBeNull();
    // 两段路径按格式就是条目路径；"这条是否存在"由 optionsForIds 过滤，不在这里猜。
    expect(entryIdFromPath("nope.nope")).toBe("nope");
  });

  it("placementForDocumentPath：字段路径给出位置；条目路径/不存在返回 null", () => {
    expect(placementForDocumentPath(document, "education.ob_entry001.ob_item0001")).toBe("title");
    expect(placementForDocumentPath(document, "education.ob_entry001.ob_item0003")).toBe("meta");
    expect(placementForDocumentPath(document, "education.ob_entry001.ob_item0004")).toBe("lead");
    expect(placementForDocumentPath(document, "education.ob_entry001.ob_item0006")).toBe("body");
    expect(placementForDocumentPath(document, "education.ob_entry001")).toBeNull();
    expect(placementForDocumentPath(document, "education.ob_entry001.nope")).toBeNull();
  });

  it("scopeForDocumentPath：title→条目标题，meta/lead/trail→说明，body→正文，其余→整个条目", () => {
    expect(scopeForDocumentPath(document, "education.ob_entry001.ob_item0001")).toBe("entry_title");
    expect(scopeForDocumentPath(document, "education.ob_entry001.ob_item0003")).toBe("meta");
    expect(scopeForDocumentPath(document, "education.ob_entry001.ob_item0004")).toBe("meta");
    expect(scopeForDocumentPath(document, "education.ob_entry001.ob_item0006")).toBe("body");
    expect(scopeForDocumentPath(document, "education.ob_entry001")).toBe("object");
    expect(scopeForDocumentPath(document, "header.ob_head0001")).toBe("object");
    expect(scopeForDocumentPath(document, null)).toBe("object");
  });

  it("roleForDocumentPath：title→entry_title，说明类→meta，其余→body", () => {
    expect(roleForDocumentPath(document, "education.ob_entry001.ob_item0001")).toBe("entry_title");
    expect(roleForDocumentPath(document, "education.ob_entry001.ob_item0004")).toBe("meta");
    expect(roleForDocumentPath(document, "education.ob_entry001.ob_item0006")).toBe("body");
    expect(roleForDocumentPath(document, null)).toBe("body");
  });
});

describe("选择集合换算", () => {
  const document = makeDocument();
  const options = typographyEntryOptions(document);

  it("optionsForIds 只保留文档里真实存在的条目，保持文档顺序", () => {
    expect(optionsForIds(options, ["ob_entry002", "ob_entry001"]).map((o) => o.id)).toEqual([
      "ob_entry001",
      "ob_entry002",
    ]);
    expect(optionsForIds(options, ["nope"])).toEqual([]);
  });

  it("entryIdsFromPaths / pathsFromEntryIds 去重、过滤非法路径", () => {
    const ids = entryIdsFromPaths([
      "education.ob_entry001",
      "education.ob_entry001.ob_item0001",
      "header.ob_head0001",
      "nope",
    ]);
    expect(ids).toEqual(["ob_entry001"]);
    expect(entryIdsFromPaths(undefined)).toEqual([]);
    expect(pathsFromEntryIds(options, ["ob_entry002", "nope"])).toEqual(["education.ob_entry002"]);
  });
});

describe("format_config 样式域差异", () => {
  function layout(format_config: Record<string, unknown>): ResumeLayout {
    return {
      template: "classic",
      format_name: "",
      page_limit: 1,
      font_scale: "standard",
      format_config: format_config as unknown as ResumeLayout["format_config"],
    };
  }

  it("分别报出角色域 / 对象域 / 对象角色域的变化", () => {
    const before = layout({
      roles: { body: { font_scale: 1.1 } },
      objects: { ob_entry001: { space_after: 0.2 } },
    });
    const after = layout({
      roles: { body: { font_scale: 1.2 }, name: { bold: true } },
      objects: { ob_entry001: { space_after: 0.2 }, ob_entry002: { bold: true } },
      object_roles: { "ob_entry001:entry_title": { font_scale: 1.2 } },
    });
    expect(changedStyleTargets(before.format_config, after.format_config)).toEqual({
      roles: ["body", "name"],
      objectIds: ["ob_entry002"],
      objectRoleKeys: ["ob_entry001:entry_title"],
    });
  });

  it("完全没变 / 空配置 → 空差异", () => {
    const before = layout({ roles: { body: { font_scale: 1.1 } } });
    expect(
      styleChangeIsEmpty(changedStyleTargets(before.format_config, before.format_config)),
    ).toBe(true);
    expect(changedStyleTargets(undefined, undefined)).toEqual(emptyStyleChange());
  });
});
