// SPDX-License-Identifier: Apache-2.0
/** W14 真实规则：科研空列表、文档模式 payload、目录区间消费。 */
import { describe, expect, it } from "vitest";
import { buildLayoutPayload, modeLimitsFromCatalog } from "./api";
import { hasResearchEntries, readResearchList, stripEmptyResearch } from "./real";
import type { ResumeContent, ResumeLayout } from "../../types";

const CONTENT = {
  basic_info: { name: "张三" },
  publications: [{ title: "一篇论文" }],
  research_projects: [],
  patents: [],
} as unknown as ResumeContent;

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "standard",
  page_limit: 3,
  font_scale: "standard",
  language: "zh-CN",
  format_config: {},
} as ResumeLayout;

describe("科研字段读取与空列表", () => {
  it("缺键 / null / 非数组都按空数组", () => {
    expect(readResearchList(CONTENT, "publications")).toHaveLength(1);
    expect(readResearchList(CONTENT, "research_projects")).toEqual([]);
    expect(readResearchList(null, "patents")).toEqual([]);
    expect(readResearchList({ patents: "x" } as never, "patents")).toEqual([]);
  });

  it("保存前删掉空列表键、保留非空与其它字段（不改入参）", () => {
    const out = stripEmptyResearch(CONTENT) as unknown as Record<string, unknown>;
    expect(out.publications).toHaveLength(1);
    expect("research_projects" in out).toBe(false);
    expect("patents" in out).toBe(false);
    expect(out.basic_info).toEqual({ name: "张三" });
    // 入参未被修改
    expect(Array.isArray((CONTENT as unknown as Record<string, unknown>).patents)).toBe(true);
  });

  it("没有空列表时返回原引用；hasResearchEntries 看三栏是否有内容", () => {
    const clean = { basic_info: {}, publications: [{ title: "x" }] } as unknown as ResumeContent;
    expect(stripEmptyResearch(clean)).toBe(clean);
    expect(hasResearchEntries(clean)).toBe(true);
    expect(hasResearchEntries({ basic_info: {} } as unknown as ResumeContent)).toBe(false);
  });
});

describe("文档模式保存 payload", () => {
  it("普通模式把 4 页夹到 3 页，并带全版式字段（整体替换接口）", () => {
    const payload = buildLayoutPayload(LAYOUT, { mode: "resume", pageLimit: 4 });
    expect(payload.page_limit).toBe(3);
    expect(payload.document_mode).toBe("resume");
    expect(payload.template).toBe("classic");
    expect(payload.format_name).toBe("standard");
    expect(payload.font_scale).toBe("standard");
    expect(payload.language).toBe("zh-CN");
    expect(payload.format_config).toEqual({});
  });

  it("长 CV 允许 10 页、把 11 页夹到 10 页", () => {
    expect(buildLayoutPayload(LAYOUT, { mode: "long_cv", pageLimit: 10 }).page_limit).toBe(10);
    expect(buildLayoutPayload(LAYOUT, { mode: "long_cv", pageLimit: 11 }).page_limit).toBe(10);
  });

  it("切换模式时页数按新模式区间夹紧（long_cv 2 页 → resume 仍 2 页）", () => {
    const layout = { ...LAYOUT, page_limit: 2 } as ResumeLayout;
    expect(buildLayoutPayload(layout, { mode: "resume", pageLimit: 2 }).page_limit).toBe(2);
    expect(buildLayoutPayload(layout, { mode: "resume", pageLimit: 0 }).page_limit).toBe(1);
  });
});

describe("目录区间", () => {
  it("解析 mode_page_limits 与长 CV 默认页数", () => {
    const out = modeLimitsFromCatalog({
      mode_page_limits: { resume: [1, 3], long_cv: [1, 10] },
      long_cv_default_page_limit: 2,
    });
    expect(out.limits).toEqual({ resume: [1, 3], long_cv: [1, 10] });
    expect(out.defaultLongCvPageLimit).toBe(2);
  });

  it("旧后端缺字段 / 畸形值回落到 undefined（界面用本地兜底）", () => {
    expect(modeLimitsFromCatalog(null)).toEqual({
      limits: undefined,
      defaultLongCvPageLimit: undefined,
    });
    expect(
      modeLimitsFromCatalog({
        mode_page_limits: { resume: [3, 1] },
        long_cv_default_page_limit: "x",
      }),
    ).toEqual({ limits: undefined, defaultLongCvPageLimit: undefined });
  });
});
