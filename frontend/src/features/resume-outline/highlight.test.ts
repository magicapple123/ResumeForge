// SPDX-License-Identifier: Apache-2.0
/**
 * 画布高亮的纯计算测试：选择 → `data-resume-path` 选择器。
 *
 * 两条关键性质：
 * 1. **选择锚在 id 上**：排序后同一个选择解析出的是新下标（不是旧下标）——否则"画布高亮"
 *    会高亮到别人身上；
 * 2. 条目级用前缀（一条经历下的公司/日期/要点全亮），要点级用精确匹配；个人信息只点亮
 *    真正有值的标量字段（空字段在模板里根本不存在）。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types/resume";
import { ensureIds } from "../resume-document/identity";
import { applyOutlineCommand } from "./commands";
import {
  buildOutlineHighlightCss,
  OUTLINE_HIGHLIGHT_DECLARATION,
  OUTLINE_HIGHLIGHT_STYLE_ID,
  resolveHighlightTargets,
} from "./highlight";
import { entriesOf, entryIdOf, pointIdsOf } from "./model";

function content(): ResumeContent {
  return {
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "13800000000",
    email: "zhang@example.com",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [
      {
        name: "项目甲",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["做了甲"],
        highlights: [],
      },
      {
        name: "项目乙",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["做了乙一", "做了乙二"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  };
}

const base: ResumeContent = ensureIds(content());
const projectBId = entryIdOf(entriesOf(base, "projects")[1]);

describe("resolveHighlightTargets", () => {
  it("条目选择 → 前缀目标；要点选择 → 精确目标", () => {
    expect(
      resolveHighlightTargets(base, { kind: "entry", field: "projects", objectId: projectBId }),
    ).toEqual([{ path: "projects.1", prefix: true }]);
    const pointId = pointIdsOf(entriesOf(base, "projects")[1], "description")[1];
    expect(
      resolveHighlightTargets(base, {
        kind: "point",
        field: "projects",
        objectId: projectBId,
        pointField: "description",
        pointId,
      }),
    ).toEqual([{ path: "projects.1.description.1", prefix: false }]);
  });

  it("排序后同一个选择解析到新下标（选择不是按下标存的）", () => {
    const result = applyOutlineCommand(base, {
      type: "reorder-entry",
      field: "projects",
      objectId: projectBId,
      toIndex: 0,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(
      resolveHighlightTargets(result.content, {
        kind: "entry",
        field: "projects",
        objectId: projectBId,
      }),
    ).toEqual([{ path: "projects.0", prefix: true }]);
  });

  it("个人信息只点亮有值的字段；没有内容/选择时返回空", () => {
    expect(resolveHighlightTargets(base, { kind: "personal" })).toEqual([
      { path: "name", prefix: false },
      { path: "phone", prefix: false },
      { path: "email", prefix: false },
    ]);
    expect(resolveHighlightTargets(null, { kind: "personal" })).toEqual([]);
    expect(resolveHighlightTargets(base, null)).toEqual([]);
    expect(
      resolveHighlightTargets(base, {
        kind: "entry",
        field: "projects",
        objectId: "ob_000000000000",
      }),
    ).toEqual([]);
  });
});

describe("buildOutlineHighlightCss", () => {
  it("生成带前缀/精确选择器的规则，声明来自同一常量", () => {
    const css = buildOutlineHighlightCss([
      { path: "projects.1", prefix: true },
      { path: "summary", prefix: false },
    ]);
    expect(css).toContain('[data-resume-path^="projects.1."]');
    expect(css).toContain('[data-resume-path="summary"]');
    expect(css).toContain(OUTLINE_HIGHLIGHT_DECLARATION);
    // 一条目一要点两行规则；样式 id 供 iframe 注入去重。
    expect(css.split("\n")).toHaveLength(2);
    expect(OUTLINE_HIGHLIGHT_STYLE_ID).toBe("rf-outline-highlight");
  });

  it("非法路径被跳过而不是拼进选择器；空目标返回空串", () => {
    const css = buildOutlineHighlightCss([{ path: 'summary"] { color: red; } [x', prefix: false }]);
    expect(css).toBe("");
    expect(buildOutlineHighlightCss([])).toBe("");
  });
});
