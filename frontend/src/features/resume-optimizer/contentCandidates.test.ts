// SPDX-License-Identifier: Apache-2.0
/**
 * W09 内容精简候选的纯规则层：改哪几条、身份是否对齐、hints 缺省时是否 fail-soft。
 *
 * 这些用例不渲染任何 UI：候选正确性靠纯函数断言（删/并后的 content 与 point_ids 逐位核对），
 * 真正"应用后进历史"由宿主集成测试覆盖。
 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types/resume";
import { MAX_CONTENT_CANDIDATES, buildContentCandidates } from "./contentCandidates";

const SHORT_A = "负责 A";
const SHORT_B = "负责 B";
const LONG =
  "这是一个很长很长很长很长很长很长很长很长很长很长很长很长很长的要点，用来打断短要点合并，也超过短要点字符上限";

function content(): ResumeContent {
  return {
    photo: "",
    name: "示例甲",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [
      {
        id: "exp_aaaa0001",
        company: "甲公司",
        role: "工程师",
        start_date: "2020-01",
        end_date: "2022-12",
        description: [SHORT_A, SHORT_B, SHORT_A],
        point_ids: { description: ["pt_exp_aaa1", "pt_exp_aaa2", "pt_exp_aaa3"] },
      },
      {
        id: "exp_aaaa0002",
        company: "甲公司",
        role: "工程师",
        start_date: "2020-01",
        end_date: "2022-12",
        description: ["重复条目"],
      },
    ],
    campus_experience: [],
    projects: [
      {
        id: "prj_aaaa0001",
        name: "项目甲",
        tech_stack: [],
        description: ["短一", "短二", LONG, "短四"],
        highlights: [],
        point_ids: { description: ["pt_prj_aaa1", "pt_prj_aaa2", "pt_prj_aaa3", "pt_prj_aaa4"] },
      },
    ],
    skills: [],
    awards: [],
  } as unknown as ResumeContent;
}

function byKind(kind: string) {
  return buildContentCandidates(content()).find((candidate) => candidate.kind === kind) ?? null;
}

function experiences(value: ResumeContent): Record<string, unknown>[] {
  return (value as unknown as { experience: Record<string, unknown>[] }).experience;
}

describe("buildContentCandidates", () => {
  it("无内容返回空；无 hints 时不生成低相关候选且最多 3 个", () => {
    expect(buildContentCandidates(null)).toEqual([]);
    const candidates = buildContentCandidates(content());
    expect(candidates.length).toBeLessThanOrEqual(MAX_CONTENT_CANDIDATES);
    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "duplicate-entries",
      "duplicate-points",
      "merge-short-points",
    ]);
  });

  it("同标题 + 同元信息的条目只保留第一条，删掉的副本带 measureCss", () => {
    const candidate = byKind("duplicate-entries");
    expect(candidate).not.toBeNull();
    if (!candidate) return;
    const kept = experiences(candidate.content);
    expect(kept.map((entry) => entry.id)).toEqual(["exp_aaaa0001"]);
    expect(candidate.stats).toMatchObject({ entriesRemoved: 1, visibleRemoved: 1 });
    expect(candidate.items[0]).toMatchObject({ objectId: "exp_aaaa0002", label: "甲公司" });
    expect(candidate.measureCss).toContain('[data-object-id="exp_aaaa0002"]');
  });

  it("同条目里的重复要点只留一条，point_ids 与文本等长且逐位对齐", () => {
    const candidate = byKind("duplicate-points");
    expect(candidate).not.toBeNull();
    if (!candidate) return;
    const entry = experiences(candidate.content)[0];
    expect(entry.description).toEqual([SHORT_A, SHORT_B]);
    expect((entry.point_ids as Record<string, string[]>).description).toEqual([
      "pt_exp_aaa1",
      "pt_exp_aaa2",
    ]);
    expect(candidate.stats.pointsRemoved).toBe(1);
    expect(candidate.measureCss).toContain('[data-resume-path="experience.0.description.2"]');
  });

  it("连续短要点并成一行、文字全保留；合并不给 measureCss", () => {
    const candidate = byKind("merge-short-points");
    expect(candidate).not.toBeNull();
    if (!candidate) return;
    const project = (candidate.content as unknown as { projects: Record<string, unknown>[] })
      .projects[0];
    expect(project.description).toEqual(["短一；短二", LONG, "短四"]);
    expect((project.point_ids as Record<string, string[]>).description).toHaveLength(3);
    // 项目里 2 条短要点并成 1 行；experience 的 3 条短要点（含重复句）也并成 1 行。
    expect(candidate.stats.pointsMerged).toBe(2);
    expect(candidate.stats.pointsRemoved).toBe(3);
    expect(experiences(candidate.content)[0].description).toEqual(["负责 A；负责 B；负责 A"]);
    expect(candidate.measureCss).toBeNull();
  });

  it("hints 存在时追加低相关候选（排第一），并按 point_id 现算下标删除", () => {
    const hints = [
      {
        kind: "low_relevance" as const,
        section: "projects",
        object_id: "prj_aaaa0001",
        point_field: "description",
        point_id: "pt_prj_aaa1",
        reason: "与岗位关键词无交集",
        evidence: ["JD 无「短一」相关要求"],
      },
    ];
    const candidates = buildContentCandidates(content(), hints);
    const candidate = candidates[0];
    expect(candidate.kind).toBe("low-relevance-points");
    const project = (candidate.content as unknown as { projects: Record<string, unknown>[] })
      .projects[0];
    expect(project.description).toEqual(["短二", LONG, "短四"]);
    expect(candidate.stats.pointsRemoved).toBe(1);
    expect(candidate.measureCss).toContain('[data-resume-path="projects.0.description.0"]');
  });

  it("无效 hints（未知板块 / 不存在的对象）不生成候选也不抛异常", () => {
    const hints = [
      {
        kind: "low_relevance" as const,
        section: "not_a_section",
        object_id: "nope",
        reason: "",
        evidence: [],
      },
      {
        kind: "low_relevance" as const,
        section: "experience",
        object_id: "exp_not_exist",
        reason: "",
        evidence: [],
      },
    ];
    const candidates = buildContentCandidates(content(), hints);
    expect(candidates.map((candidate) => candidate.kind)).not.toContain("low-relevance-points");
  });
});
