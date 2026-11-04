// SPDX-License-Identifier: Apache-2.0
/**
 * 详情 → 版式草稿的兜底规则：**`0` 是「不限篇幅」，不是"没填"**。
 *
 * 旧实现用 `detail.page_limit || DEFAULT_RESUME_LAYOUT.page_limit`：一份选了「不限」的
 * 简历一打开就显示成 1 页，用户随后任何一次保存都会把 0 真的写回成 1——"悄悄变 1 页"
 * 这条族里最隐蔽的一处（库里明明是对的，界面自己算错了）。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RESUME_LAYOUT, layoutFromDetail } from "./resumeDocumentHost";
import type { ResumeDetail } from "../../types";

function detail(overrides: Partial<Record<string, unknown>> = {}): ResumeDetail {
  return {
    id: 7,
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
    language: "zh-CN",
    ...overrides,
  } as unknown as ResumeDetail;
}

describe("layoutFromDetail · 页数上限", () => {
  it("page_limit=0（不限）保持 0，不回落成默认的 1 页", () => {
    expect(layoutFromDetail(detail({ page_limit: 0 })).page_limit).toBe(0);
  });

  it("有上限时原样带过来", () => {
    expect(layoutFromDetail(detail({ page_limit: 10 })).page_limit).toBe(10);
  });

  it("只有 null/undefined 才回落默认值（缺字段的旧响应）", () => {
    expect(layoutFromDetail(detail({ page_limit: null })).page_limit).toBe(
      DEFAULT_RESUME_LAYOUT.page_limit,
    );
    expect(layoutFromDetail(detail({ page_limit: undefined })).page_limit).toBe(
      DEFAULT_RESUME_LAYOUT.page_limit,
    );
  });

  it("其它版式字段的既有兜底不变", () => {
    const layout = layoutFromDetail(
      detail({ template: "", format_name: "spacious", font_scale: "", language: undefined }),
    );
    expect(layout.template).toBe(DEFAULT_RESUME_LAYOUT.template);
    expect(layout.format_name).toBe("spacious");
    expect(layout.font_scale).toBe(DEFAULT_RESUME_LAYOUT.font_scale);
    expect(layout.language).toBe(DEFAULT_RESUME_LAYOUT.language);
    expect(layout.format_config).toEqual({});
  });
});
