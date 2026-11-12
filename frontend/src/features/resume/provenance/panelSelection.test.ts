// SPDX-License-Identifier: Apache-2.0
/**
 * R-16：来源核对下拉的「字段」那一截不能把内部标识露出来。
 *
 * 症状（审计清单 R-16）：下拉里显示「上海财经大学 · it_512bcf…」。根因是字段名从
 * `path` 末段派生，而 v2 的 path 末段就是 `object_id` / `point_id`。
 */
import { describe, expect, it } from "vitest";
import { selectionOptions } from "./panelSelection";
import type { DocumentObjectOut, ResumeProvenanceOut } from "./types";

function object(overrides: Partial<DocumentObjectOut>): DocumentObjectOut {
  return {
    path: "",
    field: "education",
    object_id: null,
    point_id: null,
    label: "",
    link: null,
    ...overrides,
  };
}

function view(objects: DocumentObjectOut[]): ResumeProvenanceOut {
  return { objects } as unknown as ResumeProvenanceOut;
}

const ENTRY = object({
  path: "education.ob_84c9913f841c29f5",
  object_id: "ob_84c9913f841c29f5",
  label: "上海财经大学",
});

const POINT_WITH_LABEL = object({
  path: "education.ob_84c9913f841c29f5.it_512bcf29aabfad2e",
  object_id: "ob_84c9913f841c29f5",
  point_id: "it_512bcf29aabfad2e",
  label: "线性代数与概率论",
  field_label: "核心课程",
});

const POINT_KEY_ONLY = object({
  path: "education.ob_84c9913f841c29f5.it_aabbccddeeff0011",
  object_id: "ob_84c9913f841c29f5",
  point_id: "it_aabbccddeeff0011",
  label: "3.9/4.0",
  field_label: "gpa",
});

const POINT_LEGACY = object({
  path: "education.ob_84c9913f841c29f5.it_0123456789abcdef",
  object_id: "ob_84c9913f841c29f5",
  point_id: "it_0123456789abcdef",
  label: "旧后端返回的要点",
});

describe("selectionOptions：字段名", () => {
  it("条目块不显示后缀（path 末段就是 object_id）", () => {
    const [option] = selectionOptions(view([ENTRY]));
    expect(option.label).toBe("上海财经大学");
    expect(option.field).toBe("");
  });

  it("要点块用后端给的 field_label，并经字段目录翻成中文", () => {
    const options = selectionOptions(view([POINT_KEY_ONLY]), (key) =>
      key === "gpa" ? "绩点" : undefined,
    );
    expect(options[0].field).toBe("绩点");
  });

  it("自定义字段名原样透出（后端给的就是用户写的中文）", () => {
    const [option] = selectionOptions(view([POINT_WITH_LABEL]));
    expect(option.field).toBe("核心课程");
  });

  it("旧后端没有 field_label 时降级为只显示 label", () => {
    const [option] = selectionOptions(view([POINT_LEGACY]));
    expect(option.field).toBe("");
    expect(option.label).toBe("旧后端返回的要点");
  });

  it("任何情况下 field 都不是 ob_/it_ 开头", () => {
    const options = selectionOptions(view([ENTRY, POINT_WITH_LABEL, POINT_KEY_ONLY, POINT_LEGACY]));
    for (const option of options) expect(option.field).not.toMatch(/^(ob_|it_)/);
  });

  it("v1 路径的字段后缀仍保留（不是内部标识）", () => {
    const legacy = object({
      path: "experience.0.description.1",
      object_id: null,
      point_id: null,
      label: "一段要点",
    });
    expect(selectionOptions(view([legacy]))[0].field).toBe("description");
  });
});
