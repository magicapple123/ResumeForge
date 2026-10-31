// SPDX-License-Identifier: Apache-2.0
/**
 * 投影 v2 解析/合并（`projectionContent.ts`）：document_entry / document_path / 旧 v1 路径
 * 三种来源、只做加法、source 去重、仅素材标记、补板块/补条目。
 */
import { describe, expect, it } from "vitest";
import type { ProjectionCandidateOut, PaperProjectionOut } from "./types";
import type {
  FieldItem,
  FieldSource,
  ResumeDocument,
  ResumeEntry,
  ResumeItem,
} from "../../types/resumeDocument";
import { defaultSectionLayout } from "../resume-document/defaults";
import {
  applyProjectionCandidate,
  isV2ProjectionContent,
  itemSourceKey,
  mergeProjectionCandidate,
  projectionDocument,
  resolvableProjectionCandidates,
  resolveProjectionCandidate,
} from "./projectionContent";

function layout() {
  return { head: "split" as const, start_on_new_page: false, keep_together: false };
}

function entry(id: string, items: ResumeItem[]): ResumeEntry {
  return {
    id,
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: layout(),
    items,
  };
}

function field(
  id: string,
  key: string,
  value: string,
  placement: FieldItem["placement"],
  source?: FieldSource | null,
): FieldItem {
  return {
    kind: "field",
    id,
    key,
    label: "",
    value,
    placement,
    format: "text",
    wrap: "none",
    show_label: false,
    solo: false,
    source: source ?? null,
    body_style: "bullet",
  };
}

function textItem(id: string, text: string): ResumeItem {
  return { kind: "text", id, style: "paragraph", text, hidden: false };
}

function makeDocument(): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: { items: [], contact_breaks: [] },
    sections: [
      {
        key: "education",
        title: "",
        kind: "entries",
        layout: defaultSectionLayout(),
        entries: [
          entry("ob_edu00000001", [
            field("ob_school000001", "school", "Tsinghua University", "title", {
              section_key: "educations",
              field_id: "educations.school",
            }),
            field("ob_degree000001", "degree", "Bachelor", "meta"),
            textItem("ob_text00000001", "Won a scholarship"),
          ]),
          entry("ob_edu00000002", [
            field("ob_school000002", "school", "Peking University", "title"),
          ]),
        ],
      },
      {
        key: "custom:abc12345",
        title: "",
        kind: "entries",
        layout: defaultSectionLayout(),
        entries: [
          entry("ob_custom00001", [
            textItem("ob_ctext000001", "Society president"),
            field("ob_cfield00001", "custom:field001", "Treasurer", "trail", {
              section_key: "custom:abc12345",
              field_id: "field001",
            }),
          ]),
        ],
      },
    ],
  };
}

function scope() {
  return {
    group_id: "g1",
    group_name: "Current group",
    is_default: true,
    participating_keys: ["educations"],
    section_order: ["educations"],
    workspace_revision: 3,
  };
}

function candidate(overrides: Partial<ProjectionCandidateOut>): ProjectionCandidateOut {
  return {
    section_key: "educations",
    section_name: "Education",
    entry_id: "profile-entry-1",
    title: "",
    subtitle: "",
    ...overrides,
  };
}

function projection(overrides: Partial<PaperProjectionOut> = {}): PaperProjectionOut {
  const document = makeDocument();
  return {
    scope: scope(),
    content: document,
    candidates: [
      candidate({
        document_path: "education.ob_edu00000001",
        document_entry: document.sections[0].entries[0],
      }),
      candidate({
        section_key: "custom:abc12345",
        document_path: "custom:abc12345.ob_custom00001",
        document_entry: document.sections[1].entries[0],
      }),
      candidate({ entry_id: "profile-entry-2", document_path: "education.ob_edu00000002" }),
      // 没进纸面：不可解析。
      candidate({ entry_id: "profile-entry-3", document_path: "", document_entry: null }),
    ],
    source_layout: [],
    warnings: [],
    snapshot_token: "token",
    ...overrides,
  };
}

function emptyDocument(): ResumeDocument {
  return { version: 2, language: "zh-CN", header: { items: [], contact_breaks: [] }, sections: [] };
}

function educationEntry(document: ResumeDocument): ResumeEntry {
  const section = document.sections.find((item) => item.key === "education");
  const entry = section?.entries[0];
  if (!entry) throw new Error("education entry missing");
  return entry;
}

describe("文档判定与 v1 兼容视图", () => {
  it("isV2ProjectionContent / projectionDocument", () => {
    const document = makeDocument();
    expect(isV2ProjectionContent(document)).toBe(true);
    expect(isV2ProjectionContent({ photo: "", education: [] })).toBe(false);
    expect(projectionDocument(projection())).toEqual(document);
    expect(projectionDocument(null)).toBeNull();
  });

  it("keeps the native document and rejects an unconverted old response", () => {
    const source = projection();
    expect(projectionDocument(source)).toBe(source.content);
    expect(
      projectionDocument({ content: { name: "old" } } as unknown as PaperProjectionOut),
    ).toBeNull();
  });
});

describe("候选解析（document_entry > document_path > 旧 v1 路径）", () => {
  it("有 document_entry：即便 document_path 过期也能解析（按 entry id 兜底）", () => {
    const source = projection();
    const document = makeDocument();
    const resolved = resolveProjectionCandidate(source, {
      ...source.candidates[0],
      document_path: "education.ob_outdated0001",
    });
    expect(resolved?.entry.id).toBe("ob_edu00000001");
    expect(resolved?.sectionKey).toBe("education");
    expect(resolved?.items.map((item) => item.id)).toEqual(
      document.sections[0].entries[0].items.map((item) => item.id),
    );
  });

  it("只有 document_path（v2）时按路径定位", () => {
    const source = projection();
    const resolved = resolveProjectionCandidate(source, {
      ...source.candidates[0],
      document_entry: null,
    });
    expect(resolved?.entry.id).toBe("ob_edu00000001");
  });

  it("resolves a native path without the optional entry payload", () => {
    const source = projection();
    const resolved = resolveProjectionCandidate(source, source.candidates[2]);
    expect(resolved?.entry.id).toBe("ob_edu00000002");
  });

  it("自建板块候选可解析（v2 路径与 document_entry 两种）", () => {
    const source = projection();
    const resolved = resolveProjectionCandidate(source, source.candidates[1]);
    expect(resolved?.sectionKey).toBe("custom:abc12345");
    expect(resolved?.entry.id).toBe("ob_custom00001");
  });

  it("没进纸面的候选返回 null；可解析列表只留 3 条", () => {
    const source = projection();
    expect(resolveProjectionCandidate(source, source.candidates[3])).toBeNull();
    expect(resolvableProjectionCandidates(source)).toHaveLength(3);
  });

  it("itemSourceKey：field 才有 source，text 恒 null", () => {
    const document = makeDocument();
    const items = document.sections[0].entries[0].items;
    expect(itemSourceKey(items[0])).toBe("educations.educations.school");
    expect(itemSourceKey(items[2])).toBeNull();
  });
});

describe("合并（只做加法 + source 去重 + 仅素材）", () => {
  it("空条目：补齐标题/元信息字段并追加正文块，id 与来源不同", () => {
    const source = projection();
    const document = emptyDocument();
    const resolved = resolveProjectionCandidate(source, source.candidates[0]);
    if (!resolved) throw new Error("candidate unresolved");
    const result = mergeProjectionCandidate(document, resolved);
    const entry = educationEntry(result.document);
    expect(entry.items.map((item) => (item.kind === "field" ? item.key : item.kind))).toEqual([
      "school",
      "degree",
      "text",
    ]);
    expect(result.filled).toBe(3);
    expect(result.document.sections[0].key).toBe("education");
    const ids = entry.items.map((item) => item.id);
    expect(ids).not.toContain("ob_school000001");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("只填空：已有值不被覆盖，缺失的才补", () => {
    const source = projection();
    const document = emptyDocument();
    document.sections.push({
      key: "education",
      title: "",
      kind: "entries",
      layout: defaultSectionLayout(),
      entries: [
        entry("ob_target000001", [field("ob_mine00000001", "school", "My school", "title")]),
      ],
    });
    const resolved = resolveProjectionCandidate(source, source.candidates[0]);
    if (!resolved) throw new Error("candidate unresolved");
    const result = mergeProjectionCandidate(document, resolved);
    const items = educationEntry(result.document).items;
    const school = items.filter((item) => item.kind === "field" && item.key === "school");
    expect(school).toHaveLength(1);
    expect((school[0] as FieldItem).value).toBe("My school");
    expect(items.some((item) => item.kind === "field" && item.key === "degree")).toBe(true);
  });

  it("同一候选再填一次：filled=0（source 去重 + 正文块不重复）", () => {
    const source = projection();
    const resolved = resolveProjectionCandidate(source, source.candidates[0]);
    if (!resolved) throw new Error("candidate unresolved");
    const once = mergeProjectionCandidate(emptyDocument(), resolved);
    const twice = mergeProjectionCandidate(once.document, resolved);
    expect(twice.filled).toBe(0);
    expect(educationEntry(twice.document).items).toHaveLength(3);
  });

  it("目标已有正文块时不再追加来源文本（不覆盖用户手写正文）", () => {
    const source = projection();
    const document = emptyDocument();
    document.sections.push({
      key: "education",
      title: "",
      kind: "entries",
      layout: defaultSectionLayout(),
      entries: [entry("ob_target000001", [textItem("ob_usertext0001", "My own words")])],
    });
    const resolved = resolveProjectionCandidate(source, source.candidates[0]);
    if (!resolved) throw new Error("candidate unresolved");
    const result = mergeProjectionCandidate(document, resolved);
    const texts = educationEntry(result.document).items.filter((item) => item.kind === "text");
    expect(texts).toHaveLength(1);
    expect(texts[0]?.kind === "text" ? texts[0].text : "").toBe("My own words");
  });

  it("板块存在但没有条目：追加克隆条目；来源条目的 id 不落进目标", () => {
    const source = projection();
    const document = emptyDocument();
    document.sections.push({
      key: "education",
      title: "",
      kind: "entries",
      layout: defaultSectionLayout(),
      entries: [],
    });
    const resolved = resolveProjectionCandidate(source, source.candidates[0]);
    if (!resolved) throw new Error("candidate unresolved");
    const result = mergeProjectionCandidate(document, resolved);
    const section = result.document.sections[0];
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0].id).not.toBe("ob_edu00000001");
    expect(result.filled).toBe(3);
  });

  it("仅素材字段（hidden + source）合并后 materialOnly=true", () => {
    const source = projection();
    const document = makeDocument();
    source.candidates.push(
      candidate({
        entry_id: "profile-entry-4",
        document_path: "education.ob_edu00000001",
        document_entry: {
          ...document.sections[0].entries[0],
          // 换一个纸面条目 id：让解析走 document_entry 本身（而不是 content 里同 id 的旧 entry）。
          id: "ob_hiddenentry01",
          items: [
            field("ob_hidden000001", "gender", "Female", "hidden", {
              section_key: "educations",
              field_id: "educations.gender",
            }),
          ],
        },
      }),
    );
    const resolved = resolveProjectionCandidate(
      source,
      source.candidates[source.candidates.length - 1],
    );
    if (!resolved) throw new Error("candidate unresolved");
    const result = mergeProjectionCandidate(emptyDocument(), resolved);
    expect(result.materialOnly).toBe(true);
    const hidden = educationEntry(result.document).items.filter(
      (item) => item.kind === "field" && item.placement === "hidden",
    );
    expect(hidden).toHaveLength(1);
  });

  it("applyProjectionCandidate 一步到位；解析不到返回 null", () => {
    const source = projection();
    const result = applyProjectionCandidate(emptyDocument(), source, source.candidates[0]);
    expect(result?.filled).toBe(3);
    expect(applyProjectionCandidate(emptyDocument(), source, source.candidates[3])).toBeNull();
  });
});
