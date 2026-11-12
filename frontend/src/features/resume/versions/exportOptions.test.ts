// SPDX-License-Identifier: Apache-2.0
/** 导出弹窗变体选项：value=variant_id、独立排版标记、空列表。 */
import { describe, expect, it } from "vitest";
import { buildVariantExportOptions } from "./exportOptions";
import type { VariantOut } from "./types";

function variant(overrides: Partial<VariantOut>): VariantOut {
  return {
    id: 1,
    resume_id: 5,
    name: "英文版",
    job_id: null,
    job_title: "",
    company: "",
    content_sha256: "sha",
    base_version_id: null,
    last_synced_version_id: null,
    synced_at: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("buildVariantExportOptions", () => {
  it("value 是 variant_id，名称与岗位拼进 label", () => {
    const options = buildVariantExportOptions([
      variant({ id: 7, name: "后端岗版", job_title: "后端工程师", has_layout: true }),
    ]);
    expect(options[0].value).toBe(7);
    expect(options[0].hasLayout).toBe(true);
    expect(options[0].label).toContain("后端岗版");
    expect(options[0].label).toContain("后端工程师");
  });

  it("有/无独立排版的标签不同（不误导用户）", () => {
    const [own] = buildVariantExportOptions([variant({ id: 1, has_layout: true })]);
    const [inherited] = buildVariantExportOptions([variant({ id: 2, has_layout: false })]);
    expect(own.label).not.toBe(inherited.label);
    expect(own.hasLayout).toBe(true);
    expect(inherited.hasLayout).toBe(false);
  });

  it("空列表返回空数组", () => {
    expect(buildVariantExportOptions([])).toEqual([]);
  });
});
